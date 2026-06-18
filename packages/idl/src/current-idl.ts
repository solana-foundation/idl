import { PROGRAM_METADATA_PROGRAM_ADDRESS, type Seed } from '@solana-program/program-metadata';
import type { Address } from '@solana/kit';
import { fetchEncodedAccount } from '@solana/kit';

import { findAnchorIdlAddress } from './anchor.js';
import { inflate } from './decompress.js';
import { IdlDecodeError } from './errors.js';
import { decodePmpIdlFromBufferAccount, fetchPmpIdl } from './pmp-idl.js';
import { readU32LE, type SolanaRpcClient } from './rpc.js';

/**
 * Anchor `IdlAccount` layout, shared by both the canonical IDL PDA and any
 * staging buffer created via `idl_create_buffer`:
 *   [8 disc][32 authority][4 data_len LE][zlib(idl_json)]
 */
const ANCHOR_ACCOUNT_HEADER_LEN = 44;
const ANCHOR_ACCOUNT_LEN_OFFSET = 40;

export type IdlSource = 'pmp' | 'anchor';

/** Result of {@link fetchAnchorIdl}: a parsed Anchor IDL. */
export type AnchorIdl = {
    address: Address;
    /** Parsed Anchor IDL JSON. */
    idl: unknown;
};

/**
 * Result of {@link fetchIdlFromBuffer}: the decoded IDL content plus which
 * buffer family produced it.
 */
export type BufferIdl = {
    type: IdlSource;
    address: Address;
    content: string;
};

/**
 * Discriminated outcome of decoding raw Anchor `IdlAccount` bytes:
 *  - `ok` with the decompressed IDL JSON,
 *  - a `layout` failure (bytes don't match the IdlAccount header/length framing), or
 *  - an `inflate` failure (framing matched but the zlib payload didn't decompress),
 *    carrying the original zlib error as `cause`.
 */
type AnchorDecodeResult =
    | { ok: true; content: string }
    | { ok: false; reason: 'layout' }
    | { ok: false; reason: 'inflate'; cause: unknown };

/**
 * Decode raw Anchor `IdlAccount` bytes into a discriminated result so callers
 * can tell *why* decoding failed — a `layout` mismatch vs an `inflate` failure
 * (which carries the original zlib error as `cause`). Callers that only need
 * "content or nothing" check `result.ok`.
 */
async function decodeAnchorIdlAccount(raw: Uint8Array): Promise<AnchorDecodeResult> {
    if (raw.length <= ANCHOR_ACCOUNT_HEADER_LEN) return { ok: false, reason: 'layout' };

    const dataLen = readU32LE(raw, ANCHOR_ACCOUNT_LEN_OFFSET);
    if (dataLen === 0 || ANCHOR_ACCOUNT_HEADER_LEN + dataLen > raw.length) return { ok: false, reason: 'layout' };

    const compressed = raw.slice(ANCHOR_ACCOUNT_HEADER_LEN, ANCHOR_ACCOUNT_HEADER_LEN + dataLen);
    try {
        const decompressed = await inflate(compressed);
        return { content: new TextDecoder().decode(decompressed), ok: true };
    } catch (cause) {
        return { cause, ok: false, reason: 'inflate' };
    }
}

/**
 * Result of {@link fetchIdl}: a parsed IDL with the source (`pmp`/`anchor`)
 * that produced it and the program it belongs to.
 */
export type Idl = {
    programId: string;
    type: IdlSource;
    /** Parsed JSON when the on-chain content is valid JSON, otherwise the raw string. */
    idl: unknown;
};

function parseIdlJson(content: string): unknown {
    try {
        return JSON.parse(content) as unknown;
    } catch {
        return content;
    }
}

// ─── Live Anchor IDL ─────────────────────────────────────────────────────────

/** Derive the IDL PDA, read it, and decode its bytes — or `null` if no such account exists. */
async function readAnchorIdlAccount(
    rpc: SolanaRpcClient,
    programId: Address,
): Promise<{ address: Address; decoded: AnchorDecodeResult } | null> {
    const address = await findAnchorIdlAddress(programId);
    const account = await fetchEncodedAccount(rpc, address);
    if (!account.exists) return null;
    return { address, decoded: await decodeAnchorIdlAccount(account.data) };
}

/**
 * Lenient internal read: the raw decompressed IDL content + account address, or
 * `null` for ANY miss (no account or undecodable bytes). Never throws on bad
 * data. Backs the multi-source, never-throw flows ({@link fetchIdl} and
 * `fetchLatestIdls`); the public {@link fetchAnchorIdl} is the strict variant.
 */
export async function fetchAnchorIdlContent(
    rpc: SolanaRpcClient,
    programId: Address,
): Promise<{ address: Address; content: string } | null> {
    const read = await readAnchorIdlAccount(rpc, programId);
    if (!read || !read.decoded.ok) return null;
    return { address: read.address, content: read.decoded.content };
}

