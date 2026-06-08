import type { Address } from '@solana/kit';
import { createSolanaRpc } from '@solana/kit';

import type { ElfSecurityTxt } from './types.js';

type SolanaRpcClient = ReturnType<typeof createSolanaRpc>;

/**
 * Resolve the legacy ELF-embedded security.txt for `programId`. Resolves the
 * program data account, decodes the BPF ELF, locates the `.security.txt`
 * section, and parses its `=` / `\0`-delimited key/value pairs as defined by
 * https://github.com/neodyme-labs/solana-security-txt.
 *
 * Returns `null` if the program has no `.security.txt` section, the program
 * data account can't be loaded, or the section bytes don't parse.
 *
 * NOT YET IMPLEMENTED — the public API surface is locked but the body is a
 * stub. The implementation will land in a follow-up commit; in the meantime
 * the package is `private: true` so it can't be published.
 */
// oxlint-disable-next-line typescript/require-await -- stub; real impl will await an RPC call
export async function fetchElfSecurityTxt(_rpc: SolanaRpcClient, _programId: Address): Promise<ElfSecurityTxt | null> {
    throw new Error('fetchElfSecurityTxt: not yet implemented');
}
