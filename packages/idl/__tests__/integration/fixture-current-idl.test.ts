import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';

import { fetchAnchorIdl, fetchIdl, fetchIdlWrapped } from '../../src/current-idl.js';
import { fetchPmpIdl, IDL_FALLBACK_PMP_AUTHORITIES } from '../../src/pmp-idl.js';
import { makeFakeRpc } from '../fixtures/_helpers/fake-rpc.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const BUYUX = 'BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya' as Address;
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as Address;
const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' as Address;
const FALLBACK_FNDN = IDL_FALLBACK_PMP_AUTHORITIES[0]!;

const fixturesDir = (slug: string): string => path.resolve(HERE, '../fixtures', slug);

describe('fetchIdl / fetchIdlWrapped', () => {
    it('resolves the canonical PMP IDL for BUYux on mainnet', async () => {
        const rpc = makeFakeRpc(fixturesDir(`${BUYUX}-mainnet-beta`));

        const wrapped = await fetchIdlWrapped(rpc, BUYUX);
        expect(wrapped.status).toBe('ok');
        if (wrapped.status === 'ok') expect(wrapped.source).toBe('pmp');

        // fetchIdl returns the parsed IDL object directly (T | null).
        const idl = await fetchIdl(rpc, BUYUX);
        expect(idl).not.toBeNull();
        expect(typeof idl).toBe('object');
    });

    it('falls back to the fndn authority for TokenkegQ on devnet', async () => {
        const rpc = makeFakeRpc(fixturesDir(`${TOKEN}-devnet`));

        const wrapped = await fetchIdlWrapped(rpc, TOKEN);
        expect(wrapped.status).toBe('ok');
        if (wrapped.status === 'ok') expect(wrapped.source).toBe('pmp');

        const idl = await fetchIdl(rpc, TOKEN);
        expect(idl).not.toBeNull();
        expect(typeof idl).toBe('object');
    });

    it('falls back to Anchor for Jupiter v6 on mainnet (no PMP published)', async () => {
        const rpc = makeFakeRpc(fixturesDir(`${JUPITER}-mainnet-beta`));

        const wrapped = await fetchIdlWrapped(rpc, JUPITER);
        expect(wrapped.status).toBe('ok');
        if (wrapped.status === 'ok') expect(wrapped.source).toBe('anchor');

        const idl = await fetchIdl(rpc, JUPITER);
        expect(idl).not.toBeNull();
        expect(JSON.stringify(idl)).toMatch(/jupiter/i);
    });
});

describe('fetchPmpIdl', () => {
    it('resolves canonical PMP without consulting the fndn fallback for BUYux', async () => {
        const rpc = makeFakeRpc(fixturesDir(`${BUYUX}-mainnet-beta`));

        const resolved = await fetchPmpIdl(rpc, BUYUX, { seed: 'idl' });

        expect(resolved.status).toBe('ok');
        if (resolved.status === 'ok') {
            expect(resolved.authority).toBeNull();
            expect(resolved.content.length).toBeGreaterThan(0);
            expect(typeof resolved.address).toBe('string');
        }
    });

    it('resolves PMP via the fndn fallback authority for TokenkegQ', async () => {
        const rpc = makeFakeRpc(fixturesDir(`${TOKEN}-devnet`));

        const resolved = await fetchPmpIdl(rpc, TOKEN, { seed: 'idl' });

        expect(resolved.status).toBe('ok');
        if (resolved.status === 'ok') {
            expect(resolved.authority).toBe(FALLBACK_FNDN);
            expect(resolved.content.length).toBeGreaterThan(0);
        }
    });
});

describe('fetchAnchorIdl', () => {
    it('returns ok with valid JSON content for BUYux on mainnet', async () => {
        const rpc = makeFakeRpc(fixturesDir(`${BUYUX}-mainnet-beta`));

        const anchor = await fetchAnchorIdl(rpc, BUYUX);

        expect(anchor.status).toBe('ok');
        if (anchor.status === 'ok') {
            const parsed = JSON.parse(anchor.content) as { instructions?: unknown };
            expect(Array.isArray(parsed.instructions)).toBe(true);
            expect(typeof anchor.address).toBe('string');
        }
    });

    it('returns absent when no Anchor IDL is published (Token on devnet)', async () => {
        const rpc = makeFakeRpc(fixturesDir(`${TOKEN}-devnet`));

        expect((await fetchAnchorIdl(rpc, TOKEN)).status).toBe('absent');
    });
});
