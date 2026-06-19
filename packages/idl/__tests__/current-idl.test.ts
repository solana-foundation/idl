import { deflateSync } from 'node:zlib';

import { address, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY, SolanaError } from '@solana/kit';
import { describe, expect, test, vi } from 'vitest';

import { findAnchorIdlAddress } from '../src/anchor.js';
import { fetchAnchorIdl, fetchIdl, fetchIdlWrapped } from '../src/current-idl.js';
import type { SolanaRpcClient } from '../src/rpc.js';

const PROGRAM = address('BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya');

describe('fetchAnchorIdl', () => {
    test('returns an ok result carrying the raw decoded content', async () => {
        const idl = { instructions: [{ name: 'init' }], name: 'my-prog', version: '0.1.0' };
        const { rpc, getAccountInfo } = mockRpc({
            value: { data: [buildAnchorAccount(JSON.stringify(idl)), 'base64'] },
        });
        const out = await fetchAnchorIdl(rpc, PROGRAM);
        expect(out.status).toBe('ok');
        if (out.status === 'ok') {
            expect(out.source).toBe('anchor');
            expect(JSON.parse(out.content)).toEqual(idl);
            expect(typeof out.address).toBe('string');
        }
        expect(getAccountInfo).toHaveBeenCalledTimes(1);
    });

    test('returns absent carrying the derived IDL address when no account exists', async () => {
        const { rpc } = mockRpc({ value: null });
        const expectedAddress = await findAnchorIdlAddress(PROGRAM);
        expect(await fetchAnchorIdl(rpc, PROGRAM)).toEqual({ address: expectedAddress, status: 'absent' });
    });

    test('returns corrupt(framing) when the account does not match the IdlAccount framing', async () => {
        const tooShort = Buffer.alloc(50);
        tooShort.writeUInt32LE(100, 40); // declared payload length runs past the account bytes
        const { rpc } = mockRpc({ value: { data: [tooShort.toString('base64'), 'base64'] } });
        const out = await fetchAnchorIdl(rpc, PROGRAM);
        expect(out).toMatchObject({ reason: 'framing', source: 'anchor', status: 'corrupt' });
    });

    test('returns corrupt(payload) preserving the zlib cause when the payload is corrupt', async () => {
        const garbage = Buffer.alloc(80);
        garbage.writeUInt32LE(20, 40); // valid framing, but the 20 payload bytes aren't valid zlib
        const { rpc } = mockRpc({ value: { data: [garbage.toString('base64'), 'base64'] } });
        const out = await fetchAnchorIdl(rpc, PROGRAM);
        expect(out.status).toBe('corrupt');
        if (out.status === 'corrupt') {
            expect(out.reason).toBe('payload');
            expect(out.cause).toBeInstanceOf(Error);
        }
    });

    test('returns ok (NOT corrupt) when decompressed bytes are not JSON — validation is deferred', async () => {
        const { rpc } = mockRpc({ value: { data: [buildAnchorAccount('not json at all'), 'base64'] } });
        const out = await fetchAnchorIdl(rpc, PROGRAM);
        expect(out.status).toBe('ok');
        if (out.status === 'ok') expect(out.content).toBe('not json at all');
    });

    test('does not parse or validate the content (raw string preserved)', async () => {
        const json = JSON.stringify({ name: 'prog' }); // no instructions array — preserved as-is
        const { rpc } = mockRpc({ value: { data: [buildAnchorAccount(json), 'base64'] } });
        const out = await fetchAnchorIdl(rpc, PROGRAM);
        expect(out.status === 'ok' && out.content).toBe(json);
    });

    test('propagates RPC errors (does not swallow them as a data outcome)', async () => {
        const rpcError = new SolanaError(SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY, {});
        await expect(fetchAnchorIdl(rejectingRpc(rpcError), PROGRAM)).rejects.toBe(rpcError);
    });
});

describe('fetchIdlWrapped', () => {
    test('returns the anchor ok result when PMP is absent', async () => {
        const idl = { name: 'wrapped', version: '2.0.0' };
        const anchorAddr = await findAnchorIdlAddress(PROGRAM);
        const rpc = mockRpcByAddress({
            [anchorAddr]: { value: { data: [buildAnchorAccount(JSON.stringify(idl)), 'base64'] } },
        });
        const res = await fetchIdlWrapped(rpc, PROGRAM, { authority: null });
        expect(res.status).toBe('ok');
        if (res.status === 'ok') {
            expect(res.source).toBe('anchor');
            expect(JSON.parse(res.content)).toEqual(idl);
        }
    });

    test('returns absent when neither source has an IDL', async () => {
        const rpc = mockRpcByAddress({}); // every account missing
        const res = await fetchIdlWrapped(rpc, PROGRAM, { authority: null });
        expect(res.status).toBe('absent');
    });
});

describe('fetchIdl', () => {
    test('falls back to Anchor and returns the parsed object when PMP yields nothing', async () => {
        const idl = { name: 'fallback', version: '1.0.0' };
        const anchorAddr = await findAnchorIdlAddress(PROGRAM);
        const rpc = mockRpcByAddress({
            [anchorAddr]: { value: { data: [buildAnchorAccount(JSON.stringify(idl)), 'base64'] } },
        });
        // PMP canonical lookup resolves to a missing account (absent), so
        // resolution falls through to Anchor; fetchIdl returns the parsed object.
        const out = await fetchIdl(rpc, PROGRAM, { authority: null });
        expect(out).toEqual(idl);
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

/** RPC stub that returns a per-address response (missing account otherwise). */
function mockRpcByAddress(map: Record<string, unknown>): SolanaRpcClient {
    const getAccountInfo = vi.fn((addr: string) => ({ send: () => Promise.resolve(map[addr] ?? { value: null }) }));
    return { getAccountInfo } as unknown as SolanaRpcClient;
}

function rejectingRpc(error: Error): SolanaRpcClient {
    const getAccountInfo = vi.fn(() => ({ send: () => Promise.reject(error) }));
    return { getAccountInfo } as unknown as SolanaRpcClient;
}
