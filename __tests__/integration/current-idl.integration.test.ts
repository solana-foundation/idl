/**
 * Integration tests against a live RPC.
 *
 * Skipped unless `RPC_URL` (or `SOLANA_RPC_URL`) is set in the environment. The
 * RPC must be mainnet-beta — the Program Metadata Program is not deployed on
 * testnet/devnet for every fixture below.
 *
 *   RPC_URL=https://api.mainnet-beta.solana.com bun test __tests__/integration
 */
import { describe, expect, test } from 'bun:test';

import { address, createSolanaRpc } from '@solana/kit';

import { fetchCurrentIdlPreferPmp } from '../../src/current-idl.js';

const RPC_URL = process.env.RPC_URL ?? process.env.SOLANA_RPC_URL;

const FIXTURES: Array<{ expectName: RegExp; name: string; programId: string }> = [
    {
        expectName: /jupiter/i,
        name: 'Jupiter v6 (Anchor)',
        programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    },
];

describe.skipIf(!RPC_URL)('integration: fetchCurrentIdlPreferPmp', () => {
    test.each(FIXTURES)(
        '$name: resolves to a parsed IDL',
        async fixture => {
            const rpc = createSolanaRpc(RPC_URL!);
            const out = await fetchCurrentIdlPreferPmp(rpc, address(fixture.programId));
            expect(out).not.toBeNull();
            expect(['pmp', 'anchor']).toContain(out!.type);
            expect(out!.programId).toBe(fixture.programId);
            const haystack = typeof out!.idl === 'string' ? out!.idl : JSON.stringify(out!.idl);
            expect(haystack).toMatch(fixture.expectName);
        },
        60_000,
    );
});
