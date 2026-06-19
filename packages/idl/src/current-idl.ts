import { PROGRAM_METADATA_PROGRAM_ADDRESS, type Seed } from '@solana-program/program-metadata';
import type { Address } from '@solana/kit';
import { fetchEncodedAccount } from '@solana/kit';

import { findAnchorIdlAddress } from './anchor.js';
import { inflate } from './decompress.js';
import { type FetchIdlResult, type IdlResult, unwrapIdl } from './idl-result.js';
import { decodePmpIdlFromBufferAccount, fetchPmpIdl } from './pmp-idl.js';
import { readU32LE, type SolanaRpcClient } from './rpc.js';

/**
 * Anchor `IdlAccount` layout, shared by both the canonical IDL PDA and any
 * staging buffer created via `idl_create_buffer`:
 *   [8 disc][32 authority][4 data_len LE][zlib(idl_json)]
 */
const ANCHOR_ACCOUNT_HEADER_LEN = 44;
const ANCHOR_ACCOUNT_LEN_OFFSET = 40;

/**
 * Discriminated outcome of decoding raw Anchor `IdlAccount` bytes:
 *  - `ok` with the decompressed IDL content (the raw string — NOT parsed or
 *    validated as JSON; that happens at the `unwrap*` boundary),
 *  - a `framing` failure (bytes don't match the IdlAccount header/length framing), or
 *  - a `payload` failure (framing matched but the zlib payload didn't decompress),
 *    carrying the original zlib error as `cause`.
 */
type AnchorDecodeResult =
    | { ok: true; content: string }
    | { ok: false; reason: 'framing' }
    | { ok: false; reason: 'payload'; cause: unknown };

/**
 * Decode raw Anchor `IdlAccount` bytes into a discriminated result so callers
 * can tell *why* decoding failed — a `framing` mismatch vs a `payload` failure
 * (which carries the original zlib error as `cause`). Callers that only need
 * "content or nothing" check `result.ok`.
 */
async function decodeAnchorIdlAccountBytes(raw: Uint8Array): Promise<AnchorDecodeResult> {
    if (raw.length <= ANCHOR_ACCOUNT_HEADER_LEN) return { ok: false, reason: 'framing' };

    const dataLen = readU32LE(raw, ANCHOR_ACCOUNT_LEN_OFFSET);
    if (dataLen === 0 || ANCHOR_ACCOUNT_HEADER_LEN + dataLen > raw.length) return { ok: false, reason: 'framing' };

    const compressed = raw.slice(ANCHOR_ACCOUNT_HEADER_LEN, ANCHOR_ACCOUNT_HEADER_LEN + dataLen);
    try {
        const decompressed = await inflate(compressed);
        return { content: new TextDecoder().decode(decompressed), ok: true };
    } catch (cause) {
        return { cause, ok: false, reason: 'payload' };
    }
}

/**
 * Map a byte-level {@link AnchorDecodeResult} onto the public {@link IdlResult}
 * shape (`ok` content vs `corrupt` reason). Shared by every Anchor fetcher so
 * the corrupt/ok mapping is identical everywhere.
 */
function anchorResultFromDecode(address: Address, decoded: AnchorDecodeResult): IdlResult<'anchor'> {
    if (decoded.ok) return { address, content: decoded.content, source: 'anchor', status: 'ok' };
    return decoded.reason === 'payload'
        ? { address, cause: decoded.cause, reason: 'payload', source: 'anchor', status: 'corrupt' }
        : { address, reason: 'framing', source: 'anchor', status: 'corrupt' };
}

/**
 * Derive the IDL PDA, read it, and decode its bytes. Always returns the derived
 * `address` (so an `absent` outcome can still report where it looked); `decoded`
 * is `null` when no account exists there.
 */
async function readAnchorIdlAccount(
    rpc: SolanaRpcClient,
    programId: Address,
): Promise<{ address: Address; decoded: AnchorDecodeResult | null }> {
    const address = await findAnchorIdlAddress(programId);
    const account = await fetchEncodedAccount(rpc, address);
    return { address, decoded: account.exists ? await decodeAnchorIdlAccountBytes(account.data) : null };
}

/**
 * Resolve the live Anchor IDL for `programId` from its on-chain bytes,
 * surfacing every data outcome as a value:
 *
 *  - **No IDL published** — the derived account doesn't exist → `absent`.
 *  - **Present but undecodable** — the account exists but its bytes don't match
 *    the IdlAccount layout / fail to inflate → `corrupt` (with the `reason`).
 *  - **Decoded** — `ok` with the raw `content`. Content that isn't JSON is
 *    still `ok` (the bytes decoded); JSON-validity is a separate concern,
 *    checked when you `unwrapIdl` the result.
 *
 * **Throws only on RPC failure** (the underlying `getAccountInfo` rejects —
 * classify it with `classifyRpcError`). Use {@link fetchIdl} for the lenient,
 * PMP-first flow, or {@link unwrapIdl} to collapse this to an `Idl | null`.
 */
export async function fetchAnchorIdl(rpc: SolanaRpcClient, programId: Address): Promise<IdlResult<'anchor'>> {
    const { address, decoded } = await readAnchorIdlAccount(rpc, programId);
    if (!decoded) return { address, status: 'absent' };
    return anchorResultFromDecode(address, decoded);
}

