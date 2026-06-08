import { deflateSync } from 'node:zlib';

import { address } from '@solana/kit';
import { describe, expect, test, vi } from 'vitest';

import { fetchAnchorIdl, fetchIdl } from '../src/current-idl.js';
import type { SolanaRpcClient } from '../src/rpc.js';

const PROGRAM = address('BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya');

function buildAnchorAccount(json: string): string {
    const compressed = deflateSync(Buffer.from(json, 'utf8'));
    const buf = Buffer.alloc(8 + 32 + 4 + compressed.length);
    buf.writeUInt32LE(compressed.length, 40);
    compressed.copy(buf, 44);
    return buf.toString('base64');
}

function mockRpc(response: unknown): { rpc: SolanaRpcClient; getAccountInfo: ReturnType<typeof vi.fn> } {
    const getAccountInfo = vi.fn(() => ({ send: () => Promise.resolve(response) }));
    return { getAccountInfo, rpc: { getAccountInfo } as unknown as SolanaRpcClient };
}

describe('fetchAnchorIdl', () => {
    test('decompresses a valid Anchor IDL account', async () => {
        const idl = JSON.stringify({ name: 'my-prog', version: '0.1.0' });
        const { rpc, getAccountInfo } = mockRpc({ value: { data: [buildAnchorAccount(idl), 'base64'] } });
        const out = await fetchAnchorIdl(rpc, PROGRAM);
        expect(out).not.toBeNull();
        expect(out!.content).toBe(idl);
        expect(typeof out!.address).toBe('string');
        expect(getAccountInfo).toHaveBeenCalledTimes(1);
    });

    test('returns null when account is missing', async () => {
        const { rpc } = mockRpc({ value: null });
        const out = await fetchAnchorIdl(rpc, PROGRAM);
        expect(out).toBeNull();
    });

    test('returns null when account is too short to be valid', async () => {
        const { rpc } = mockRpc({ value: { data: [Buffer.alloc(10).toString('base64'), 'base64'] } });
        const out = await fetchAnchorIdl(rpc, PROGRAM);
        expect(out).toBeNull();
    });
});

describe('fetchIdl', () => {
    test('falls back to Anchor when PMP fetch yields nothing', async () => {
        const idl = JSON.stringify({ name: 'fallback', version: '1.0.0' });
        const { rpc } = mockRpc({ value: { data: [buildAnchorAccount(idl), 'base64'] } });
        // PMP path returns nothing because fetchMetadataContent throws against the mock RPC,
        // so we fall through to Anchor.
        const out = await fetchIdl(rpc, PROGRAM, { authority: null });
        expect(out).not.toBeNull();
        expect(out!.type).toBe('anchor');
        expect(out!.idl).toEqual({ name: 'fallback', version: '1.0.0' });
    });
});
