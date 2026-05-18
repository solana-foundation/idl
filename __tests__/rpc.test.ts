import { describe, expect, mock, test } from 'bun:test';

import { isAddress } from '@solana/kit';

import {
    flattenInstructions,
    fromBase58,
    rawBytesToAddress,
    readU32LE,
    resolveAccountKeys,
    writeChunk,
    withRetry,
    type ParsedTx,
} from '../src/rpc.js';

describe('readU32LE', () => {
    test.each([
        { bytes: [0, 0, 0, 0], expected: 0, label: 'zero', offset: 0 },
        { bytes: [0xff, 0xff, 0xff, 0xff], expected: 0xffffffff, label: 'max u32', offset: 0 },
        { bytes: [0x78, 0x56, 0x34, 0x12], expected: 0x12345678, label: 'little-endian ordering', offset: 0 },
        { bytes: [0xaa, 0xbb, 0x01, 0x00, 0x00, 0x00], expected: 1, label: 'honors offset', offset: 2 },
    ])('$label', ({ bytes, offset, expected }) => {
        expect(readU32LE(new Uint8Array(bytes), offset)).toBe(expected);
    });
});

describe('fromBase58', () => {
    test('decodes an empty string to empty array', () => {
        expect(fromBase58('').length).toBe(0);
    });

    test('decodes a known base58 string', () => {
        // "Hello" base58 = "9Ajdvzr"
        expect(new TextDecoder().decode(fromBase58('9Ajdvzr'))).toBe('Hello');
    });

    test('returns empty on invalid input rather than throwing', () => {
        expect(fromBase58('0OIl').length).toBe(0);
    });
});

describe('writeChunk', () => {
    const cases: Array<{ dst: number; expected: number[]; initial: number[]; label: string; src: number[] }> = [
        { dst: 0, expected: [1, 2, 3], initial: [], label: 'writes into zero-length buffer', src: [1, 2, 3] },
        { dst: 3, expected: [9, 9, 0, 1, 2], initial: [9, 9], label: 'writes at offset, growing', src: [1, 2] },
        { dst: 1, expected: [1, 9, 3, 4], initial: [1, 2, 3, 4], label: 'overwrites existing bytes', src: [9] },
    ];
    test.each(cases)('$label', ({ initial, src, dst, expected }) => {
        const out = writeChunk(
            new Uint8Array(initial) as Uint8Array<ArrayBuffer>,
            new Uint8Array(src) as Uint8Array<ArrayBuffer>,
            dst,
        );
        expect(Array.from(out)).toEqual(expected);
    });
});

describe('rawBytesToAddress', () => {
    test('returns a valid base58 Address from a 32-byte slice', () => {
        const bytes = new Uint8Array(32).fill(0x11) as Uint8Array<ArrayBuffer>;
        expect(isAddress(rawBytesToAddress(bytes, 0))).toBe(true);
    });
});

function mkTx(over: Partial<ParsedTx> = {}): ParsedTx {
    return {
        blockTime: null,
        meta: null,
        slot: 1n,
        transaction: { message: { accountKeys: ['A', 'B'], instructions: [] } },
        ...over,
    };
}

describe('resolveAccountKeys', () => {
    test('returns static keys when no loaded addresses', () => {
        expect(resolveAccountKeys(mkTx())).toEqual(['A', 'B']);
    });

    test('appends ALT writable then readonly keys', () => {
        const keys = resolveAccountKeys(
            mkTx({
                meta: {
                    err: null,
                    loadedAddresses: { readonly: ['R1', 'R2'], writable: ['W1'] },
                },
            }),
        );
        expect(keys).toEqual(['A', 'B', 'W1', 'R1', 'R2']);
    });
});

describe('flattenInstructions', () => {
    test('returns outer instructions when no inner ones', () => {
        const tx = mkTx({
            transaction: {
                message: {
                    accountKeys: ['A'],
                    instructions: [{ accounts: [], data: '', programIdIndex: 0 }],
                },
            },
        });
        expect(flattenInstructions(tx)).toHaveLength(1);
    });

    test('interleaves inner instructions after their outer parent', () => {
        const tx = mkTx({
            meta: {
                err: null,
                innerInstructions: [
                    {
                        index: 0,
                        instructions: [{ accounts: [], data: 'inner0', programIdIndex: 0 }],
                    },
                ],
            },
            transaction: {
                message: {
                    accountKeys: ['A'],
                    instructions: [
                        { accounts: [], data: 'outer0', programIdIndex: 0 },
                        { accounts: [], data: 'outer1', programIdIndex: 0 },
                    ],
                },
            },
        });
        expect(flattenInstructions(tx).map(i => i.data)).toEqual(['outer0', 'inner0', 'outer1']);
    });
});

describe('withRetry', () => {
    test('returns immediately on success', async () => {
        const fn = mock(() => Promise.resolve(42));
        expect(await withRetry(fn)).toBe(42);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    test('rethrows non-429 errors without retrying', async () => {
        const fn = mock(() => Promise.reject(new Error('boom')));
        // oxlint-disable-next-line typescript/await-thenable -- bun's expect(...).rejects returns a Thenable.
        await expect(withRetry(fn)).rejects.toThrow('boom');
        expect(fn).toHaveBeenCalledTimes(1);
    });
});