/**
 * Decode an Anchor IDL buffer directly from its account address. Anchor IDL
 * buffers (created by `idl_create_buffer` / `anchor idl write-buffer`) share
 * the same `IdlAccount` layout as the canonical IDL PDA, so this also works
 * if you pass the IDL PDA itself.
 *
 * Returns an Anchor {@link IdlResult}: `absent` if the account doesn't exist,
 * `corrupt` if its bytes don't match the IdlAccount layout, or `ok` with the
 * decompressed content. Use this when an IDL has been staged via
 * `anchor idl write-buffer` but not yet committed via `set-buffer` — common in
 * multisig flows.
 */
export async function fetchAnchorIdlFromBuffer(
    rpc: SolanaRpcClient,
    bufferAddress: Address,
): Promise<IdlResult<'anchor'>> {
    const account = await fetchEncodedAccount(rpc, bufferAddress);
    if (!account.exists) return { address: bufferAddress, status: 'absent' };
    return anchorResultFromDecode(bufferAddress, await decodeAnchorIdlAccountBytes(account.data));
}

/**
 * Resolve the IDL bytes in an arbitrary buffer (or buffer-like) account,
 * auto-detecting whether it's a PMP buffer (owned by the program metadata
 * program) or an Anchor IDL buffer (owned by any other program).
 *
 * Returns a buffer {@link IdlResult} (bare — `source` may be either family, and
 * a buffer carries no resolution `authority`): `absent` if the account doesn't
 * exist, `corrupt` if it isn't a decodable IDL buffer, or `ok` with the content
 * and the detected `source`. Exactly one `getAccountInfo` call is issued
 * regardless of branch — the already-fetched bytes are passed straight to the
 * source-specific decoder, so no transaction history walk is needed.
 */
export async function fetchIdlFromBuffer(rpc: SolanaRpcClient, bufferAddress: Address): Promise<IdlResult> {
    const account = await fetchEncodedAccount(rpc, bufferAddress);
    if (!account.exists) return { address: bufferAddress, status: 'absent' };

    if (account.programAddress === PROGRAM_METADATA_PROGRAM_ADDRESS) {
        const decoded = decodePmpIdlFromBufferAccount(account);
        return decoded.ok
            ? { address: bufferAddress, content: decoded.content, source: 'pmp', status: 'ok' }
            : {
                  address: bufferAddress,
                  cause: decoded.cause,
                  reason: decoded.reason,
                  source: 'pmp',
                  status: 'corrupt',
              };
    }

    return anchorResultFromDecode(bufferAddress, await decodeAnchorIdlAccountBytes(account.data));
}

/**
 * Resolve the live on-chain IDL the same way as `GET /api/idl`: PMP first
 * (canonical PMP, then non-canonical via the IDL fallback authorities), then
 * Anchor. Returns the **winning (or most-relevant) single per-source result**:
 *
 *  - an `ok` from either source wins immediately — PMP over Anchor, and Anchor
 *    isn't fetched at all when PMP is `ok`;
 *  - otherwise the most-relevant single result is returned — a corrupt PMP is
 *    skipped if Anchor is `ok`, PMP-corrupt is reported over Anchor-corrupt
 *    (canonical priority), and `absent` only when *both* are absent.
 *
 * **Throws only on RPC failure.** Use {@link fetchIdl} for the parsed IDL
 * object shortcut, or `unwrapIdl(await fetchIdlWrapped(...))` for the parsed
 * `Idl` plus `source`/`address`.
 */
export async function fetchIdlWrapped(
    rpc: SolanaRpcClient,
    programId: Address,
    options?: { seed?: Seed; authority?: Address | null },
): Promise<FetchIdlResult> {
    const seed: Seed = options?.seed ?? 'idl';

    const pmp = await fetchPmpIdl(rpc, programId, { authority: options?.authority, seed });
    if (pmp.status === 'ok') return pmp;

    const anchor = await fetchAnchorIdl(rpc, programId);
    if (anchor.status === 'ok') return anchor;

    // Neither is `ok`. PMP-priority: report a corrupt PMP over a corrupt Anchor;
    // when both are absent, return the PMP `absent` (carries the canonical PMP
    // address — the primary place the IDL would live).
    if (pmp.status === 'corrupt') return pmp;
    if (anchor.status === 'corrupt') return anchor;
    return pmp;
}

/**
 * Headline shortcut: the parsed IDL **object** (PMP → Anchor), or `null`.
 * `null` folds every non-usable outcome — absent, corrupt bytes, and invalid
 * content (not JSON, or not a JSON object). Pass your own IDL type for a typed
 * result (`fetchIdl<MyIdl>(...)` → `MyIdl | null`).
 *
 * Need to distinguish absent from corrupt, or the byte-exact raw `content`?
 * Use {@link fetchIdlWrapped}. **Throws only on RPC failure.**
 */
export async function fetchIdl<T = unknown>(
    rpc: SolanaRpcClient,
    programId: Address,
    options?: { seed?: Seed; authority?: Address | null },
): Promise<T | null> {
    const unwrapped = unwrapIdl<T>(await fetchIdlWrapped(rpc, programId, options));
    return unwrapped ? unwrapped.idl : null;
}
