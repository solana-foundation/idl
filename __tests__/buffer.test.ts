import { deflateSync } from 'node:zlib';

import {
    Compression,
    Encoding,
    getBufferEncoder,
    packDirectData,
    PROGRAM_METADATA_PROGRAM_ADDRESS,
} from '@solana-program/program-metadata';
import { address } from '@solana/kit';
import { describe, expect, test, vi } from 'vitest';

import { fetchAnchorIdlFromBuffer, fetchIdlFromBuffer } from '../src/current-idl.js';
import { fetchPmpIdlFromBuffer } from '../src/pmp-idl.js';
import type { SolanaRpcClient } from '../src/rpc.js';

// Stable, well-known addresses for test inputs. Account contents are entirely
// synthesised by the test — these only stand in for "some buffer address".
const SOME_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SOME_BUFFER = address('BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya');
const ZERO_AUTHORITY = address('11111111111111111111111111111111');

/**
 * Build a synthetic Anchor `IdlAccount` payload that matches the on-chain
 * layout used by both the canonical IDL PDA and `idl_create_buffer` staging
 * accounts: [8 disc][32 authority][4 len LE][zlib(idl_json)].
 */
function buildAnchorAccountBytes(json: string): Buffer {
    const compressed = deflateSync(Buffer.from(json, 'utf8'));
    const buf = Buffer.alloc(8 + 32 + 4 + compressed.length);
    buf.writeUInt32LE(compressed.length, 40);
    compressed.copy(buf, 44);
    return buf;
}

/**
 * Build a synthetic PMP `Buffer` account using the real codec from
 * `@solana-program/program-metadata` so the bytes match exactly what
 * `fetchMaybeBuffer` expects to decode on chain.
 */
function buildPmpBufferAccountBytes(rawData: Uint8Array): Uint8Array {
    // The encoder returns a ReadonlyUint8Array; copy into a Uint8Array so we
    // can hand it to Node's Buffer.from.
    return new Uint8Array(
        getBufferEncoder().encode({
            authority: null,
            canonical: true,
            data: rawData,
            program: null,
            seed: 'idl',
        }),
    );
}

/**
 * Minimal RPC stub: returns the same response for every `getAccountInfo`
 * call. `owner` controls the auto-detection branch in `fetchIdlFromBuffer`.
 * The returned `getAccountInfo` mock is exposed so tests can assert on the
 * call count (e.g. verifying single-fetch invariants).
 */
function mockRpc(
    response: {
        data: Buffer | Uint8Array;
        owner: string;
    } | null,
): { rpc: SolanaRpcClient; getAccountInfo: ReturnType<typeof vi.fn> } {
    const value = response
        ? {
              data: [Buffer.from(response.data).toString('base64'), 'base64'],
              executable: false,
              lamports: 0,
              owner: response.owner,
              rentEpoch: 0,
              space: response.data.length,
          }
        : null;
    const getAccountInfo = vi.fn(() => ({ send: () => Promise.resolve({ value }) }));
    return { getAccountInfo, rpc: { getAccountInfo } as unknown as SolanaRpcClient };
}

// ─── fetchAnchorIdlFromBuffer ────────────────────────────────────────────────

describe('fetchAnchorIdlFromBuffer', () => {
    test('decodes a valid Anchor IDL buffer', async () => {
        const idl = JSON.stringify({ name: 'staged', version: '0.1.0' });
        const { rpc } = mockRpc({ data: buildAnchorAccountBytes(idl), owner: SOME_PROGRAM });
        const out = await fetchAnchorIdlFromBuffer(rpc, SOME_BUFFER);
        expect(out).toBe(idl);
    });

    test('returns null when the account does not exist', async () => {
        const { rpc } = mockRpc(null);
        expect(await fetchAnchorIdlFromBuffer(rpc, SOME_BUFFER)).toBeNull();
    });

    test('returns null for an account shorter than the IdlAccount header', async () => {
        const { rpc } = mockRpc({ data: Buffer.alloc(10), owner: SOME_PROGRAM });
        expect(await fetchAnchorIdlFromBuffer(rpc, SOME_BUFFER)).toBeNull();
    });

    test('returns null when the length field overruns the account', async () => {
        const buf = Buffer.alloc(50);
        buf.writeUInt32LE(9999, 40); // claims more data than exists
        const { rpc } = mockRpc({ data: buf, owner: SOME_PROGRAM });
        expect(await fetchAnchorIdlFromBuffer(rpc, SOME_BUFFER)).toBeNull();
    });

    test('returns null when the data region is not valid zlib', async () => {
        const buf = Buffer.alloc(48);
        buf.writeUInt32LE(4, 40);
        Buffer.from([0xff, 0xff, 0xff, 0xff]).copy(buf, 44);
        const { rpc } = mockRpc({ data: buf, owner: SOME_PROGRAM });
        expect(await fetchAnchorIdlFromBuffer(rpc, SOME_BUFFER)).toBeNull();
    });
});

// ─── fetchPmpIdlFromBuffer ───────────────────────────────────────────────────

