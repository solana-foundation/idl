import { NextRequest, NextResponse } from 'next/server';
import { Address, createSolanaRpc } from '@solana/kit';
import { fetchLatestIdls, parseIdl } from '@solana/idl';
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
      return NextResponse.json(
        { error: 'Missing or invalid programId query parameter' },
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

    const rpcUrl = rpcUrlForCluster(cluster);
    if (!rpcUrl) {
      return NextResponse.json(
        { error: `${envVarForCluster(cluster)} not configured on server` },
        { status: 500 },
      );
    }

    const rpc = createSolanaRpc(rpcUrl);
    const result = await fetchLatestIdls(rpc, programId as Address);

    // Annotate each entry with JSON validity so the UI can flag a present-but-
    // broken IDL. `content` stays byte-exact; parseIdl is the same check /api/idl
    // uses, imported from the package rather than reimplemented.
    const withValidity = (v: (typeof result.pmp)[number]) => {
      const parsed = parseIdl(v.content);
      return { ...v, reason: parsed.ok ? undefined : parsed.reason, valid: parsed.ok };
    };

    return NextResponse.json({
      ...result,
      anchor: result.anchor.map(withValidity),
      pmp: result.pmp.map(withValidity),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
