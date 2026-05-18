import { NextRequest, NextResponse } from 'next/server';
import { Address, createSolanaRpc } from '@solana/kit';
import { fetchAllHistories } from '@core/history';
import type { Snapshot } from '@core/rpc';
import {
  envVarForCluster,
  parseCluster,
  rpcUrlForCluster,
} from '@/lib/rpc';

export const maxDuration = 60;

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const programId = body.programId?.trim();

    if (!programId || typeof programId !== 'string' || programId.length < 32) {
      return NextResponse.json({ error: 'Invalid program ID' }, { status: 400 });
    }

    const cluster = parseCluster(
      typeof body.cluster === 'string' ? body.cluster : null,
    );
    if (!cluster) {
      return NextResponse.json(
        { error: 'Invalid cluster (expected mainnet-beta or devnet)' },
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

    const rpc = createSolanaRpc(rpcUrl);
    const addr = programId as Address;

    const histories = await fetchAllHistories(rpc, addr);

    return NextResponse.json({
      programId,
      pmpAddress: histories.pmpAddress,
      anchorAddress: histories.anchorAddress,
      pmp: extractVersions(histories.pmp, 'pmp'),
      anchor: extractVersions(histories.anchor, 'anchor'),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
