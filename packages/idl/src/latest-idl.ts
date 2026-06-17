/**
 * "Latest" view: PMP and Anchor IDLs surfaced side-by-side with their
 * parsed `version`. This is the single source of truth shared by
 * `GET /api/latest` and the `idl <program> --latest` CLI mode.
 *
 * Resolution rules are the same as the lean {@link fetchIdl}:
 *   - PMP: canonical first, then non-canonical via `IDL_FALLBACK_PMP_AUTHORITIES`.
 *   - Anchor: PDA derived from the program id.
 *
 * Getting the correct last write slot here would be expensive and error prone.
 * Callers that need accurate publish timing should use
 * {@link fetchAllHistories} instead — the history reconstruction path
 * already does the right filtering and exposes per-version
 * `activeFrom` / `activeTo` ranges.
 *
 * Design note — IDL is intentionally a **raw string** here, not parsed JSON.
 * This mode is built for indexers / diff tools / monitors that need byte-exact
 * preservation (hashing, change detection, stable storage). `JSON.parse` →
 * `JSON.stringify` does not guarantee a byte-for-byte round trip (whitespace,
 * key order, number formatting, escape style can all shift), so we keep what
 * was on chain. Callers that want a parsed view should use {@link fetchIdl}
 * (or the CLI's bare default mode).
 */
import { findMetadataPda, type Seed } from '@solana-program/program-metadata';
import type { Address } from '@solana/kit';

import { findAnchorIdlAddress } from './anchor.js';
import { fetchAnchorIdl, type IdlSource } from './current-idl.js';
import { fetchPmpIdl } from './pmp-idl.js';
import type { SolanaRpcClient } from './rpc.js';

export type LatestIdlVersion = {
    type: IdlSource;
    /** Parsed `version` (or `metadata.version`) from the IDL JSON, when present. */
    version: string | null;
    /**
     * IDL content **exactly as stored on-chain** — a JSON string for Anchor and
     * for JSON-encoded PMP, opaque text for any other PMP encoding. Kept as a
     * raw string (not parsed) so hashes and diffs are byte-stable; see the
     * module-level "Design note" comment. To work with the parsed object, run
     * `JSON.parse(content)` or use the bare `idl <program>` CLI mode.
     */
    content: string;
};

export type LatestIdls = {
    programId: Address;
    pmpAddress: Address;
    anchorAddress: Address;
    /** Either empty (no PMP IDL on-chain) or a single-element array. */
    pmp: LatestIdlVersion[];
    /** Either empty (no Anchor IDL on-chain) or a single-element array. */
    anchor: LatestIdlVersion[];
};

function extractVersion(content: string): string | null {
    try {
        const parsed = JSON.parse(content) as Record<string, unknown>;
        const v = parsed['version'] ?? (parsed['metadata'] as Record<string, unknown> | undefined)?.['version'];
        if (typeof v === 'string') return v;
    } catch {
        /* not JSON */
    }
    return null;
}

function buildVersion(type: IdlSource, content: string): LatestIdlVersion {
    return {
        content,
        type,
        version: extractVersion(content),
    };
}

export async function fetchLatestIdls(
    rpc: SolanaRpcClient,
    programId: Address,
    options?: { seed?: Seed; authority?: Address | null },
): Promise<LatestIdls> {
    const seed: Seed = options?.seed ?? 'idl';

    const [pmpPdaFallback] = await findMetadataPda({
        authority: options?.authority ?? null,
        program: programId,
        seed,
    });
    const anchorAddr = await findAnchorIdlAddress(programId);

    const [pmpResolved, anchor] = await Promise.all([
        fetchPmpIdl(rpc, programId, seed, options?.authority),
        fetchAnchorIdl(rpc, programId),
    ]);

    const pmpMetadataAddress = pmpResolved?.address ?? pmpPdaFallback;

    return {
        anchor: anchor ? [buildVersion('anchor', anchor.content)] : [],
        anchorAddress: anchorAddr,
        pmp: pmpResolved ? [buildVersion('pmp', pmpResolved.content)] : [],
        pmpAddress: pmpMetadataAddress,
        programId,
    };
}
