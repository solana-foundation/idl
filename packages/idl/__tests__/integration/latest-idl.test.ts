import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';

import { findAnchorIdlAddress } from '../../src/anchor.js';
import { fetchLatestIdls } from '../../src/latest-idl.js';
import { buildPmpIdlLookups } from '../../src/pmp-idl.js';
import { makeFakeRpc } from '../fixtures/_helpers/fake-rpc.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUYUX = 'BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya' as Address;
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as Address;

const fixturesDir = (slug: string): string => path.resolve(HERE, '../fixtures', slug);

describe('fetchLatestIdls', () => {
    it('returns PMP + Anchor side-by-side with parsed version for BUYux', async () => {
        const rpc = makeFakeRpc(fixturesDir(`${BUYUX}-mainnet-beta`));

        const result = await fetchLatestIdls(rpc, BUYUX);

        expect(result.programId).toBe(BUYUX);

        // Anchor address matches the derived PDA.
        const expectedAnchor = await findAnchorIdlAddress(BUYUX);
        expect(result.anchorAddress).toBe(expectedAnchor);

        // PMP address matches the canonical PDA (since BUYux uploaded canonically).
        const lookups = await buildPmpIdlLookups(BUYUX, 'idl');
        const canonical = lookups.find(l => l.authority === null)!;
        expect(result.pmpAddress).toBe(canonical.address);

        // Both sources present, each as a single-element array.
        expect(result.pmp).toHaveLength(1);
        expect(result.anchor).toHaveLength(1);

        const pmp = result.pmp[0]!;
        const anchor = result.anchor[0]!;

        expect(pmp.type).toBe('pmp');
        expect(anchor.type).toBe('anchor');
        expect(pmp.version).toBe('0.1.0');
        expect(anchor.version).toBe('0.1.0');

        // Anchor content always parses as JSON; PMP content for BUYux too.
        expect(() => JSON.parse(pmp.content)).not.toThrow();
        expect(() => JSON.parse(anchor.content)).not.toThrow();

        // No slot/time/activeFrom on the latest path — accurate publish
        // timing is the history path's job (see fetchAllHistories).
        expect(pmp).not.toHaveProperty('slot');
        expect(pmp).not.toHaveProperty('time');
        expect(pmp).not.toHaveProperty('activeFrom');
        expect(pmp).not.toHaveProperty('activeTo');
    });

    it('returns PMP only (via fndn fallback) and an empty anchor[] for TokenkegQ', async () => {
        const rpc = makeFakeRpc(fixturesDir(`${TOKEN}-devnet`));

        const result = await fetchLatestIdls(rpc, TOKEN);

        expect(result.programId).toBe(TOKEN);
        expect(result.pmp).toHaveLength(1);
        expect(result.anchor).toHaveLength(0);

        // pmpAddress should be the fallback PDA, NOT the canonical one,
        // because Token uploaded under the fndn authority on devnet.
        const lookups = await buildPmpIdlLookups(TOKEN, 'idl');
        const canonical = lookups.find(l => l.authority === null)!;
        const fallback = lookups.find(l => l.authority !== null)!;
        expect(result.pmpAddress).toBe(fallback.address);
        expect(result.pmpAddress).not.toBe(canonical.address);

        const pmp = result.pmp[0]!;
        expect(pmp.type).toBe('pmp');
        expect(pmp.version).not.toBeNull();
        expect(() => JSON.parse(pmp.content)).not.toThrow();
    });
});
