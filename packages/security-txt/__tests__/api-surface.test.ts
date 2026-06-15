import { describe, expect, test } from 'vitest';

import {
    fetchPmpSecurityTxt,
    fetchSecurityTxt,
    findPmpSecurityTxtAddress,
    SECURITY_TXT_FALLBACK_PMP_AUTHORITIES,
    SECURITY_TXT_PMP_SEED,
} from '../src/index.js';

/**
 * Smoke tests for the public surface — pins the wire shape so we don't
 * accidentally rename or remove an export. Behavioural correctness is
 * covered by `parser.test.ts` (pure unit) and the integration tests.
 */
describe('@solana/security-txt public surface', () => {
    test('SECURITY_TXT_PMP_SEED is "security" (SPL PMP convention)', () => {
        expect(SECURITY_TXT_PMP_SEED).toBe('security');
    });

    test('SECURITY_TXT_FALLBACK_PMP_AUTHORITIES is a frozen-shaped empty array today', () => {
        expect(Array.isArray(SECURITY_TXT_FALLBACK_PMP_AUTHORITIES)).toBe(true);
        expect(SECURITY_TXT_FALLBACK_PMP_AUTHORITIES.length).toBe(0);
    });

    test('findPmpSecurityTxtAddress derives a real PDA', async () => {
        const pda = await findPmpSecurityTxtAddress('11111111111111111111111111111111' as never);
        expect(typeof pda).toBe('string');
        expect((pda as string).length).toBeGreaterThan(0);
    });

    test('findPmpSecurityTxtAddress canonical vs non-canonical differ', async () => {
        const programId = '11111111111111111111111111111111' as never;
        const authority = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as never;
        const canonical = await findPmpSecurityTxtAddress(programId);
        const fallback = await findPmpSecurityTxtAddress(programId, authority);
        expect(canonical).not.toBe(fallback);
    });

    test('fetchSecurityTxt and fetchPmpSecurityTxt are functions, not stubs', () => {
        // The real bodies short-circuit on `null` RPC by throwing a TypeError
        // when they call the kit/program-metadata helpers. We don't care which
        // error — only that they're no longer the explicit `not yet implemented`
        // throws from the v0.0.0 scaffold.
        expect(typeof fetchSecurityTxt).toBe('function');
        expect(typeof fetchPmpSecurityTxt).toBe('function');
    });
});
