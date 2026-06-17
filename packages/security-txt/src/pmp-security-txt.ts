import { fetchMetadataContent, findMetadataPda, type Seed } from '@solana-program/program-metadata';
import type { Address } from '@solana/kit';

import { extractSecurityTxtSection, parseJsonSecurityTxt, parseSecurityTxtPayload, payloadToString } from './parser.js';
import type { PmpSecurityTxt, SolanaRpcClient } from './types.js';

/**
 * The PMP seed convention for security.txt uploads is the bare string
 * `'security'` (NOT `'security.txt'`) — this matches the SPL Program
 * Metadata docs and what production programs actually use on mainnet today.
 * Don't confuse it with the ELF section name `.security.txt`, which is a
 * separate identifier baked into the neodyme macro.
 */
export const SECURITY_TXT_PMP_SEED: Seed = 'security';

/**
 * Non-canonical PMP authorities to try after the canonical lookup misses.
 * Empty today — kept as an array (and not `null`) so adding fndn / partner
 * fallbacks later doesn't break the public API. Mirrors
 * `IDL_FALLBACK_PMP_AUTHORITIES` from `@solana/idl`.
 */
export const SECURITY_TXT_FALLBACK_PMP_AUTHORITIES: readonly Address[] = [];

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

type Lookup = { address: Address; authority: Address | null };

async function buildLookups(programId: Address, explicitAuthority: Address | null | undefined): Promise<Lookup[]> {
    if (explicitAuthority !== undefined) {
        return [
            { address: await findPmpSecurityTxtAddress(programId, explicitAuthority), authority: explicitAuthority },
        ];
    }

    const lookups: Lookup[] = [{ address: await findPmpSecurityTxtAddress(programId, null), authority: null }];
    for (const fallback of SECURITY_TXT_FALLBACK_PMP_AUTHORITIES) {
        const address = await findPmpSecurityTxtAddress(programId, fallback);
        if (lookups.some(l => l.address === address)) continue;
        lookups.push({ address, authority: fallback });
    }
    return lookups;
}

async function tryFetchPmpContent(
    rpc: SolanaRpcClient,
    programId: Address,
    authority: Address | null,
): Promise<string | null> {
    try {
        const content = await fetchMetadataContent(rpc, programId, SECURITY_TXT_PMP_SEED, authority);
        return content || null;
    } catch {
        return null;
    }
}

/**
 * Build a {@link PmpSecurityTxt} from already-fetched raw bytes. Returns
 * `null` when the bytes don't carry a well-formed security.txt in any
 * of the formats actually used on mainnet today.
 *
 * We accept THREE shapes, in order of likelihood:
 *
 *   1. **JSON** — the modern `metadata.json` payload produced by the SPL
 *      `program-metadata metadata upload` CLI. This is what most new
 *      uploads use (e.g. SPL Memo).
 *   2. **Sentinel-wrapped NUL-delimited** — raw output from the neodyme
 *      `security_txt!` macro pasted verbatim into PMP.
 *   3. **Bare NUL-delimited** — the macro output with the BEGIN/END
 *      framing stripped before upload.
 *
 * Bare NUL uploads that decode to zero recognized keys are refused — at
 * that point we can't distinguish "valid security.txt in a format we
 * don't know" from "completely unrelated bytes", and a false positive is
 * the worse failure mode here.
 */
function decodePmpSecurityTxt(address: Address, authority: Address | null, rawContent: string): PmpSecurityTxt | null {
    if (rawContent.trimStart().startsWith('{')) {
        const fields = parseJsonSecurityTxt(rawContent);
        if (fields && Object.keys(fields).length > 0) {
            return { address, authority, content: rawContent, fields };
        }
    }

    const bytes = new TextEncoder().encode(rawContent);
    const inner = extractSecurityTxtSection(bytes);
    if (inner) {
        return {
            address,
            authority,
            content: payloadToString(inner),
            fields: parseSecurityTxtPayload(inner),
        };
    }

    const fields = parseSecurityTxtPayload(bytes);
    if (Object.keys(fields).length === 0) return null;
    return { address, authority, content: rawContent, fields };
}

/**
 * Resolve the live PMP security.txt for `programId`. Tries canonical first,
 * then each authority in {@link SECURITY_TXT_FALLBACK_PMP_AUTHORITIES}.
 * Returns `null` if no PMP security.txt is published.
 *
 * Pass `explicitAuthority` to pin a specific (non-canonical) authority,
 * matching `fetchPmpIdl`'s contract from `@solana/idl`.
 */
export async function fetchPmpSecurityTxt(
    rpc: SolanaRpcClient,
    programId: Address,
    explicitAuthority?: Address | null,
): Promise<PmpSecurityTxt | null> {
    const lookups = await buildLookups(programId, explicitAuthority);

    for (const lookup of lookups) {
        const content = await tryFetchPmpContent(rpc, programId, lookup.authority);
        if (!content) continue;
        const decoded = decodePmpSecurityTxt(lookup.address, lookup.authority, content);
        if (decoded) return decoded;
    }

    return null;
}
