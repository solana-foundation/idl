import type { Address } from '@solana/kit';

import { fetchProgramElf } from './elf-loader.js';
import { extractSecurityTxtSection, parseSecurityTxtPayload, payloadToString } from './parser.js';
import type { ElfSecurityTxt, SolanaRpcClient } from './types.js';

/**
 * Resolve the legacy ELF-embedded security.txt for `programId`. Fetches the
 * program (and its `ProgramData` child, for the upgradeable loader), scans
 * the BPF binary for a `.security.txt` section emitted by the
 * [neodyme-labs `security_txt!` macro][neodyme], and parses its
 * `\0`-delimited key/value pairs.
 *
 * Returns `null` whenever no security.txt can be produced:
 *   - the program account doesn't exist
 *   - the program isn't owned by a known BPF loader (Upgradeable or v2)
 *   - the binary contains no `=======BEGIN SECURITY.TXT V1=======` sentinel
 *     (the literal the neodyme macro emits — seven `=` on each side)
 *
 * The returned `address` is the program account itself (i.e. `programId`),
 * matching the on-chain identity callers expect. The raw, byte-exact
 * payload between the BEGIN/END sentinels is preserved on `content` for
 * hashing or diffing; `fields` is the typed view of the known keys.
 *
 * [neodyme]: https://github.com/neodyme-labs/solana-security-txt
 */
export async function fetchElfSecurityTxt(rpc: SolanaRpcClient, programId: Address): Promise<ElfSecurityTxt | null> {
    const elf = await fetchProgramElf(rpc, programId);
    if (!elf) return null;

    const payload = extractSecurityTxtSection(elf.bytes);
    if (!payload) return null;

    return {
        address: programId,
        content: payloadToString(payload),
        fields: parseSecurityTxtPayload(payload),
    };
}
