import { describe, expect, test } from 'bun:test';

import { address, isAddress } from '@solana/kit';

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
    test('returns null when no lookup yields content', async () => {
        const stubRpc = {} as SolanaRpcClient;
        const out = await fetchPmpIdl(stubRpc, PROGRAM, 'idl', null);
        expect(out).toBeNull();
    });
});
