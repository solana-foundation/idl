import { promisify } from 'node:util';
import { inflate } from 'node:zlib';

import type { Seed } from '@solana-program/program-metadata';
import type { Address } from '@solana/kit';
import { createSolanaRpc, fetchEncodedAccount } from '@solana/kit';

import { findAnchorIdlAddress } from './anchor.js';
import { fetchPmpIdlContentResolved } from './pmp-idl.js';
import { readU32LE } from './rpc.js';

const zlibInflate = promisify(inflate);

// Anchor IDL account layout: [8 disc][32 authority][4 data_len][zlib(idl_json)].
const ANCHOR_ACCOUNT_HEADER_LEN = 44;
const ANCHOR_ACCOUNT_LEN_OFFSET = 40;

/** RPC handle from `createSolanaRpc` (mainnet or devnet URLs; PMP isn't deployed on testnet). */
export type SolanaRpcClient = ReturnType<typeof createSolanaRpc>;

export type CurrentIdlSource = 'pmp' | 'anchor';

export type CurrentIdlResponse = {
    programId: string;
    type: CurrentIdlSource;
    /** Parsed JSON when valid JSON, otherwise raw string */
    idl: unknown;
};

function parseIdlJson(content: string): unknown {
    try {
        return JSON.parse(content) as unknown;
    } catch {
        return content;
    }
}

export async function fetchCurrentAnchorIdlString(rpc: SolanaRpcClient, programId: Address): Promise<string | null> {
    const idlAddr = await findAnchorIdlAddress(programId);
    const account = await fetchEncodedAccount(rpc, idlAddr);
    if (!account.exists) return null;

    const raw = account.data;
    if (raw.length <= ANCHOR_ACCOUNT_HEADER_LEN) return null;

    const dataLen = readU32LE(raw, ANCHOR_ACCOUNT_LEN_OFFSET);
    if (dataLen === 0 || ANCHOR_ACCOUNT_HEADER_LEN + dataLen > raw.length) return null;

    const compressed = raw.slice(ANCHOR_ACCOUNT_HEADER_LEN, ANCHOR_ACCOUNT_HEADER_LEN + dataLen);
    const decompressed = await zlibInflate(compressed);
    return decompressed.toString('utf8');
}

/**
 * Resolve the live on-chain IDL the same way as `GET /api/idl`: try PMP first
 * (canonical PMP, then non-canonical via the IDL fallback authority), then Anchor.
 */
export async function fetchCurrentIdlPreferPmp(
    rpc: SolanaRpcClient,
    programId: Address,
    options?: { seed?: Seed; authority?: Address | null },
): Promise<CurrentIdlResponse | null> {
    const seed = options?.seed ?? 'idl';

    const pmp = await fetchPmpIdlContentResolved(rpc, programId, seed, options?.authority);
    if (pmp) {
        return {
            idl: parseIdlJson(pmp.content),
            programId: programId as string,
            type: 'pmp',
        };
    }

    const anchorContent = await fetchCurrentAnchorIdlString(rpc, programId);
    if (anchorContent) {
        return {
            idl: parseIdlJson(anchorContent),
            programId: programId as string,
            type: 'anchor',
        };
    }

    return null;
}
