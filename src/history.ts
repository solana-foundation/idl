import { type Seed } from '@solana-program/program-metadata';
import type { Address } from '@solana/kit';

import { findAnchorIdlAddress, reconstructAnchorHistory } from './anchor.js';
import { buildPmpIdlLookups } from './pmp-idl.js';
import { reconstructPmpHistory } from './program-metadata.js';
import type { Snapshot, SolanaRpcClient } from './rpc.js';

export type AllHistories = {
    programId: string;
    /** PMP PDA whose history won (first non-empty), or the canonical PDA if all empty. */
    pmpAddress: string;
    anchorAddress: string;
    /** Full PMP snapshot history. Empty when no PMP IDL has ever been published. */
    pmp: Snapshot[];
    /** Full Anchor snapshot history. Empty when no Anchor IDL has ever been published. */
    anchor: Snapshot[];
};

/**
 * Replay the full IDL history for `programId`: every PMP snapshot AND every
 * Anchor snapshot, side-by-side. The history analog of {@link fetchLatestIdls}.
 *
 * Resolution rules mirror {@link fetchIdl}:
 *   - PMP: tries canonical first, then each `IDL_FALLBACK_PMP_AUTHORITIES`
 *     entry, and keeps the first non-empty history.
 *   - Anchor: PDA derived from `programId`.
 *
 * Pass `options.authority` to pin a specific PMP authority (e.g. for an
 * unrelated custom uploader) or `options.seed` for non-default seeds.
 *
 * Either of `pmp` / `anchor` may be `[]` when that source has no history.
 */
export async function fetchAllHistories(
    rpc: SolanaRpcClient,
    programId: Address,
    options?: { seed?: Seed; authority?: Address | null },
): Promise<AllHistories> {
    const seed = options?.seed ?? 'idl';

    const lookups = await buildPmpIdlLookups(programId, seed, options?.authority);
    const canonicalPmpAddress = lookups[0]!.address;
    const anchorAddress = await findAnchorIdlAddress(programId);

    const [pmpResult, anchor] = await Promise.all([
        (async () => {
            for (const lookup of lookups) {
                try {
                    const snaps = await reconstructPmpHistory(rpc, programId, {
                        authority: lookup.authority,
                        seed,
                    });
                    if (snaps.length > 0) {
                        return { address: lookup.address, snapshots: snaps };
                    }
                } catch {
                    // Try the next lookup.
                }
            }
            return null;
        })(),
        reconstructAnchorHistory(rpc, programId).catch(() => [] as Snapshot[]),
    ]);

    return {
        anchor,
        anchorAddress: anchorAddress as string,
        pmp: pmpResult?.snapshots ?? [],
        pmpAddress: (pmpResult?.address ?? canonicalPmpAddress) as string,
        programId: programId as string,
    };
}
