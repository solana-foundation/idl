import { NextRequest, NextResponse } from 'next/server';
import { Address, createSolanaRpc } from '@solana/kit';
import { fetchAllHistories } from '@core/history';
import type { Snapshot } from '@core/rpc';
import {
  envVarForCluster,
  parseCluster,
  rpcUrlForCluster,
} from '@/lib/rpc';

/**
 * History reconstruction is the heaviest endpoint: it walks every PMP and
 * Anchor transaction touching a program's metadata. For programs with long
 * deploy histories (hundreds of writes) this can run well past 60s. We set
 * the function timeout to Vercel's Pro-tier maximum; on Hobby plans Vercel
 * silently caps to 60s, on Pro to 300s, on Enterprise up to 900s.
 */
export const maxDuration = 300;

/** No proxy / CDN caching — chain state changes and responses are large. */
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

type IdlVersion = {
  type: 'pmp' | 'anchor';
  version: string | null;
  slot: string;
  time: string | null;
  activeFrom: { slot: string; time: string | null };
  activeTo: { slot: string; time: string | null } | 'current';
  content: string;
};

function fmtTime(blockTime: bigint | null): string | null {
  if (!blockTime) return null;
  return new Date(Number(blockTime) * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

function extractVersions(snapshots: Snapshot[], type: 'pmp' | 'anchor'): IdlVersion[] {
  const versions: {
    content: string;
    version: string | null;
    fromSlot: bigint;
    fromTime: bigint | null;
  }[] = [];

  let prevContent: string | null = null;
  for (const snap of snapshots) {
    if (snap.decodedContent === null) continue;
    if (snap.decodedContent === prevContent) continue;
    prevContent = snap.decodedContent;

    let version: string | null = null;
    try {
      const parsed = JSON.parse(snap.decodedContent) as Record<string, unknown>;
      const v =
        parsed['version'] ??
        (parsed['metadata'] as Record<string, unknown> | undefined)?.['version'];
      if (typeof v === 'string') version = v;
    } catch {
      /* not JSON */
    }

    versions.push({
      content: snap.decodedContent,
      version,
      fromSlot: snap.slot,
      fromTime: snap.blockTime,
    });
  }

  const lastSnap = snapshots[snapshots.length - 1];
  const isClosed = lastSnap && !lastSnap.state;

  return versions.map((v, i) => {
    const next = versions[i + 1];
    const activeTo: IdlVersion['activeTo'] = next
      ? { slot: next.fromSlot.toString(), time: fmtTime(next.fromTime) }
      : isClosed
        ? { slot: lastSnap.slot.toString(), time: fmtTime(lastSnap.blockTime) }
        : 'current';

    return {
      type,
      version: v.version,
      slot: v.fromSlot.toString(),
      time: fmtTime(v.fromTime),
      activeFrom: { slot: v.fromSlot.toString(), time: fmtTime(v.fromTime) },
      activeTo,
      content: v.content,
    };
  });
}

/**
 * Shared handler for GET (query string) and POST (JSON body) requests.
 * Both methods are supported intentionally — GET is the right REST choice for
 * a pure read and gives shareable URLs + browser-level retry on transient
 * network errors; POST is retained for backward compatibility with existing
 * scripts and the explorer UI.
 */
async function handle(rawProgramId: unknown, rawCluster: unknown): Promise<NextResponse> {
  try {
    const programId = typeof rawProgramId === 'string' ? rawProgramId.trim() : '';
    if (!programId || programId.length < 32) {
      return NextResponse.json(
        { error: 'Invalid program ID' },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const cluster = parseCluster(typeof rawCluster === 'string' ? rawCluster : null);
    if (!cluster) {
      return NextResponse.json(
        { error: 'Invalid cluster (expected mainnet-beta or devnet)' },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const rpcUrl = rpcUrlForCluster(cluster);
    if (!rpcUrl) {
      return NextResponse.json(
        { error: `${envVarForCluster(cluster)} not configured on server` },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    const rpc = createSolanaRpc(rpcUrl);
    const addr = programId as Address;

    const histories = await fetchAllHistories(rpc, addr);

    return NextResponse.json(
      {
        programId,
        pmpAddress: histories.pmpAddress,
        anchorAddress: histories.anchorAddress,
        pmp: extractVersions(histories.pmp, 'pmp'),
        anchor: extractVersions(histories.anchor, 'anchor'),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  return handle(params.get('programId'), params.get('cluster'));
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  return handle(body.programId, body.cluster);
}
