import { describe, expect, test } from 'bun:test';

import { address, isAddress } from '@solana/kit';

import type { SolanaRpcClient } from '../src/current-idl.js';
import { buildPmpIdlLookups, fetchPmpIdlContentResolved, IDL_FALLBACK_PMP_AUTHORITY } from '../src/pmp-idl.js';
import {
    COMPRESSION_NAME,
    DISC_LABEL,
    ENCODING_NAME,
    FORMAT_NAME,
    PROGRAM_METADATA_PROGRAM_ADDRESS,
    findPmpMetadataPda,
} from '../src/program-metadata.js';

const PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

describe('findPmpMetadataPda', () => {
    test('canonical (no authority) is deterministic', async () => {
        const a = await findPmpMetadataPda(PROGRAM, 'idl');
        const b = await findPmpMetadataPda(PROGRAM, 'idl', null);
        expect(a).toBe(b);
    });

    test('different seeds produce different PDAs', async () => {
        const a = await findPmpMetadataPda(PROGRAM, 'idl');
        const b = await findPmpMetadataPda(PROGRAM, 'custom');
        expect(a).not.toBe(b);
    });

    test('non-canonical (with authority) differs from canonical', async () => {
        const canonical = await findPmpMetadataPda(PROGRAM, 'idl', null);
        const nonCanonical = await findPmpMetadataPda(PROGRAM, 'idl', IDL_FALLBACK_PMP_AUTHORITY);
        expect(canonical).not.toBe(nonCanonical);
    });
});

describe('buildPmpIdlLookups', () => {
    test('default returns canonical + fallback', async () => {
        const lookups = await buildPmpIdlLookups(PROGRAM, 'idl');
        expect(lookups).toHaveLength(2);
        expect(lookups[0]!.authority).toBeNull();
        expect(lookups[1]!.authority).toBe(IDL_FALLBACK_PMP_AUTHORITY);
    });

    test('explicit authority short-circuits to a single lookup', async () => {
        const lookups = await buildPmpIdlLookups(PROGRAM, 'idl', IDL_FALLBACK_PMP_AUTHORITY);
        expect(lookups).toHaveLength(1);
        expect(lookups[0]!.authority).toBe(IDL_FALLBACK_PMP_AUTHORITY);
    });

    test('explicit null authority forces canonical-only', async () => {
        const lookups = await buildPmpIdlLookups(PROGRAM, 'idl', null);
        expect(lookups).toHaveLength(1);
        expect(lookups[0]!.authority).toBeNull();
    });
});

describe('PMP constants', () => {
    test('IDL_FALLBACK_PMP_AUTHORITY is a valid address', () => {
        expect(isAddress(IDL_FALLBACK_PMP_AUTHORITY)).toBe(true);
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

describe('fetchPmpIdlContentResolved', () => {
    test('returns null when no lookup yields content', async () => {
        const stubRpc = {} as SolanaRpcClient;
        const out = await fetchPmpIdlContentResolved(stubRpc, PROGRAM, 'idl', null);
        expect(out).toBeNull();
    });
});
