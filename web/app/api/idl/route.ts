import { NextRequest, NextResponse } from 'next/server';
import { Address, createSolanaRpc } from '@solana/kit';
import { fetchIdl } from '@solana/idl';
import {
  envVarForCluster,
  parseCluster,
  rpcUrlForCluster,
} from '@/lib/rpc';

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const programId = req.nextUrl.searchParams.get('programId')?.trim();

    if (!programId || programId.length < 32) {
      return NextResponse.json({ error: 'Missing or invalid programId query parameter' }, { status: 400 });
    }

    const cluster = parseCluster(req.nextUrl.searchParams.get('cluster'));
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

    const result = await fetchIdl(rpc, addr, { seed: 'idl' });

    if (!result) {
      return NextResponse.json(
        { error: 'No IDL found for this program (checked PMP and Anchor)' },
        { status: 404 },
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
