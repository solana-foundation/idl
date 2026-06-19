import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { address } from '@solana/kit';
import { fetchEncodedAccount } from '@solana/kit';
import { describe, expect, it } from 'vitest';

import { fetchAnchorIdlFromBuffer, fetchIdlFromBuffer } from '../../src/current-idl.js';
import { decodePmpIdlFromBufferAccount, fetchPmpIdlFromBuffer } from '../../src/pmp-idl.js';
import { makeFakeRpc } from '../fixtures/_helpers/fake-rpc.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(HERE, '../fixtures');

/**
 * Locate every buffer fixture bucket (a directory under `__tests__/fixtures/`
 * that contains both `buffer-address.txt` and `source-idl.json`). Seeded by
 * `scripts/seed-pmp-buffer.ts`, which actually writes the IDL to a real PMP
 * buffer on devnet and snapshots the on-chain account state — so these tests
 * exercise the genuine byte layout, not a hand-crafted simulation like the
 * unit tests in `__tests__/buffer.test.ts`.
 */
function listBufferFixtures(): Array<{ address: string; bucket: string; sourceIdl: string }> {
    return readdirSync(FIXTURES_ROOT)
        .map(name => path.join(FIXTURES_ROOT, name))
        .filter(dir => statSync(dir).isDirectory())
        .map(dir => {
            const addrPath = path.join(dir, 'buffer-address.txt');
            const idlPath = path.join(dir, 'source-idl.json');
            try {
                return {
                    address: readFileSync(addrPath, 'utf8').trim(),
                    bucket: dir,
                    sourceIdl: readFileSync(idlPath, 'utf8'),
                };
            } catch {
                return null;
            }
        })
        .filter((entry): entry is { address: string; bucket: string; sourceIdl: string } => entry !== null);
}

const bufferFixtures = listBufferFixtures();

describe.skipIf(bufferFixtures.length === 0)('fetchIdlFromBuffer (real on-chain buffer)', () => {
    it.each(bufferFixtures)('round-trips the IDL for $address', async ({ address: addr, bucket, sourceIdl }) => {
        const rpc = makeFakeRpc(bucket);
        const result = await fetchIdlFromBuffer(rpc, address(addr));

        expect(result.status).toBe('ok');
        if (result.status === 'ok') {
            expect(result.source).toBe('pmp');
            expect(result.address).toBe(addr);
            // Byte-for-byte equality: anything else means the round-trip
            // (encode → zlib → on-chain bytes → fetch → unzlib → decode) lost
            // or mutated content.
            expect(result.content).toBe(sourceIdl);
        }
    });

    it.each(bufferFixtures)(
        'fetchPmpIdlFromBuffer agrees with fetchIdlFromBuffer for $address',
        async ({ address: addr, bucket, sourceIdl }) => {
            const rpc = makeFakeRpc(bucket);
            const result = await fetchPmpIdlFromBuffer(rpc, address(addr));
            expect(result.status === 'ok' && result.content).toBe(sourceIdl);
        },
    );

    it.each(bufferFixtures)(
        'Anchor decoder rejects the PMP-owned buffer for $address',
        async ({ address: addr, bucket }) => {
            const rpc = makeFakeRpc(bucket);
            const result = await fetchAnchorIdlFromBuffer(rpc, address(addr));
            // PMP buffer bytes don't satisfy the Anchor IdlAccount layout
            // (8-byte disc + 32-byte authority + u32 len + zlib blob), so the
            // Anchor decoder should bail (corrupt) rather than return garbage.
            expect(result.status).not.toBe('ok');
        },
    );

    it.each(bufferFixtures)(
        'decodePmpIdlFromBufferAccount works on pre-fetched bytes for $address (no extra RPC)',
        async ({ address: addr, bucket, sourceIdl }) => {
            const rpc = makeFakeRpc(bucket);
            const account = await fetchEncodedAccount(rpc, address(addr));
            expect(account.exists).toBe(true);

            // After the single fetch, decode is pure. This is the exact
            // path fetchIdlFromBuffer uses internally to deliver on its
            // "one getAccountInfo call" contract — the same contract the
            // 0.1.2 PR review flagged when it was broken.
            const before = rpc.__stats().calls.length;
            const decoded = account.exists ? decodePmpIdlFromBufferAccount(account) : { ok: false as const };
            const after = rpc.__stats().calls.length;

            expect(decoded.ok).toBe(true);
            if (decoded.ok) expect(decoded.content).toBe(sourceIdl);
            expect(after).toBe(before);
        },
    );
});
