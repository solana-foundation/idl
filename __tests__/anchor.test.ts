import { describe, expect, test } from 'bun:test';

import { address, isAddress } from '@solana/kit';

import { findAnchorIdlAddress } from '../src/anchor.js';

// Stable, well-known programs with deterministic Anchor IDL PDAs.
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SYSVAR_RENT = address('SysvarRent111111111111111111111111111111111');

describe('findAnchorIdlAddress', () => {
    test('is deterministic for a given program id', async () => {
        const a = await findAnchorIdlAddress(TOKEN_PROGRAM);
        const b = await findAnchorIdlAddress(TOKEN_PROGRAM);
        expect(a).toBe(b);
    });

    test('produces a different address for a different program id', async () => {
        const a = await findAnchorIdlAddress(TOKEN_PROGRAM);
        const b = await findAnchorIdlAddress(SYSVAR_RENT);
        expect(a).not.toBe(b);
    });

    test('returns a valid base58 address', async () => {
        const addr = await findAnchorIdlAddress(TOKEN_PROGRAM);
        expect(isAddress(addr)).toBe(true);
    });
});
