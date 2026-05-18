import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Address } from '@solana/kit';

import { fetchAnchorIdl, fetchIdl } from '../../src/current-idl.js';
import { fetchPmpIdl, IDL_FALLBACK_PMP_AUTHORITIES } from '../../src/pmp-idl.js';
import { makeFakeRpc } from '../fixtures/_helpers/fake-rpc.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const BUYUX = 'BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya' as Address;
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as Address;
const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' as Address;
const FALLBACK_FNDN = IDL_FALLBACK_PMP_AUTHORITIES[0]!;

const fixturesDir = (slug: string): string => path.resolve(HERE, '../fixtures', slug);

describe('fetchIdl', () => {
    it('returns the canonical PMP IDL for BUYux on mainnet', async () => {
        const rpc = makeFakeRpc(fixturesDir(`${BUYUX}-mainnet-beta`));

        const result = await fetchIdl(rpc, BUYUX);

        expect(result).not.toBeNull();
        expect(result!.type).toBe('pmp');
        expect(result!.programId).toBe(BUYUX);
        expect(typeof result!.idl).toBe('object');
        expect(result!.idl).not.toBeNull();
    });

    it('falls back to the fndn authority for TokenkegQ on devnet', async () => {
        const rpc = makeFakeRpc(fixturesDir(`${TOKEN}-devnet`));

        const result = await fetchIdl(rpc, TOKEN);

        expect(result).not.toBeNull();
        expect(result!.type).toBe('pmp');
        expect(result!.programId).toBe(TOKEN);
        // Parsed JSON object or a non-empty raw string is acceptable.
        const idl = result!.idl;
        expect(idl === null).toBe(false);
        if (typeof idl === 'string') {
            expect(idl.length).toBeGreaterThan(0);
        } else {
            expect(typeof idl).toBe('object');
        }
    });

    it('falls back to Anchor for Jupiter v6 on mainnet (no PMP published)', async () => {
        const rpc = makeFakeRpc(fixturesDir(`${JUPITER}-mainnet-beta`));

        const result = await fetchIdl(rpc, JUPITER);

        expect(result).not.toBeNull();
        expect(result!.type).toBe('anchor');
        expect(result!.programId).toBe(JUPITER);
        const haystack = typeof result!.idl === 'string' ? result!.idl : JSON.stringify(result!.idl);
        expect(haystack).toMatch(/jupiter/i);
    });
});

describe('fetchPmpIdl', () => {
    it('resolves canonical PMP without consulting the fndn fallback for BUYux', async () => {
        const rpc = makeFakeRpc(fixturesDir(`${BUYUX}-mainnet-beta`));

        const resolved = await fetchPmpIdl(rpc, BUYUX, 'idl');

        expect(resolved).not.toBeNull();
        expect(resolved!.authority).toBeNull();
        expect(resolved!.content.length).toBeGreaterThan(0);
        expect(typeof resolved!.address).toBe('string');
    });

    it('resolves PMP via the fndn fallback authority for TokenkegQ', async () => {
        const rpc = makeFakeRpc(fixturesDir(`${TOKEN}-devnet`));

        const resolved = await fetchPmpIdl(rpc, TOKEN, 'idl');

        expect(resolved).not.toBeNull();
        expect(resolved!.authority).toBe(FALLBACK_FNDN);
        expect(resolved!.content.length).toBeGreaterThan(0);
    });
});

describe('fetchAnchorIdl', () => {
    it('returns valid JSON for BUYux on mainnet', async () => {
        const rpc = makeFakeRpc(fixturesDir(`${BUYUX}-mainnet-beta`));

        const anchor = await fetchAnchorIdl(rpc, BUYUX);

        expect(anchor).not.toBeNull();
        expect(typeof anchor!.content).toBe('string');
        expect(() => JSON.parse(anchor!.content)).not.toThrow();
        const parsed = JSON.parse(anchor!.content) as Record<string, unknown>;
        expect(parsed).toBeTypeOf('object');
        expect(typeof anchor!.address).toBe('string');
    });

    it('returns null when no Anchor IDL is published (Token on devnet)', async () => {
        const rpc = makeFakeRpc(fixturesDir(`${TOKEN}-devnet`));

        const anchor = await fetchAnchorIdl(rpc, TOKEN);

        expect(anchor).toBeNull();
    });
});
