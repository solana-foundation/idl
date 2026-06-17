import type { Address } from '@solana/kit';

import { fetchElfSecurityTxt } from './elf-security-txt.js';
import { fetchPmpSecurityTxt } from './pmp-security-txt.js';
import type { SecurityTxt, SolanaRpcClient } from './types.js';

/**
 * Resolve the live on-chain security.txt for `programId`, trying PMP first
 * (canonical, then any non-canonical fallback authority) and falling back
 * to the legacy ELF-embedded `.security.txt` section.
 *
 * Symmetric with `fetchIdl` from `@solana/idl`: same PMP-first → legacy
 * fallback shape, same `{ programId, type, content, ... }` return.
 *
 * Returns `null` when neither source produces a security.txt.
 *
 * Pass `options.authority` to pin a specific PMP authority (only affects
 * the PMP path; the ELF path doesn't have authorities).
 */
export async function fetchSecurityTxt(
    rpc: SolanaRpcClient,
    programId: Address,
    options?: { authority?: Address | null },
): Promise<SecurityTxt | null> {
    const pmp = await fetchPmpSecurityTxt(rpc, programId, options?.authority);
    if (pmp) {
        return {
            content: pmp.content,
            fields: pmp.fields,
            programId: programId as string,
            type: 'pmp',
        };
    }

    const elf = await fetchElfSecurityTxt(rpc, programId);
    if (elf) {
        return {
            content: elf.content,
            fields: elf.fields,
            programId: programId as string,
            type: 'elf',
        };
    }

    return null;
}
