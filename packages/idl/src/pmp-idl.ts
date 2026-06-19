import {
    Compression,
    decodeBuffer,
    Encoding,
    fetchMetadataContent,
    unpackDirectData,
    type Seed,
} from '@solana-program/program-metadata';
import type { Address, EncodedAccount } from '@solana/kit';
import {
    fetchEncodedAccount,
    isSolanaError,
    SOLANA_ERROR__ACCOUNTS__ACCOUNT_NOT_FOUND,
    SOLANA_ERROR__ACCOUNTS__FAILED_TO_DECODE_ACCOUNT,
} from '@solana/kit';

import type { IdlDecodeReason } from './errors.js';
import type { IdlResult, PmpIdlResult } from './idl-result.js';
import { findPmpMetadataAddress } from './program-metadata.js';
import type { SolanaRpcClient } from './rpc.js';

/**
 * Non-canonical PMP authorities to try after the canonical lookup misses.
 * Today this only contains the fndn key (public key of `UPLOAD_KEYPAIR` in the
 * GitHub Actions workflow), but the array shape lets us add more in the future
 * without breaking the public API.
 */
export const IDL_FALLBACK_PMP_AUTHORITIES: readonly Address[] = [
    'fndnu15PLXELbLsTqrfbiweBvsBj2o12RoVfkeCCbX2' as Address,
];

export type PmpIdlLookup = {
    authority: Address | null;
    address: Address;
};

/**
 * PMP accounts to try for seed `idl`: canonical first, then each non-canonical
 * fallback in {@link IDL_FALLBACK_PMP_AUTHORITIES}.
 */
export async function buildPmpIdlLookups(
    programId: Address,
    seed: Seed,
    explicitAuthority?: Address | null,
): Promise<PmpIdlLookup[]> {
    if (explicitAuthority !== undefined) {
        const address = await findPmpMetadataAddress(programId, seed, explicitAuthority);
        return [{ address, authority: explicitAuthority }];
    }

    const lookups: PmpIdlLookup[] = [
        {
            address: await findPmpMetadataAddress(programId, seed, null),
            authority: null,
        },
    ];

    for (const fallback of IDL_FALLBACK_PMP_AUTHORITIES) {
        const fbAddress = await findPmpMetadataAddress(programId, seed, fallback);
        if (lookups.some(l => l.address === fbAddress)) continue;
        lookups.push({
            address: fbAddress,
            authority: fallback,
        });
    }

    return lookups;
}

/**
 * Per-lookup data outcome from {@link fetchMetadataContent}, with genuine RPC
 * failure separated out so it can propagate. `fetchMetadataContent` bundles
 * fetch + decode behind one throwing interface, so we classify its throws into
 * data outcomes vs. real RPC failures:
 *  - `ACCOUNT_NOT_FOUND` (and empty content) → `absent` — no IDL published here;
 *  - `FAILED_TO_DECODE_ACCOUNT` → `corrupt` (`'framing'`) — the account exists
 *    but its bytes aren't a valid metadata account;
 *  - a non-`SolanaError` throw → `corrupt` (`'payload'`) — the metadata decoded
 *    but its content couldn't be decompressed/decoded;
 *  - any *other* `SolanaError` → a genuine RPC/transport failure, **re-thrown**
 *    so it surfaces to the caller (the only throw the public API makes).
 *
 * Without the `FAILED_TO_DECODE_ACCOUNT` branch a present-but-undecodable
 * metadata account would propagate as if the RPC had failed — the soft spot
 * this classification closes.
 */
type PmpContentOutcome =
    | { status: 'ok'; content: string }
    | { status: 'absent' }
    | { status: 'corrupt'; reason: IdlDecodeReason; cause: unknown };

async function fetchPmpContent(
    rpc: SolanaRpcClient,
    programId: Address,
    seed: Seed,
    authority: Address | null,
): Promise<PmpContentOutcome> {
    try {
        const content = await fetchMetadataContent(rpc, programId, seed, authority);
        return content ? { content, status: 'ok' } : { status: 'absent' };
    } catch (err) {
        if (isSolanaError(err, SOLANA_ERROR__ACCOUNTS__ACCOUNT_NOT_FOUND)) return { status: 'absent' };
        if (isSolanaError(err, SOLANA_ERROR__ACCOUNTS__FAILED_TO_DECODE_ACCOUNT)) {
            return { cause: err, reason: 'framing', status: 'corrupt' };
        }
        if (isSolanaError(err)) throw err;
        return { cause: err, reason: 'payload', status: 'corrupt' };
    }
}

/**
 * Resolve the live PMP IDL for `programId`. Tries canonical first, then each
 * fndn / fallback authority in {@link IDL_FALLBACK_PMP_AUTHORITIES}.
 *
 * Returns a {@link PmpIdlResult}: `ok` (with the matched `authority` and the
 * raw on-chain `content` — NOT parsed JSON, so byte-exact consumers get it),
 * `corrupt` (a metadata account exists but its bytes don't decode), or
 * `absent` (no PMP metadata published under any lookup). The first `ok` wins;
 * a `corrupt` is only reported if no later lookup yields `ok`.
 *
 * **Throws only on RPC failure.** A transport/server error from the RPC
 * propagates (classify it with `classifyRpcError`); every data outcome is a
 * value. To get a parsed IDL with Anchor fallback, use {@link fetchIdl}.
 */
