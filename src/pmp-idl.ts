import { fetchMetadataContent, type Seed } from '@solana-program/program-metadata';
import type { Address } from '@solana/kit';

import type { SolanaRpcClient } from './current-idl.js';
import { findPmpMetadataPda } from './program-metadata.js';

/**
 * Non-canonical PMP authority tried after the canonical lookup misses
 * (public key of `UPLOAD_KEYPAIR` in the GitHub Actions workflow).
 */
export const IDL_FALLBACK_PMP_AUTHORITY = 'fndnu15PLXELbLsTqrfbiweBvsBj2o12RoVfkeCCbX2' as Address;

export type PmpIdlLookup = {
    authority: Address | null;
    address: Address;
};

export type ResolvedPmpIdl = {
    content: string;
    authority: Address | null;
    metadataAddress: Address;
};

/**
 * PMP accounts to try for seed `idl`: canonical first, then the non-canonical
 * fallback using {@link IDL_FALLBACK_PMP_AUTHORITY}.
 */
export async function buildPmpIdlLookups(
    programId: Address,
    seed: Seed,
    explicitAuthority?: Address | null,
): Promise<PmpIdlLookup[]> {
    if (explicitAuthority !== undefined) {
        const address = await findPmpMetadataPda(programId, seed, explicitAuthority);
        return [{ address, authority: explicitAuthority }];
    }

    const lookups: PmpIdlLookup[] = [
        {
            address: await findPmpMetadataPda(programId, seed, null),
            authority: null,
        },
    ];

    if (IDL_FALLBACK_PMP_AUTHORITY) {
        const fbAddress = await findPmpMetadataPda(programId, seed, IDL_FALLBACK_PMP_AUTHORITY);
        if (fbAddress !== lookups[0]!.address) {
            lookups.push({
                address: fbAddress,
                authority: IDL_FALLBACK_PMP_AUTHORITY,
            });
        }
    }

    return lookups;
}

async function tryFetchPmpContent(
    rpc: SolanaRpcClient,
    programId: Address,
    seed: Seed,
    authority: Address | null,
): Promise<string | null> {
    try {
        const content = await fetchMetadataContent(rpc, programId, seed, authority);
        return content || null;
    } catch {
        return null;
    }
}

/** Canonical PMP, then non-canonical via {@link IDL_FALLBACK_PMP_AUTHORITY}. Anchor handled separately. */
export async function fetchPmpIdlContentResolved(
    rpc: SolanaRpcClient,
    programId: Address,
    seed: Seed = 'idl',
    explicitAuthority?: Address | null,
): Promise<ResolvedPmpIdl | null> {
    const lookups = await buildPmpIdlLookups(programId, seed, explicitAuthority);

    for (const lookup of lookups) {
        const content = await tryFetchPmpContent(rpc, programId, seed, lookup.authority);
        if (content) {
            return {
                authority: lookup.authority,
                content,
                metadataAddress: lookup.address,
            };
        }
    }

    return null;
}
