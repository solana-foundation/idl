import { NextRequest, NextResponse } from 'next/server';
import { Address, createSolanaRpc } from '@solana/kit';
import { fetchIdlWrapped, parseIdl } from '@solana/idl';
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

    const result = await fetchIdlWrapped(rpc, addr, { seed: 'idl' });

    if (result.status === 'absent') {
      return NextResponse.json(
        { error: 'No IDL found for this program (checked PMP and Anchor)' },
        { status: 404 },
      );
    }

    if (result.status === 'corrupt') {
      return NextResponse.json(
        { error: 'IDL account present but its bytes could not be decoded', reason: result.reason, source: result.source },
        { status: 422 },
      );
    }

    // ok: parse to an object when it's JSON, otherwise pass the raw on-chain
    // string through as `idl` (opaque / broken-JSON content stays byte-exact).
    // `valid` + `reason` let the UI flag content that isn't a usable IDL while
    // still showing it.
    const parsed = parseIdl(result.content);
    return NextResponse.json({
      idl: parsed.ok ? parsed.idl : result.content,
      programId: addr,
      reason: parsed.ok ? undefined : parsed.reason,
      type: result.source,
      valid: parsed.ok,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
