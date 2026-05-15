import type { Address } from '@solana/kit';
import { createSolanaRpc } from '@solana/kit';
import type { Seed } from '@solana-program/program-metadata';
import { inflate } from 'node:zlib';
import { promisify } from 'node:util';

import { findAnchorIdlAddress } from './anchor.js';
import { fetchPmpIdlContentResolved } from './pmp-idl.js';
import { readU32LE } from './rpc.js';

const zlibInflate = promisify(inflate);

/** RPC handle from `createSolanaRpc` (mainnet/devnet/testnet URLs). */
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

export async function fetchCurrentAnchorIdlString(
    rpc: SolanaRpcClient,
    programId: Address,
): Promise<string | null> {
    const idlAddr = await findAnchorIdlAddress(programId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accountInfo = await (rpc as any)
        .getAccountInfo(idlAddr, { encoding: 'base64' })
        .send();

    if (!accountInfo?.value?.data) return null;

    const raw = Buffer.from(accountInfo.value.data[0], 'base64');
    if (raw.length <= 44) return null;

    // Anchor IDL account layout: 8 discriminator + 32 authority + 4 data_len + data
    const dataLen = readU32LE(raw, 40);
    if (dataLen === 0 || 44 + dataLen > raw.length) return null;

    const compressed = raw.slice(44, 44 + dataLen);
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

    const pmp = await fetchPmpIdlContentResolved(
        rpc,
        programId,
        seed,
        options?.authority,
    );
    if (pmp) {
        return {
            programId: programId as string,
            type: 'pmp',
            idl: parseIdlJson(pmp.content),
        };
    }

    const anchorContent = await fetchCurrentAnchorIdlString(rpc, programId);
    if (anchorContent) {
        return {
            programId: programId as string,
            type: 'anchor',
            idl: parseIdlJson(anchorContent),
        };
    }

    return null;
}
