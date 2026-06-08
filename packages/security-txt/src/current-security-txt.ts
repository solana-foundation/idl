import type { Address } from '@solana/kit';
import { createSolanaRpc } from '@solana/kit';

import { fetchElfSecurityTxt } from './elf-security-txt.js';
import { fetchPmpSecurityTxt } from './pmp-security-txt.js';
import type { SecurityTxt } from './types.js';

type SolanaRpcClient = ReturnType<typeof createSolanaRpc>;

/**
 * Resolve the live on-chain security.txt for `programId`, trying PMP first
 * (canonical, then fallback authorities) and falling back to the legacy
 * ELF-embedded `.security.txt` section.
 *
 * Symmetric with `fetchIdl` from `@solana/idl`: same PMP-first → legacy
 * fallback shape, same `{ type, content, ... }` return.
 *
 * NOT YET IMPLEMENTED — the public API surface is locked but the body is a
 * stub. The implementation will land in a follow-up commit; in the meantime
 * the package is `private: true` so it can't be published.
 */
export async function fetchSecurityTxt(
    rpc: SolanaRpcClient,
    programId: Address,
    _options?: { authority?: Address | null },
): Promise<SecurityTxt | null> {
    const pmp = await fetchPmpSecurityTxt(rpc, programId);
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
