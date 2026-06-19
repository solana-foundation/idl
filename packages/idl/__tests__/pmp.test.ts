import { address, isAddress } from '@solana/kit';
import { describe, expect, test, vi } from 'vitest';

import { buildPmpIdlLookups, fetchPmpIdl, IDL_FALLBACK_PMP_AUTHORITIES } from '../src/pmp-idl.js';
import {
    COMPRESSION_NAME,
    DISC_LABEL,
    ENCODING_NAME,
    FORMAT_NAME,
    PROGRAM_METADATA_PROGRAM_ADDRESS,
    findPmpMetadataAddress,
} from '../src/program-metadata.js';
import type { SolanaRpcClient } from '../src/rpc.js';

const PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const FALLBACK_FNDN = IDL_FALLBACK_PMP_AUTHORITIES[0]!;

describe('findPmpMetadataAddress', () => {
    test('canonical (no authority) is deterministic', async () => {
        const a = await findPmpMetadataAddress(PROGRAM, 'idl');
        const b = await findPmpMetadataAddress(PROGRAM, 'idl', null);
        expect(a).toBe(b);
    });

    test('different seeds produce different PDAs', async () => {
        const a = await findPmpMetadataAddress(PROGRAM, 'idl');
        const b = await findPmpMetadataAddress(PROGRAM, 'custom');
        expect(a).not.toBe(b);
    });

    test('non-canonical (with authority) differs from canonical', async () => {
        const canonical = await findPmpMetadataAddress(PROGRAM, 'idl', null);
        const nonCanonical = await findPmpMetadataAddress(PROGRAM, 'idl', FALLBACK_FNDN);
        expect(canonical).not.toBe(nonCanonical);
    });
});

describe('buildPmpIdlLookups', () => {
    test('default returns canonical + every fndn fallback', async () => {
        const lookups = await buildPmpIdlLookups(PROGRAM, 'idl');
        expect(lookups).toHaveLength(1 + IDL_FALLBACK_PMP_AUTHORITIES.length);
        expect(lookups[0]!.authority).toBeNull();
        for (let i = 0; i < IDL_FALLBACK_PMP_AUTHORITIES.length; i++) {
            expect(lookups[i + 1]!.authority).toBe(IDL_FALLBACK_PMP_AUTHORITIES[i]!);
        }
    });

    test('explicit authority short-circuits to a single lookup', async () => {
        const lookups = await buildPmpIdlLookups(PROGRAM, 'idl', FALLBACK_FNDN);
        expect(lookups).toHaveLength(1);
        expect(lookups[0]!.authority).toBe(FALLBACK_FNDN);
    });

    test('explicit null authority forces canonical-only', async () => {
        const lookups = await buildPmpIdlLookups(PROGRAM, 'idl', null);
        expect(lookups).toHaveLength(1);
        expect(lookups[0]!.authority).toBeNull();
    });
});

describe('PMP constants', () => {
    test('every IDL_FALLBACK_PMP_AUTHORITIES entry is a valid address', () => {
        expect(IDL_FALLBACK_PMP_AUTHORITIES.length).toBeGreaterThan(0);
        for (const a of IDL_FALLBACK_PMP_AUTHORITIES) {
            expect(isAddress(a)).toBe(true);
        }
    });

    test('PROGRAM_METADATA_PROGRAM_ADDRESS is a valid address', () => {
        expect(isAddress(PROGRAM_METADATA_PROGRAM_ADDRESS)).toBe(true);
    });

    test('display tables have expected entries', () => {
        expect(FORMAT_NAME).toEqual(['none', 'json', 'yaml', 'toml']);
        expect(ENCODING_NAME).toEqual(['none', 'utf8', 'base58', 'base64']);
        expect(COMPRESSION_NAME).toEqual(['none', 'gzip', 'zlib']);
        expect(DISC_LABEL).toEqual(['Empty', 'Buffer', 'Metadata']);
    });
});

describe('fetchPmpIdl', () => {
    test('returns absent when no metadata account exists for any lookup', async () => {
        // Every getAccountInfo resolves to a missing account, so each lookup's
        // fetchMetadataContent throws ACCOUNT_NOT_FOUND — classified as absent,
        // never propagated.
        const getAccountInfo = vi.fn(() => ({ send: () => Promise.resolve({ value: null }) }));
        const rpc = { getAccountInfo } as unknown as SolanaRpcClient;
        const out = await fetchPmpIdl(rpc, PROGRAM, { authority: null, seed: 'idl' });
        // absent carries the canonical PMP PDA (the place the IDL would live).
        const canonical = await findPmpMetadataAddress(PROGRAM, 'idl', null);
        expect(out).toEqual({ address: canonical, status: 'absent' });
    });

    test('reports corrupt (NOT a thrown RPC error) for a present-but-undecodable metadata account', async () => {
        // The account exists but its bytes aren't a valid metadata account, so
        // fetchMetadataContent → decodeMetadata throws FAILED_TO_DECODE_ACCOUNT —
        // a SolanaError. The classification must surface that as corrupt(framing),
        // NOT propagate it as if the RPC call had failed (the "throws iff RPC
        // fails" soft spot).
        const value = {
            data: [Buffer.alloc(8).toString('base64'), 'base64'],
            executable: false,
            lamports: 1,
            owner: PROGRAM_METADATA_PROGRAM_ADDRESS,
            rentEpoch: 0,
            space: 8,
        };
        const getAccountInfo = vi.fn(() => ({ send: () => Promise.resolve({ value }) }));
        const rpc = { getAccountInfo } as unknown as SolanaRpcClient;

        const out = await fetchPmpIdl(rpc, PROGRAM, { authority: null, seed: 'idl' });
        expect(out).toMatchObject({ reason: 'framing', source: 'pmp', status: 'corrupt' });
    });
});
