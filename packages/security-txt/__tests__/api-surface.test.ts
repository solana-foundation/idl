import { describe, expect, test } from 'vitest';

import {
    fetchElfSecurityTxt,
    fetchPmpSecurityTxt,
    fetchSecurityTxt,
    findPmpSecurityTxtAddress,
    SECURITY_TXT_PMP_SEED,
} from '../src/index.js';

/**
 * The library is intentionally stubbed at v0.0.0 — the public surface is
 * locked but the bodies throw `not yet implemented`. These tests pin the
 * shape so we don't accidentally rename or remove an export before the real
 * implementation lands. Replace the `throws` assertions with behavioural
 * tests as each function gets a real body.
 */
describe('@solana/security-txt public surface', () => {
    test('SECURITY_TXT_PMP_SEED is "security.txt"', () => {
        expect(SECURITY_TXT_PMP_SEED).toBe('security.txt');
    });

    test('findPmpSecurityTxtAddress is implemented (real, not stub)', async () => {
        // Bitcoin Genesis vibes — any valid address works since it's pure PDA derivation.
        const pda = await findPmpSecurityTxtAddress('11111111111111111111111111111111' as never);
        expect(typeof pda).toBe('string');
        expect((pda as string).length).toBeGreaterThan(0);
    });

    test('fetchSecurityTxt stub throws not-yet-implemented', async () => {
        await expect(
            fetchSecurityTxt(null as never, '11111111111111111111111111111111' as never),
        ).rejects.toThrow(/not yet implemented/);
    });

    test('fetchPmpSecurityTxt stub throws not-yet-implemented', async () => {
        await expect(
            fetchPmpSecurityTxt(null as never, '11111111111111111111111111111111' as never),
        ).rejects.toThrow(/not yet implemented/);
    });

    test('fetchElfSecurityTxt stub throws not-yet-implemented', async () => {
        await expect(
            fetchElfSecurityTxt(null as never, '11111111111111111111111111111111' as never),
        ).rejects.toThrow(/not yet implemented/);
    });
});
