import { fetchMetadataContent, type Seed } from '@solana-program/program-metadata';
import type { Address } from '@solana/kit';

import { findPmpMetadataAddress } from './program-metadata.js';
import type { SolanaRpcClient } from './rpc.js';

/**
 * Non-canonical PMP authorities to try after the canonical lookup misses.
 * Today this only contains the fndn key (public key of `UPLOAD_KEYPAIR` in the
 * GitHub Actions workflow), but the array shape lets us add more in the future
 * without breaking the public API.
 */
export const IDL_FALLBACK_PMP_AUTHORITIES: readonly Address[] = [
    'fndnu15PLXELbLsTqrfbiweBvsBj2o12RoVfkeCCbX2' as Address,
];

export type PmpIdlLookup = {
    authority: Address | null;
    address: Address;
};

export type PmpIdl = {
    content: string;
    address: Address;
    authority: Address | null;
};

/**
 * PMP accounts to try for seed `idl`: canonical first, then each non-canonical
 * fallback in {@link IDL_FALLBACK_PMP_AUTHORITIES}.
 */
export async function buildPmpIdlLookups(
    programId: Address,
    seed: Seed,
    explicitAuthority?: Address | null,
): Promise<PmpIdlLookup[]> {
    if (explicitAuthority !== undefined) {
        const address = await findPmpMetadataAddress(programId, seed, explicitAuthority);
        return [{ address, authority: explicitAuthority }];
    }

    const lookups: PmpIdlLookup[] = [
        {
            address: await findPmpMetadataAddress(programId, seed, null),
            authority: null,
        },
    ];

    for (const fallback of IDL_FALLBACK_PMP_AUTHORITIES) {
        const fbAddress = await findPmpMetadataAddress(programId, seed, fallback);
        if (lookups.some(l => l.address === fbAddress)) continue;
        lookups.push({
            address: fbAddress,
            authority: fallback,
        });
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

/**
 * Resolve the live PMP IDL for `programId`. Tries canonical first, then each
 * fndn / fallback authority in {@link IDL_FALLBACK_PMP_AUTHORITIES}. Returns
 * `null` if no PMP metadata is published.
 *
 * Returns the raw on-chain content as a string (NOT parsed JSON) so callers
 * that need byte-exact preservation (hashing, diffing) get it. To get a parsed
 * IDL with Anchor fallback, use {@link fetchIdl} instead.
 */
export async function fetchPmpIdl(
    rpc: SolanaRpcClient,
    programId: Address,
    seed: Seed = 'idl',
    explicitAuthority?: Address | null,
): Promise<PmpIdl | null> {
    const lookups = await buildPmpIdlLookups(programId, seed, explicitAuthority);

    for (const lookup of lookups) {
        const content = await tryFetchPmpContent(rpc, programId, seed, lookup.authority);
        if (content) {
            return {
                address: lookup.address,
                authority: lookup.authority,
                content,
            };
        }
    }

    return null;
}
