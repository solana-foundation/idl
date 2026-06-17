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

export type AnchorIdl = {
    content: string;
    address: Address;
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
 * Decode raw Anchor `IdlAccount` bytes, reporting *why* decoding failed so
 * callers that care (e.g. {@link resolveAnchorIdl}) can surface a typed error
 * with the original cause. Most callers want {@link decodeAnchorIdlAccountBytes},
 * which flattens this to `string | null`.
 */
async function tryDecodeAnchorIdlAccountBytes(raw: Uint8Array): Promise<AnchorDecodeResult> {
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
 * Shared Anchor IdlAccount decoder used by both {@link fetchAnchorIdl} (which
 * derives the PDA from a program id) and {@link fetchAnchorIdlFromBuffer}
 * (which takes a raw account address). Returns the decompressed IDL JSON, or
 * null if the bytes don't match the IdlAccount layout.
 */
async function decodeAnchorIdlAccountBytes(raw: Uint8Array): Promise<string | null> {
    const result = await tryDecodeAnchorIdlAccountBytes(raw);
    return result.ok ? result.content : null;
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

/**
 * Resolve the live Anchor IDL for `programId`. Returns the raw decompressed
 * JSON string and the IDL account address, or `null` if no Anchor IDL is
 * published. Use {@link fetchIdl} for the higher-level PMP-first flow.
 */
export async function fetchAnchorIdl(rpc: SolanaRpcClient, programId: Address): Promise<AnchorIdl | null> {
    const idlAddr = await findAnchorIdlAddress(programId);
    const account = await fetchEncodedAccount(rpc, idlAddr);
    if (!account.exists) return null;

    const content = await decodeAnchorIdlAccountBytes(account.data);
    if (content === null) return null;

    return { address: idlAddr, content };
}

/** Result of {@link resolveAnchorIdl}: a parsed, shape-validated Anchor IDL. */
export type ResolvedAnchorIdl = {
    address: Address;
    /** Parsed Anchor IDL JSON (validated to at least have an `instructions` array). */
    idl: unknown;
};

/**
 * Strict variant of {@link fetchAnchorIdl} that distinguishes the three
 * outcomes consumers usually care about, instead of collapsing them into one
 * `null`:
 *
 *  - **No IDL published** — the derived account doesn't exist → returns `null`.
 *  - **Present but undecodable** — the account exists but its bytes aren't a
 *    valid, parseable, well-shaped IDL → throws {@link IdlDecodeError}.
 *  - **RPC/transport failure** — the underlying `getAccountInfo` rejects →
 *    that `SolanaError` propagates (classify it with `classifyRpcError`).
 *
 * On success returns the IDL account address plus the parsed JSON, so callers
 * don't re-`JSON.parse` the raw string or re-validate the Anchor shape
 * themselves. Use {@link fetchAnchorIdl} when you want the raw content string
 * and `null`-on-any-failure semantics.
 */
export async function resolveAnchorIdl(rpc: SolanaRpcClient, programId: Address): Promise<ResolvedAnchorIdl | null> {
    const idlAddr = await findAnchorIdlAddress(programId);
    const account = await fetchEncodedAccount(rpc, idlAddr);
    if (!account.exists) return null;

    const decoded = await tryDecodeAnchorIdlAccountBytes(account.data);
    if (!decoded.ok) {
        throw decoded.reason === 'inflate'
            ? new IdlDecodeError('Anchor IDL account present but its zlib payload failed to inflate', {
                  address: idlAddr,
                  cause: decoded.cause,
                  reason: 'inflate',
              })
            : new IdlDecodeError('Anchor IDL account present but bytes do not match the IdlAccount layout', {
                  address: idlAddr,
                  reason: 'layout',
              });
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(decoded.content);
    } catch (cause) {
        throw new IdlDecodeError('Decoded Anchor IDL is not valid JSON', { address: idlAddr, cause, reason: 'json' });
    }

    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { instructions?: unknown }).instructions)) {
        throw new IdlDecodeError('Decoded Anchor IDL has unexpected shape', { address: idlAddr, reason: 'shape' });
    }

    return { address: idlAddr, idl: parsed };
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
    return await decodeAnchorIdlAccountBytes(account.data);
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

    const content = await decodeAnchorIdlAccountBytes(account.data);
    return content === null ? null : { address: bufferAddress, content, type: 'anchor' };
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

    const anchor = await fetchAnchorIdl(rpc, programId);
    if (anchor) {
        return {
            idl: parseIdlJson(anchor.content),
            programId: programId as string,
            type: 'anchor',
        };
    }

    return null;
}
