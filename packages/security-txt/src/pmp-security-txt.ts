import { findMetadataPda, type Seed } from '@solana-program/program-metadata';
import type { Address } from '@solana/kit';
import { createSolanaRpc } from '@solana/kit';

import type { PmpSecurityTxt } from './types.js';

/** PMP seed every security.txt-on-PMP convention uses. */
export const SECURITY_TXT_PMP_SEED: Seed = 'security.txt';

type SolanaRpcClient = ReturnType<typeof createSolanaRpc>;

/**
 * Derive the PDA for a security.txt PMP metadata account. Mirrors
 * `findPmpMetadataAddress` from `@solana/idl` but pins the seed to
 * {@link SECURITY_TXT_PMP_SEED}, so it's a one-arg helper for the canonical
 * case and a two-arg helper for non-canonical uploads.
 */
export async function findPmpSecurityTxtAddress(programAddress: Address, authority?: Address | null): Promise<Address> {
    const [pda] = await findMetadataPda({
        authority: authority ?? null,
        program: programAddress,
        seed: SECURITY_TXT_PMP_SEED,
    });
    return pda;
}

/**
 * Resolve the live PMP security.txt for `programId`. Tries canonical first,
 * then each non-canonical fallback authority (currently none — this list
 * exists for parity with `IDL_FALLBACK_PMP_AUTHORITIES`). Returns `null` if
 * no PMP security.txt is published.
 *
 * Symmetric with `fetchPmpIdl` from `@solana/idl`.
 *
 * NOT YET IMPLEMENTED — the public API surface is locked but the body is a
 * stub. The implementation will land in a follow-up commit; in the meantime
 * the package is `private: true` so it can't be published.
 */
// oxlint-disable-next-line typescript/require-await -- stub; real impl will await an RPC call
export async function fetchPmpSecurityTxt(
    _rpc: SolanaRpcClient,
    _programId: Address,
    _explicitAuthority?: Address | null,
): Promise<PmpSecurityTxt | null> {
    throw new Error('fetchPmpSecurityTxt: not yet implemented');
}