export async function fetchPmpIdl(
    rpc: SolanaRpcClient,
    programId: Address,
    options?: { seed?: Seed; authority?: Address | null },
): Promise<PmpIdlResult> {
    const seed: Seed = options?.seed ?? 'idl';
    const lookups = await buildPmpIdlLookups(programId, seed, options?.authority);

    let corrupt: PmpIdlResult | null = null;
    for (const lookup of lookups) {
        const outcome = await fetchPmpContent(rpc, programId, seed, lookup.authority);
        if (outcome.status === 'ok') {
            return {
                address: lookup.address,
                authority: lookup.authority,
                content: outcome.content,
                source: 'pmp',
                status: 'ok',
            };
        }
        if (outcome.status === 'corrupt' && !corrupt) {
            corrupt = {
                address: lookup.address,
                authority: lookup.authority,
                cause: outcome.cause,
                reason: outcome.reason,
                source: 'pmp',
                status: 'corrupt',
            };
        }
    }

    // Nothing found under any lookup: report `absent` at the canonical address
    // (lookups[0]) — the primary place the IDL would live.
    return corrupt ?? { address: lookups[0]!.address, status: 'absent' };
}

/**
 * Specifies a single PMP `(encoding, compression)` pair to decode a buffer as.
 * Both fields are required together because they're a tightly coupled
 * decoding pipeline — supplying only one would silently revert to the
 * default candidate list for the other, which surprised reviewers in the
 * 0.1.1 design.
 */
export type PmpDecodeFormat = {
    encoding: Encoding;
    compression: Compression;
};

/**
 * Order matters: zlib+utf8 first because it's the {@link packDirectData}
 * default and what every standard IDL upload tool produces. Gzip and plain
 * UTF-8 come last as best-effort fallbacks for non-standard payloads.
 *
 * Gzip decoding works as of `@solana-program/program-metadata` v0.7.0, which
 * fixed the upstream `uncompressData(Gzip)` branch — it used to
 * `throw pako.ungzip(data)` instead of returning it, so on v0.5.x this
 * candidate was dead code. The fallback order is unchanged: a buffer that
 * doesn't decode as zlib is now genuinely retried as gzip before plain UTF-8.
 */
const DEFAULT_PMP_DECODE_CANDIDATES: readonly PmpDecodeFormat[] = [
    { compression: Compression.Zlib, encoding: Encoding.Utf8 },
    { compression: Compression.Gzip, encoding: Encoding.Utf8 },
    { compression: Compression.None, encoding: Encoding.Utf8 },
];

/**
 * Discriminated outcome of decoding an already-fetched PMP `Buffer` account:
 * `ok` with the content, or a byte-level failure — `'framing'` (the bytes don't
 * parse as a `Buffer` account, with the decode error as `cause`) or `'payload'`
 * (parsed as a Buffer, but it's empty or no candidate (de)compression yields a
 * non-empty string).
 */
export type PmpBufferDecodeResult =
    | { ok: true; content: string }
    | { ok: false; reason: IdlDecodeReason; cause?: unknown };

/**
 * Pure decoder for an already-fetched PMP `Buffer` account.
 *
 * Exposed within the package so callers that already hold the encoded
 * account (e.g. {@link fetchIdlFromBuffer}) can avoid a second RPC round
 * trip. The public {@link fetchPmpIdlFromBuffer} is the one-stop entry that
 * does the fetch + decode.
 */
export function decodePmpIdlFromBufferAccount(
    account: EncodedAccount,
    format?: PmpDecodeFormat,
): PmpBufferDecodeResult {
    let decoded;
    try {
        decoded = decodeBuffer(account);
    } catch (cause) {
        return { cause, ok: false, reason: 'framing' };
    }

    const data = decoded.data.data;
    if (data.length === 0) return { ok: false, reason: 'payload' };

    const candidates = format ? [format] : DEFAULT_PMP_DECODE_CANDIDATES;

    for (const { encoding, compression } of candidates) {
        try {
            const content = unpackDirectData({ compression, data, encoding });
            if (content.length > 0) return { content, ok: true };
        } catch {
            // Try the next candidate
        }
    }

    return { ok: false, reason: 'payload' };
}

/**
 * Fetch a PMP buffer account by address and decode its raw bytes as an IDL.
 * PMP buffers carry only raw bytes — the encoding/compression/format live on
 * the *destination* Metadata account, not on the buffer itself. For IDL
 * workflows the payload is conventionally zlib+UTF-8 (matching
 * {@link packDirectData} defaults), so this helper tries that first and
 * falls back to gzip and plain UTF-8.
 *
 * Pass `options.format` (both `encoding` AND `compression` required together)
 * to force a specific decoding when working with non-IDL buffers. Returns a
 * buffer {@link IdlResult} (no resolution `authority`): `absent` if the account
 * doesn't exist, `corrupt` if it exists but isn't a decodable PMP buffer, or
 * `ok` with the decoded content. Throws only on RPC failure.
 */
export async function fetchPmpIdlFromBuffer(
    rpc: SolanaRpcClient,
    bufferAddress: Address,
    options?: { format?: PmpDecodeFormat },
): Promise<IdlResult<'pmp'>> {
    const account = await fetchEncodedAccount(rpc, bufferAddress);
    if (!account.exists) return { address: bufferAddress, status: 'absent' };

    const decoded = decodePmpIdlFromBufferAccount(account, options?.format);
    return decoded.ok
        ? { address: bufferAddress, content: decoded.content, source: 'pmp', status: 'ok' }
        : { address: bufferAddress, cause: decoded.cause, reason: decoded.reason, source: 'pmp', status: 'corrupt' };
}
