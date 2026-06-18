import { deflateSync } from 'node:zlib';

import { address, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY, SolanaError } from '@solana/kit';
import { describe, expect, test, vi } from 'vitest';

import { fetchAnchorIdl, fetchIdl } from '../src/current-idl.js';
import { IdlDecodeError } from '../src/errors.js';
import type { SolanaRpcClient } from '../src/rpc.js';

const PROGRAM = address('BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya');

describe('fetchAnchorIdl', () => {
    test('returns the parsed IDL when the account decodes', async () => {
        const idl = { instructions: [{ name: 'init' }], name: 'my-prog', version: '0.1.0' };
        const { rpc, getAccountInfo } = mockRpc({
            value: { data: [buildAnchorAccount(JSON.stringify(idl)), 'base64'] },
        });
        const out = await fetchAnchorIdl(rpc, PROGRAM);
        expect(out).not.toBeNull();
        expect(out!.idl).toEqual(idl);
        expect(typeof out!.address).toBe('string');
        expect(getAccountInfo).toHaveBeenCalledTimes(1);
    });

    test('returns null when no IDL account exists', async () => {
        const { rpc } = mockRpc({ value: null });
        expect(await fetchAnchorIdl(rpc, PROGRAM)).toBeNull();
    });

    test('throws IdlDecodeError(layout) when the account does not match the IdlAccount framing', async () => {
        const tooShort = Buffer.alloc(50);
        tooShort.writeUInt32LE(100, 40); // declared payload length runs past the account bytes
        const { rpc } = mockRpc({ value: { data: [tooShort.toString('base64'), 'base64'] } });
        await expect(fetchAnchorIdl(rpc, PROGRAM)).rejects.toMatchObject({ name: 'IdlDecodeError', reason: 'layout' });
    });

    test('throws IdlDecodeError(inflate) preserving the zlib cause when the payload is corrupt', async () => {
        const garbage = Buffer.alloc(80);
        garbage.writeUInt32LE(20, 40); // valid framing, but the 20 payload bytes aren't valid zlib
        const { rpc } = mockRpc({ value: { data: [garbage.toString('base64'), 'base64'] } });
        const error = await fetchAnchorIdl(rpc, PROGRAM).then(
            () => {
                throw new Error('expected fetchAnchorIdl to reject');
            },
            (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(IdlDecodeError);
        expect((error as IdlDecodeError).reason).toBe('inflate');
        expect((error as IdlDecodeError).cause).toBeInstanceOf(Error);
    });

    test('throws IdlDecodeError(json) when decompressed bytes are not JSON', async () => {
        const { rpc } = mockRpc({ value: { data: [buildAnchorAccount('not json at all'), 'base64'] } });
        await expect(fetchAnchorIdl(rpc, PROGRAM)).rejects.toMatchObject({ reason: 'json' });
    });

    test('returns parsed JSON without validating Anchor shape', async () => {
        const idl = { name: 'prog' }; // no instructions array — accepted as-is
        const { rpc } = mockRpc({ value: { data: [buildAnchorAccount(JSON.stringify(idl)), 'base64'] } });
        const out = await fetchAnchorIdl(rpc, PROGRAM);
        expect(out?.idl).toEqual(idl);
    });

    test('propagates RPC errors (does not swallow them as decode failures)', async () => {
        const rpcError = new SolanaError(SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY, {});
        await expect(fetchAnchorIdl(rejectingRpc(rpcError), PROGRAM)).rejects.toBe(rpcError);
    });
});

describe('fetchIdl', () => {
    test('falls back to Anchor when PMP fetch yields nothing', async () => {
        const idl = JSON.stringify({ name: 'fallback', version: '1.0.0' });
        const { rpc } = mockRpc({ value: { data: [buildAnchorAccount(idl), 'base64'] } });
        // PMP path returns nothing because fetchMetadataContent throws against the mock RPC,
        // so we fall through to Anchor. fetchIdl is lenient: it parses when possible without
        // requiring a valid Anchor shape.
        const out = await fetchIdl(rpc, PROGRAM, { authority: null });
        expect(out).not.toBeNull();
        expect(out!.type).toBe('anchor');
        expect(out!.idl).toEqual({ name: 'fallback', version: '1.0.0' });
    });
});

// ─── helpers ───────────────────────────────────────────────────────────────

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

function rejectingRpc(error: Error): SolanaRpcClient {
    const getAccountInfo = vi.fn(() => ({ send: () => Promise.reject(error) }));
    return { getAccountInfo } as unknown as SolanaRpcClient;
}
