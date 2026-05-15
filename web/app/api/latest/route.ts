import { NextRequest, NextResponse } from 'next/server';
import { Address, createSolanaRpc } from '@solana/kit';
import { fetchCurrentAnchorIdlString } from '@core/current-idl';
import { findAnchorIdlAddress } from '@core/anchor';
import { fetchPmpIdlContentResolved } from '@core/pmp-idl';
import { findMetadataPda } from '@solana-program/program-metadata';

export const maxDuration = 30;

type IdlVersion = {
  type: 'pmp' | 'anchor';
  version: string | null;
  slot: string | null;
  time: string | null;
  activeFrom: { slot: string; time: string | null } | null;
  activeTo: 'current';
  content: string;
};

function extractVersion(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const v =
      parsed['version'] ??
      (parsed['metadata'] as Record<string, unknown> | undefined)?.['version'];
    if (typeof v === 'string') return v;
  } catch {
    /* not JSON */
  }
  return null;
}

function fmtTime(blockTime: bigint | number | null | undefined): string | null {
  if (blockTime === null || blockTime === undefined) return null;
  return new Date(Number(blockTime) * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

async function getLastWriteSlot(
  rpc: ReturnType<typeof createSolanaRpc>,
  account: Address,
): Promise<{ slot: string; time: string | null } | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sigs = await (rpc as any)
      .getSignaturesForAddress(account, { limit: 1 })
      .send();
    if (!sigs || sigs.length === 0) return null;
    return {
      slot: sigs[0].slot.toString(),
      time: fmtTime(sigs[0].blockTime),
    };
  } catch {
    return null;
  }
}

function buildVersion(
  type: 'pmp' | 'anchor',
  content: string,
  lastWrite: { slot: string; time: string | null } | null,
): IdlVersion {
  return {
    type,
    version: extractVersion(content),
    slot: lastWrite?.slot ?? null,
    time: lastWrite?.time ?? null,
    activeFrom: lastWrite ? { slot: lastWrite.slot, time: lastWrite.time } : null,
    activeTo: 'current',
    content,
  };
}

export async function GET(req: NextRequest) {
  try {
    const programId = req.nextUrl.searchParams.get('programId')?.trim();

    if (!programId || programId.length < 32) {
      return NextResponse.json(
        { error: 'Missing or invalid programId query parameter' },
        { status: 400 },
      );
    }

    const rpcUrl = process.env.RPC_URL;
    if (!rpcUrl) {
      return NextResponse.json({ error: 'RPC_URL not configured on server' }, { status: 500 });
    }

    const rpc = createSolanaRpc(rpcUrl);
    const addr = programId as Address;

    const [canonicalPmpPda] = await findMetadataPda({
      program: addr,
      authority: null,
      seed: 'idl',
    });
    const anchorAddr = await findAnchorIdlAddress(addr);

    const [pmpResolved, anchorContent] = await Promise.all([
      fetchPmpIdlContentResolved(rpc, addr, 'idl'),
      fetchCurrentAnchorIdlString(rpc, addr),
    ]);

    const pmpMetadataAddress = pmpResolved?.metadataAddress ?? canonicalPmpPda;

    const [pmpLastWrite, anchorLastWrite] = await Promise.all([
      pmpResolved ? getLastWriteSlot(rpc, pmpMetadataAddress) : null,
      anchorContent ? getLastWriteSlot(rpc, anchorAddr) : null,
    ]);

    const pmp: IdlVersion[] = pmpResolved
      ? [buildVersion('pmp', pmpResolved.content, pmpLastWrite)]
      : [];
    const anchor: IdlVersion[] = anchorContent
      ? [buildVersion('anchor', anchorContent, anchorLastWrite)]
      : [];

    return NextResponse.json({
      programId,
      pmpAddress: pmpMetadataAddress,
      anchorAddress: anchorAddr,
      pmp,
      anchor,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
