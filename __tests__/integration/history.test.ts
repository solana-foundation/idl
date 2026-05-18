import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Address } from '@solana/kit';

import { reconstructAnchorHistory } from '../../src/anchor.js';
import { IDL_FALLBACK_PMP_AUTHORITY } from '../../src/pmp-idl.js';
import { reconstructPmpHistory } from '../../src/program-metadata.js';
import { makeFakeRpc } from '../fixtures/_helpers/fake-rpc.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const BUYUX = 'BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya' as Address;
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as Address;

const fixturesDir = (slug: string): string => path.resolve(HERE, '../fixtures', slug);

describe('reconstructPmpHistory', () => {
    it('returns canonical PMP history for BUYux on mainnet', async () => {
        const rpc = makeFakeRpc(fixturesDir(`${BUYUX}-mainnet-beta`));

        const snapshots = await reconstructPmpHistory(rpc, BUYUX);

        expect(snapshots).toHaveLength(3);
        for (const snap of snapshots) {
            expect(typeof snap.signature).toBe('string');
            expect(snap.signature.length).toBeGreaterThan(0);
            expect(typeof snap.slot).toBe('bigint');
        }
        // Slots must be non-decreasing in chronological order.
        for (let i = 1; i < snapshots.length; i++) {
            expect(snapshots[i]!.slot >= snapshots[i - 1]!.slot).toBe(true);
        }
        // The latest snapshot's decoded content should be present and parseable JSON.
        const last = snapshots[snapshots.length - 1]!;
        expect(last.decodedContent).not.toBeNull();
        expect(() => JSON.parse(last.decodedContent as string)).not.toThrow();
    });

    it('returns 0 snapshots on the unused fndn fallback PDA for BUYux', async () => {
        const rpc = makeFakeRpc(fixturesDir(`${BUYUX}-mainnet-beta`));

        const snapshots = await reconstructPmpHistory(rpc, BUYUX, {
            authority: IDL_FALLBACK_PMP_AUTHORITY,
        });

        expect(snapshots).toHaveLength(0);
    });

    it('returns fndn-uploaded PMP history for TokenkegQ on devnet', async () => {
        const rpc = makeFakeRpc(fixturesDir(`${TOKEN}-devnet`));

        const snapshots = await reconstructPmpHistory(rpc, TOKEN, {
            authority: IDL_FALLBACK_PMP_AUTHORITY,
        });

        expect(snapshots).toHaveLength(11);
        for (let i = 1; i < snapshots.length; i++) {
            expect(snapshots[i]!.slot >= snapshots[i - 1]!.slot).toBe(true);
        }
    });

    it('returns 0 snapshots on the canonical PDA for TokenkegQ (no canonical upload)', async () => {
        const rpc = makeFakeRpc(fixturesDir(`${TOKEN}-devnet`));

        const snapshots = await reconstructPmpHistory(rpc, TOKEN);

        expect(snapshots).toHaveLength(0);
    });
});

describe('reconstructAnchorHistory', () => {
    it('returns Anchor IDL history for BUYux on mainnet', async () => {
        const rpc = makeFakeRpc(fixturesDir(`${BUYUX}-mainnet-beta`));

        const snapshots = await reconstructAnchorHistory(rpc, BUYUX);

        expect(snapshots).toHaveLength(22);
        for (let i = 1; i < snapshots.length; i++) {
            expect(snapshots[i]!.slot >= snapshots[i - 1]!.slot).toBe(true);
        }
        // History should contain at least two distinct decoded contents
        // (otherwise it wouldn't really be a history worth testing).
        const distinct = new Set(snapshots.map(s => s.decodedContent).filter((c): c is string => c !== null));
        expect(distinct.size).toBeGreaterThan(1);
    });

    it('returns 0 snapshots when no Anchor IDL is published (Token on devnet)', async () => {
        const rpc = makeFakeRpc(fixturesDir(`${TOKEN}-devnet`));

        const snapshots = await reconstructAnchorHistory(rpc, TOKEN);

        expect(snapshots).toHaveLength(0);
    });
});