/**
 * Resolve the live Anchor IDL for `programId`, parsed from its on-chain bytes.
 * Distinguishes the three outcomes consumers care about instead of collapsing
 * them into one `null`:
 *
 *  - **No IDL published** — the derived account doesn't exist → returns `null`.
 *  - **Present but undecodable** — the account exists but its bytes aren't a
 *    valid, parseable IDL → throws {@link IdlDecodeError}.
 *  - **RPC/transport failure** — the underlying `getAccountInfo` rejects →
 *    that `SolanaError` propagates (classify it with `classifyRpcError`).
 *
 * On success returns the IDL account address plus the parsed JSON, so callers
 * don't re-`JSON.parse` the raw string themselves. Use {@link fetchIdl} for the
 * lenient, PMP-first flow.
 */
export async function fetchAnchorIdl(rpc: SolanaRpcClient, programId: Address): Promise<AnchorIdl | null> {
    const read = await readAnchorIdlAccount(rpc, programId);
    if (!read) return null;

    const { address, decoded } = read;
    if (!decoded.ok) {
        throw decoded.reason === 'inflate'
            ? new IdlDecodeError('Anchor IDL account present but its zlib payload failed to inflate', {
                  address,
                  cause: decoded.cause,
                  reason: 'inflate',
              })
            : new IdlDecodeError('Anchor IDL account present but bytes do not match the IdlAccount layout', {
                  address,
                  reason: 'layout',
              });
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(decoded.content);
    } catch (cause) {
        throw new IdlDecodeError('Decoded Anchor IDL is not valid JSON', { address, cause, reason: 'json' });
    }

    return { address, idl: parsed };
}

/**
 * Decode an Anchor IDL buffer directly from its account address. Anchor IDL
 * buffers (created by `idl_create_buffer` / `anchor idl write-buffer`) share
 * the same `IdlAccount` layout as the canonical IDL PDA, so this also works
 * if you pass the IDL PDA itself.
 *
 * Returns the decompressed IDL JSON, or `null` if the account doesn't exist
 * or its bytes don't match the IdlAccount layout. Use this when an IDL has
 * been staged via `anchor idl write-buffer` but not yet committed via
 * `set-buffer` — common in multisig flows.
 */
export async function fetchAnchorIdlFromBuffer(rpc: SolanaRpcClient, bufferAddress: Address): Promise<string | null> {
    const account = await fetchEncodedAccount(rpc, bufferAddress);
    if (!account.exists) return null;
    const decoded = await decodeAnchorIdlAccount(account.data);
    return decoded.ok ? decoded.content : null;
}

/**
 * Resolve the IDL bytes in an arbitrary buffer (or buffer-like) account,
 * auto-detecting whether it's a PMP buffer (owned by the program metadata
 * program) or an Anchor IDL buffer (owned by any other program).
 *
 * Returns the IDL content plus which family produced it, or `null` if the
 * account doesn't exist or isn't a recognised IDL buffer. Exactly one
 * `getAccountInfo` call is issued regardless of which branch is taken —
 * the already-fetched account bytes are passed straight to the
 * source-specific decoder, so no transaction history walk is needed.
 */
export async function fetchIdlFromBuffer(rpc: SolanaRpcClient, bufferAddress: Address): Promise<BufferIdl | null> {
    const account = await fetchEncodedAccount(rpc, bufferAddress);
    if (!account.exists) return null;

    if (account.programAddress === PROGRAM_METADATA_PROGRAM_ADDRESS) {
        const content = decodePmpIdlFromBufferAccount(account);
        return content === null ? null : { address: bufferAddress, content, type: 'pmp' };
    }

    const decoded = await decodeAnchorIdlAccount(account.data);
    return decoded.ok ? { address: bufferAddress, content: decoded.content, type: 'anchor' } : null;
}

/**
 * Resolve the live on-chain IDL the same way as `GET /api/idl`: try PMP first
 * (canonical PMP, then non-canonical via the IDL fallback authorities), then
 * fall back to Anchor.
 */
export async function fetchIdl(
    rpc: SolanaRpcClient,
    programId: Address,
    options?: { seed?: Seed; authority?: Address | null },
): Promise<Idl | null> {
    const seed = options?.seed ?? 'idl';

    const pmp = await fetchPmpIdl(rpc, programId, seed, options?.authority);
    if (pmp) {
        return {
            idl: parseIdlJson(pmp.content),
            programId: programId as string,
            type: 'pmp',
        };
    }

    const anchor = await fetchAnchorIdlContent(rpc, programId);
    if (anchor) {
        return {
            idl: parseIdlJson(anchor.content),
            programId: programId as string,
            type: 'anchor',
        };
    }

    return null;
}
