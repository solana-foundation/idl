import { NextRequest, NextResponse } from 'next/server';
import { Address, createSolanaRpc, isAddress } from '@solana/kit';
import {
  fetchElfSecurityTxt,
  fetchPmpSecurityTxt,
  fetchSecurityTxt,
} from '@solana/security-txt';
import {
  envVarForCluster,
  parseCluster,
  rpcUrlForCluster,
} from '@/lib/rpc';

/**
 * security.txt resolution involves at most one PMP RPC call plus, for the
 * ELF path, a `Program → ProgramData → ELF` chain (potentially several MB
 * for large programs). 60s is plenty headroom on either source.
 */
export const maxDuration = 60;

type Source = 'pmp' | 'elf' | 'both';

function parseSource(value: string | null): Source | null {
  if (value === null || value === '') return null; // = default (resolved)
  if (value === 'pmp' || value === 'elf' || value === 'both') return value;
  return 'invalid' as Source; // sentinel handled by caller
}

export async function GET(req: NextRequest) {
  try {
    const programId = req.nextUrl.searchParams.get('programId')?.trim();
    if (!programId || !isAddress(programId)) {
      return NextResponse.json(
        { error: 'Missing or invalid programId query parameter (expected a base58 Solana address)' },
        { status: 400 },
      );
    }

    const cluster = parseCluster(req.nextUrl.searchParams.get('cluster'));
    if (!cluster) {
      return NextResponse.json(
        { error: 'Invalid cluster (expected mainnet-beta or devnet)' },
        { status: 400 },
      );
    }

    const sourceRaw = parseSource(req.nextUrl.searchParams.get('source'));
    if (sourceRaw === ('invalid' as Source)) {
      return NextResponse.json(
        { error: 'Invalid source (expected pmp, elf, or both)' },
        { status: 400 },
      );
    }

    const rpcUrl = rpcUrlForCluster(cluster);
    if (!rpcUrl) {
      return NextResponse.json(
        { error: `${envVarForCluster(cluster)} not configured on server` },
        { status: 500 },
      );
    }

    // Validate the optional authority up-front. Without this an arbitrary
    // string is cast to Address and fed to findMetadataPda, which throws
    // out of @solana/kit's base58 codec and is then caught by the outermost
    // 500 handler — a caller mistake should surface as 400, not 5xx
    // (otherwise monitoring conflates it with real server faults).
    const authorityRaw = req.nextUrl.searchParams.get('authority')?.trim();
    if (authorityRaw && !isAddress(authorityRaw)) {
      return NextResponse.json(
        { error: 'Invalid authority query parameter (expected a base58 Solana address)' },
        { status: 400 },
      );
    }
    const authority: Address | undefined = authorityRaw ? (authorityRaw as Address) : undefined;

    const rpc = createSolanaRpc(rpcUrl);
    const addr = programId as Address;

    // ─── source=both — independent results from each source ────────────────
    // Always returns { pmp, elf } with null for whichever missed, so the
    // shape is stable for callers and the UI panel doesn't need to branch.
    if (sourceRaw === 'both') {
      const [pmp, elf] = await Promise.all([
        fetchPmpSecurityTxt(rpc, addr, authority),
        fetchElfSecurityTxt(rpc, addr),
      ]);
      return NextResponse.json({ programId, pmp, elf });
    }

    // ─── source=pmp — PMP only ────────────────────────────────────────────
    if (sourceRaw === 'pmp') {
      const pmp = await fetchPmpSecurityTxt(rpc, addr, authority);
      if (!pmp) {
        return NextResponse.json(
          { error: 'No PMP security.txt published for this program' },
          { status: 404 },
        );
      }
      return NextResponse.json(pmp);
    }

    // ─── source=elf — ELF only ────────────────────────────────────────────
    if (sourceRaw === 'elf') {
      const elf = await fetchElfSecurityTxt(rpc, addr);
      if (!elf) {
        return NextResponse.json(
          {
            error:
              'No ELF security.txt found (either no .security.txt section, or unsupported program loader)',
          },
          { status: 404 },
        );
      }
      return NextResponse.json(elf);
    }

    // ─── Default — resolved (PMP first → ELF fallback) ─────────────────────
    // Same shape as fetchSecurityTxt: { programId, type: 'pmp' | 'elf',
    // content, fields }, mirroring /api/idl's `{ programId, type, ... }`.
    const result = await fetchSecurityTxt(
      rpc,
      addr,
      authority !== undefined ? { authority } : undefined,
    );
    if (!result) {
      return NextResponse.json(
        {
          error:
            'No security.txt found for this program (checked PMP and ELF)',
        },
        { status: 404 },
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
