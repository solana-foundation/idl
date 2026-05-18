import { NextRequest, NextResponse } from 'next/server';
import { Address, createSolanaRpc } from '@solana/kit';
import { findMetadataPda } from '@solana-program/program-metadata';
import { reconstructPmpHistory } from '@core/program-metadata';
import { reconstructAnchorHistory, findAnchorIdlAddress } from '@core/anchor';
import { buildPmpIdlLookups } from '@core/pmp-idl';
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

    const [canonicalPmpPda] = await findMetadataPda({
      program: addr,
      authority: null,
      seed: 'idl',
    });
    const anchorAddr = await findAnchorIdlAddress(addr);
    const pmpLookups = await buildPmpIdlLookups(addr, 'idl');
    let pmpPda = canonicalPmpPda;
    let pmpVersions: IdlVersion[] = [];

    for (const lookup of pmpLookups) {
      try {
        const snaps = await reconstructPmpHistory(rpc, addr, {
          authority: lookup.authority,
          seed: 'idl',
        });
        if (snaps.length > 0) {
          pmpVersions = extractVersions(snaps, 'pmp');
          pmpPda = lookup.address;
          break;
        }
      } catch {
        /* try next lookup */
      }
    }

    const anchorVersions = await reconstructAnchorHistory(rpc, addr)
      .then((snaps) => extractVersions(snaps, 'anchor'))
      .catch(() => [] as IdlVersion[]);

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
