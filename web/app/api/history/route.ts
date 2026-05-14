import { NextRequest, NextResponse } from 'next/server';
import { Address, createSolanaRpc } from '@solana/kit';
import { findMetadataPda } from '@solana-program/program-metadata';
import { reconstructPmpHistory } from '@core/program-metadata';
import { reconstructAnchorHistory, findAnchorIdlAddress } from '@core/anchor';
import type { Snapshot } from '@core/rpc';

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

async function hasSigs(rpc: ReturnType<typeof createSolanaRpc>, addr: Address): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sigs = await (rpc as any)
      .getSignaturesForAddress(addr, { limit: 1 })
      .send();
    return sigs && sigs.length > 0;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const programId = body.programId?.trim();

    if (!programId || typeof programId !== 'string' || programId.length < 32) {
      return NextResponse.json({ error: 'Invalid program ID' }, { status: 400 });
    }

    const rpcUrl = process.env.RPC_URL;
    if (!rpcUrl) {
      return NextResponse.json({ error: 'RPC_URL not configured on server' }, { status: 500 });
    }

    const rpc = createSolanaRpc(rpcUrl);
    const addr = programId as Address;

    const [pmpPda] = await findMetadataPda({
      program: addr,
      authority: null,
      seed: 'idl',
    });
    const anchorAddr = await findAnchorIdlAddress(addr);

    const [hasPmp, hasAnchor] = await Promise.all([
      hasSigs(rpc, pmpPda),
      hasSigs(rpc, anchorAddr),
    ]);

    const tasks: Promise<IdlVersion[]>[] = [];

    if (hasPmp) {
      tasks.push(
        reconstructPmpHistory(rpc, pmpPda)
          .then((snaps) => extractVersions(snaps, 'pmp'))
          .catch(() => []),
      );
    }

    if (hasAnchor) {
      tasks.push(
        reconstructAnchorHistory(rpc, addr)
          .then((snaps) => extractVersions(snaps, 'anchor'))
          .catch(() => []),
      );
    }

    const results = await Promise.all(tasks);
    const pmpVersions = results.find((_, i) => (hasPmp && i === 0))?.filter(v => v.type === 'pmp') ?? [];
    const anchorVersions = results.flat().filter(v => v.type === 'anchor');

    return NextResponse.json({
      programId,
      pmpAddress: pmpPda,
      anchorAddress: anchorAddr,
      pmp: pmpVersions,
      anchor: anchorVersions,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
