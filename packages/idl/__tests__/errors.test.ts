import { deflateSync } from 'node:zlib';

import {
    address,
    SOLANA_ERROR__JSON_RPC__METHOD_NOT_FOUND,
    SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY,
    SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
    SolanaError,
} from '@solana/kit';
import { describe, expect, test, vi } from 'vitest';

import { resolveAnchorIdl } from '../src/current-idl.js';
import { classifyRpcError, IdlDecodeError, isTransientRpcError } from '../src/errors.js';
import type { SolanaRpcClient } from '../src/rpc.js';

const PROGRAM = address('BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya');

describe('resolveAnchorIdl', () => {
    test('returns parsed IDL when the account decodes', async () => {
        const idl = { instructions: [{ name: 'init' }], name: 'prog', version: '0.1.0' };
        const rpc = mockRpc({ value: { data: [buildAnchorAccount(JSON.stringify(idl)), 'base64'] } });
        const out = await resolveAnchorIdl(rpc, PROGRAM);
        expect(out).not.toBeNull();
        expect(out!.idl).toEqual(idl);
        expect(typeof out!.address).toBe('string');
    });

    test('returns null when no IDL account exists', async () => {
        const out = await resolveAnchorIdl(mockRpc({ value: null }), PROGRAM);
        expect(out).toBeNull();
    });

    test('throws IdlDecodeError(layout) when present account does not match the IdlAccount framing', async () => {
        const tooShort = Buffer.alloc(50);
        tooShort.writeUInt32LE(100, 40); // declared payload length runs past the account bytes
        const rpc = mockRpc({ value: { data: [tooShort.toString('base64'), 'base64'] } });
        await expect(resolveAnchorIdl(rpc, PROGRAM)).rejects.toMatchObject({
            name: 'IdlDecodeError',
            reason: 'layout',
        });
    });

    test('throws IdlDecodeError(inflate) preserving the zlib cause when the payload is corrupt', async () => {
        const garbage = Buffer.alloc(80);
        garbage.writeUInt32LE(20, 40); // valid framing, but the 20 payload bytes aren't valid zlib
        const rpc = mockRpc({ value: { data: [garbage.toString('base64'), 'base64'] } });
        const error = await resolveAnchorIdl(rpc, PROGRAM).then(
            () => {
                throw new Error('expected resolveAnchorIdl to reject');
            },
            (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(IdlDecodeError);
        expect((error as IdlDecodeError).reason).toBe('inflate');
        expect((error as IdlDecodeError).cause).toBeInstanceOf(Error);
    });

    test('throws IdlDecodeError(json) when decompressed bytes are not JSON', async () => {
        const rpc = mockRpc({ value: { data: [buildAnchorAccount('not json at all'), 'base64'] } });
        await expect(resolveAnchorIdl(rpc, PROGRAM)).rejects.toMatchObject({ reason: 'json' });
    });

    test('throws IdlDecodeError(shape) when JSON lacks an instructions array', async () => {
        const rpc = mockRpc({ value: { data: [buildAnchorAccount(JSON.stringify({ name: 'prog' })), 'base64'] } });
        await expect(resolveAnchorIdl(rpc, PROGRAM)).rejects.toMatchObject({ reason: 'shape' });
    });

    test('propagates RPC errors (does not swallow them as decode failures)', async () => {
        const rpcError = new SolanaError(SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY, {});
        await expect(resolveAnchorIdl(rejectingRpc(rpcError), PROGRAM)).rejects.toBe(rpcError);
    });
});

describe('classifyRpcError', () => {
    test('returns null for non-SolanaError input', () => {
        expect(classifyRpcError(new Error('boom'))).toBeNull();
        expect(classifyRpcError(new IdlDecodeError('x', { address: PROGRAM, reason: 'shape' }))).toBeNull();
        expect(classifyRpcError(undefined)).toBeNull();
    });

    test('classifies known transient JSON-RPC codes as transient', () => {
        const err = new SolanaError(SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY, {});
        expect(classifyRpcError(err)).toBe('transient');
        expect(isTransientRpcError(err)).toBe(true);
    });

    test('falls back to misconfig for a non-transient, non-transport SolanaError', () => {
        const err = new SolanaError(SOLANA_ERROR__JSON_RPC__METHOD_NOT_FOUND, { __serverMessage: 'Method not found' });
        expect(classifyRpcError(err)).toBe('misconfig');
        expect(isTransientRpcError(err)).toBe(false);
    });

    test('treats 5xx/429 transport errors as transient and others as misconfig', () => {
        const make = (statusCode: number, message: string) =>
            new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, { headers: new Headers(), message, statusCode });
        expect(classifyRpcError(make(503, 'unavailable'))).toBe('transient');
        expect(classifyRpcError(make(429, 'rate limited'))).toBe('transient');
        expect(classifyRpcError(make(403, 'forbidden'))).toBe('misconfig');
        expect(classifyRpcError(make(404, 'not found'))).toBe('misconfig');
    });
});

// ─── helpers ───────────────────────────────────────────────────────────────

function buildAnchorAccount(payload: Uint8Array | string): string {
    const raw = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : Buffer.from(payload);
    const compressed = deflateSync(raw);
    const buf = Buffer.alloc(44 + compressed.length);
    buf.writeUInt32LE(compressed.length, 40);
    compressed.copy(buf, 44);
    return buf.toString('base64');
}

function mockRpc(response: unknown): SolanaRpcClient {
    const getAccountInfo = vi.fn(() => ({ send: () => Promise.resolve(response) }));
    return { getAccountInfo } as unknown as SolanaRpcClient;
}

function rejectingRpc(error: Error): SolanaRpcClient {
    const getAccountInfo = vi.fn(() => ({ send: () => Promise.reject(error) }));
    return { getAccountInfo } as unknown as SolanaRpcClient;
}
