import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';

import { findAnchorIdlAddress } from '../../src/anchor.js';
import { fetchAllHistories } from '../../src/history.js';
import { buildPmpIdlLookups } from '../../src/pmp-idl.js';
import { makeFakeRpc } from '../fixtures/_helpers/fake-rpc.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const BUYUX = 'BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya' as Address;
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as Address;
const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' as Address;

const fixturesDir = (slug: string): string => path.resolve(HERE, '../fixtures', slug);

describe('fetchAllHistories', () => {
    it('returns both PMP and Anchor histories side-by-side for BUYux', async () => {
        const rpc = makeFakeRpc(fixturesDir(`${BUYUX}-mainnet-beta`));

        const result = await fetchAllHistories(rpc, BUYUX);

        expect(result.programId).toBe(BUYUX);

        // Anchor address matches the derived PDA.
        const expectedAnchor = await findAnchorIdlAddress(BUYUX);
        expect(result.anchorAddress).toBe(expectedAnchor);

        // PMP address matches the canonical PDA (BUYux uploads canonically).
        const lookups = await buildPmpIdlLookups(BUYUX, 'idl');
        const canonical = lookups.find(l => l.authority === null)!;
        expect(result.pmpAddress).toBe(canonical.address);

        // Both histories non-empty. Counts must match the single-source helpers.
        expect(result.pmp.length).toBeGreaterThan(0);
        expect(result.anchor.length).toBeGreaterThan(0);
        expect(result.pmp).toHaveLength(3);
        expect(result.anchor).toHaveLength(22);

        // Snapshots are chronologically ordered.
        for (let i = 1; i < result.pmp.length; i++) {
            expect(result.pmp[i]!.slot >= result.pmp[i - 1]!.slot).toBe(true);
        }
        for (let i = 1; i < result.anchor.length; i++) {
            expect(result.anchor[i]!.slot >= result.anchor[i - 1]!.slot).toBe(true);
        }
    });

    it('falls back to the fndn PMP authority and returns empty Anchor for TokenkegQ', async () => {
        const rpc = makeFakeRpc(fixturesDir(`${TOKEN}-devnet`));

        const result = await fetchAllHistories(rpc, TOKEN);

        expect(result.programId).toBe(TOKEN);
        expect(result.pmp.length).toBeGreaterThan(0);
        expect(result.anchor).toHaveLength(0);

        // pmpAddress should be the fallback PDA, not the canonical one.
        const lookups = await buildPmpIdlLookups(TOKEN, 'idl');
        const canonical = lookups.find(l => l.authority === null)!;
        const fallback = lookups.find(l => l.authority !== null)!;
        expect(result.pmpAddress).toBe(fallback.address);
        expect(result.pmpAddress).not.toBe(canonical.address);
    });

    it('returns empty PMP and a non-empty Anchor for Jupiter v6 on mainnet', async () => {
        const rpc = makeFakeRpc(fixturesDir(`${JUPITER}-mainnet-beta`));

        const result = await fetchAllHistories(rpc, JUPITER);

        expect(result.programId).toBe(JUPITER);
        expect(result.pmp).toHaveLength(0);
        expect(result.anchor.length).toBeGreaterThan(0);

        // pmpAddress falls back to the canonical PDA when no PMP history exists.
        const lookups = await buildPmpIdlLookups(JUPITER, 'idl');
        const canonical = lookups.find(l => l.authority === null)!;
        expect(result.pmpAddress).toBe(canonical.address);
    });
});
