import { promisify } from 'node:util';
import { inflate } from 'node:zlib';

import { PROGRAM_METADATA_PROGRAM_ADDRESS, type Seed } from '@solana-program/program-metadata';
import type { Address } from '@solana/kit';
import { fetchEncodedAccount } from '@solana/kit';

import { findAnchorIdlAddress } from './anchor.js';
import { decodePmpIdlFromBufferAccount, fetchPmpIdl } from './pmp-idl.js';
import { readU32LE, type SolanaRpcClient } from './rpc.js';

const zlibInflate = promisify(inflate);

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
 * Shared Anchor IdlAccount decoder used by both {@link fetchAnchorIdl} (which
 * derives the PDA from a program id) and {@link fetchAnchorIdlFromBuffer}
 * (which takes a raw account address). Returns the decompressed IDL JSON, or
 * null if the bytes don't match the IdlAccount layout.
 */
async function decodeAnchorIdlAccountBytes(raw: Uint8Array): Promise<string | null> {
    if (raw.length <= ANCHOR_ACCOUNT_HEADER_LEN) return null;

    const dataLen = readU32LE(raw, ANCHOR_ACCOUNT_LEN_OFFSET);
    if (dataLen === 0 || ANCHOR_ACCOUNT_HEADER_LEN + dataLen > raw.length) return null;

    const compressed = raw.slice(ANCHOR_ACCOUNT_HEADER_LEN, ANCHOR_ACCOUNT_HEADER_LEN + dataLen);
    try {
        const decompressed = await zlibInflate(compressed);
        return decompressed.toString('utf8');
    } catch {
        return null;
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
