import {
    Compression,
    decodeBuffer,
    Encoding,
    fetchMetadataContent,
    unpackDirectData,
    type Seed,
} from '@solana-program/program-metadata';
import type { Address, EncodedAccount } from '@solana/kit';
import { fetchEncodedAccount } from '@solana/kit';

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

export type PmpIdl = {
    content: string;
    address: Address;
    authority: Address | null;
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

async function tryFetchPmpContent(
    rpc: SolanaRpcClient,
    programId: Address,
    seed: Seed,
    authority: Address | null,
): Promise<string | null> {
    try {
        const content = await fetchMetadataContent(rpc, programId, seed, authority);
        return content || null;
    } catch {
        return null;
    }
}

/**
 * Resolve the live PMP IDL for `programId`. Tries canonical first, then each
 * fndn / fallback authority in {@link IDL_FALLBACK_PMP_AUTHORITIES}. Returns
 * `null` if no PMP metadata is published.
 *
 * Returns the raw on-chain content as a string (NOT parsed JSON) so callers
 * that need byte-exact preservation (hashing, diffing) get it. To get a parsed
 * IDL with Anchor fallback, use {@link fetchIdl} instead.
 */
export async function fetchPmpIdl(
    rpc: SolanaRpcClient,
    programId: Address,
    seed: Seed = 'idl',
    explicitAuthority?: Address | null,
): Promise<PmpIdl | null> {
    const lookups = await buildPmpIdlLookups(programId, seed, explicitAuthority);

    for (const lookup of lookups) {
        const content = await tryFetchPmpContent(rpc, programId, seed, lookup.authority);
        if (content) {
            return {
                address: lookup.address,
                authority: lookup.authority,
                content,
            };
        }
    }

    return null;
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
 * Pure decoder for an already-fetched PMP `Buffer` account. Returns the
 * decoded content string, or `null` if the bytes don't parse as a Buffer or
 * none of the candidate decodings yield a non-empty string.
 *
 * Exposed within the package so callers that already hold the encoded
 * account (e.g. {@link fetchIdlFromBuffer}) can avoid a second RPC round
 * trip. The public {@link fetchPmpIdlFromBuffer} is the one-stop entry that
 * does the fetch + decode.
 */
export function decodePmpIdlFromBufferAccount(account: EncodedAccount, format?: PmpDecodeFormat): string | null {
    let decoded;
    try {
        decoded = decodeBuffer(account);
    } catch {
        return null;
    }

    const data = decoded.data.data;
    if (data.length === 0) return null;

    const candidates = format ? [format] : DEFAULT_PMP_DECODE_CANDIDATES;

    for (const { encoding, compression } of candidates) {
        try {
            const content = unpackDirectData({ compression, data, encoding });
            if (content.length > 0) return content;
        } catch {
            // Try the next candidate
        }
    }

    return null;
}

/**
 * Fetch a PMP buffer account by address and decode its raw bytes as an IDL.
 * PMP buffers carry only raw bytes — the encoding/compression/format live on
 * the *destination* Metadata account, not on the buffer itself. For IDL
 * workflows the payload is conventionally zlib+UTF-8 (matching
 * {@link packDirectData} defaults), so this helper tries that first and
 * falls back to gzip and plain UTF-8.
 *
 * Pass `format` (both `encoding` AND `compression` required together) to
 * force a specific decoding when working with non-IDL buffers. Returns
 * `null` if the account doesn't exist, isn't a PMP buffer, or none of the
 * candidate decodings yield a non-empty string.
 */
export async function fetchPmpIdlFromBuffer(
    rpc: SolanaRpcClient,
    bufferAddress: Address,
    format?: PmpDecodeFormat,
): Promise<string | null> {
    const account = await fetchEncodedAccount(rpc, bufferAddress);
    if (!account.exists) return null;
    return decodePmpIdlFromBufferAccount(account, format);
}