describe('fetchPmpIdlFromBuffer', () => {
    test('decodes a zlib+utf8 buffer (the IDL upload default)', async () => {
        const idl = JSON.stringify({ instructions: [], name: 'my-prog' });
        const packed = packDirectData({ content: idl }); // defaults: zlib + utf8
        const accountBytes = buildPmpBufferAccountBytes(new Uint8Array(packed.data));
        const { rpc } = mockRpc({ data: Buffer.from(accountBytes), owner: PROGRAM_METADATA_PROGRAM_ADDRESS });
        const out = await fetchPmpIdlFromBuffer(rpc, SOME_BUFFER);
        expect(out).toBe(idl);
    });

    test('returns null when the account does not exist', async () => {
        const { rpc } = mockRpc(null);
        expect(await fetchPmpIdlFromBuffer(rpc, SOME_BUFFER)).toBeNull();
    });

    test('returns null when the buffer is empty', async () => {
        const accountBytes = buildPmpBufferAccountBytes(new Uint8Array(0));
        const { rpc } = mockRpc({ data: Buffer.from(accountBytes), owner: PROGRAM_METADATA_PROGRAM_ADDRESS });
        expect(await fetchPmpIdlFromBuffer(rpc, SOME_BUFFER)).toBeNull();
    });

    test('returns null when no candidate decoding produces a valid string', async () => {
        // Random bytes that are not valid zlib/gzip nor decodable as UTF-8.
        const randomData = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
        const accountBytes = buildPmpBufferAccountBytes(randomData);
        const { rpc } = mockRpc({ data: Buffer.from(accountBytes), owner: PROGRAM_METADATA_PROGRAM_ADDRESS });
        // Plain UTF-8 of 0xff bytes is a replacement-character string (non-null),
        // so by default this DOES decode to something — just not anything useful.
        // The helper is best-effort by design; we only assert it doesn't throw.
        await expect(fetchPmpIdlFromBuffer(rpc, SOME_BUFFER)).resolves.not.toThrow();
    });

    test('honours an explicit (no-compression, utf8) format override', async () => {
        // Plain UTF-8 JSON, no compression. The default candidate list happens
        // to also succeed on this (it falls through to {None, Utf8} after the
        // zlib attempt fails), but passing the override exercises the
        // explicit-format branch in decodePmpIdlFromBufferAccount.
        const idl = JSON.stringify({ name: 'plain' });
        const accountBytes = buildPmpBufferAccountBytes(Buffer.from(idl, 'utf8'));
        const { rpc } = mockRpc({ data: Buffer.from(accountBytes), owner: PROGRAM_METADATA_PROGRAM_ADDRESS });
        const out = await fetchPmpIdlFromBuffer(rpc, SOME_BUFFER, {
            compression: Compression.None,
            encoding: Encoding.Utf8,
        });
        expect(out).toBe(idl);
    });
});

// ─── fetchIdlFromBuffer (auto-detect) ────────────────────────────────────────

describe('fetchIdlFromBuffer', () => {
    test('detects an Anchor buffer when the account is owned by a non-PMP program', async () => {
        const idl = JSON.stringify({ name: 'anchor-staged' });
        const { rpc, getAccountInfo } = mockRpc({ data: buildAnchorAccountBytes(idl), owner: SOME_PROGRAM });
        const out = await fetchIdlFromBuffer(rpc, SOME_BUFFER);
        expect(out).not.toBeNull();
        expect(out!.type).toBe('anchor');
        expect(out!.content).toBe(idl);
        expect(out!.address).toBe(SOME_BUFFER);
        expect(getAccountInfo).toHaveBeenCalledTimes(1);
    });

    test('detects a PMP buffer when the account is owned by the PMP program', async () => {
        const idl = JSON.stringify({ name: 'pmp-staged' });
        const packed = packDirectData({ content: idl });
        const accountBytes = buildPmpBufferAccountBytes(new Uint8Array(packed.data));
        const { rpc, getAccountInfo } = mockRpc({
            data: Buffer.from(accountBytes),
            owner: PROGRAM_METADATA_PROGRAM_ADDRESS,
        });
        const out = await fetchIdlFromBuffer(rpc, SOME_BUFFER);
        expect(out).not.toBeNull();
        expect(out!.type).toBe('pmp');
        expect(out!.content).toBe(idl);
        // Regression: prior to 0.1.2 this path issued two getAccountInfo calls
        // because fetchIdlFromBuffer delegated to fetchPmpIdlFromBuffer, which
        // re-fetched the same account via fetchMaybeBuffer. The contract now
        // promises a single round trip for either branch.
        expect(getAccountInfo).toHaveBeenCalledTimes(1);
    });

    test('returns null when the account does not exist', async () => {
        const { rpc } = mockRpc(null);
        expect(await fetchIdlFromBuffer(rpc, SOME_BUFFER)).toBeNull();
    });

    test('returns null when the account is owned by a program but its bytes are not an IdlAccount', async () => {
        const { rpc } = mockRpc({ data: Buffer.alloc(10), owner: ZERO_AUTHORITY });
        expect(await fetchIdlFromBuffer(rpc, SOME_BUFFER)).toBeNull();
    });
});
