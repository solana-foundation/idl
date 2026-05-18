/**
 * Fixture recorder. Drives the real production code paths against a live RPC
 * while a proxy intercepts and persists every response. The integration tests
 * then replay the same fixtures offline.
 *
 * Usage:
 *   bun run __tests__/fixtures/record.ts <program-id> <cluster>
 *
 *   bun run __tests__/fixtures/record.ts BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya mainnet-beta
 *   bun run __tests__/fixtures/record.ts TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA  devnet
 *
 * RPC URLs are read from `RPC_MAINNET` / `RPC_DEVNET`. The script falls back
 * to `web/.env.local` if those env vars are not already set in the shell.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Address } from '@solana/kit';
import { address, createSolanaRpc } from '@solana/kit';

import { findAnchorIdlAddress, reconstructAnchorHistory } from '../../src/anchor.js';
import {
    fetchCurrentAnchorIdlString,
    fetchCurrentIdlPreferPmp,
} from '../../src/current-idl.js';
import { fetchLatestIdls } from '../../src/latest-idl.js';
import {
    buildPmpIdlLookups,
    fetchPmpIdlContentResolved,
} from '../../src/pmp-idl.js';
import { reconstructPmpHistory } from '../../src/program-metadata.js';

import { makeRecordingRpc } from './_helpers/record-rpc.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

type Cluster = 'mainnet-beta' | 'devnet';

function parseCluster(value: string): Cluster {
    if (value === 'mainnet-beta' || value === 'mainnet') return 'mainnet-beta';
    if (value === 'devnet') return 'devnet';
    throw new Error(`Unknown cluster: ${value}. Use mainnet-beta or devnet.`);
}

function loadDotEnvLocal(): void {
    const dotenv = path.resolve(HERE, '../../web/.env.local');
    if (!existsSync(dotenv)) return;
    for (const line of readFileSync(dotenv, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim();
        if (!process.env[key]) process.env[key] = val;
    }
}

function rpcUrlFor(cluster: Cluster): string {
    loadDotEnvLocal();
    const envName = cluster === 'mainnet-beta' ? 'RPC_MAINNET' : 'RPC_DEVNET';
    const url = process.env[envName] ?? process.env.RPC_URL;
    if (!url) {
        throw new Error(
            `Set ${envName} (or RPC_URL) before recording fixtures. ` +
                `Checked process.env and web/.env.local.`,
        );
    }
    return url;
}

async function recordProgram(programId: Address, cluster: Cluster): Promise<void> {
    const url = rpcUrlFor(cluster);
    const realRpc = createSolanaRpc(url);

    const bucket = path.resolve(HERE, `${programId}-${cluster}`);
    let total = 0;
    let reused = 0;
    const rpc = makeRecordingRpc(realRpc, bucket, {
        onCall: ({ method, reused: r }) => {
            total += 1;
            if (r) reused += 1;
            if (total % 50 === 0) {
                process.stdout.write(
                    `  [${total} calls, ${reused} reused] last=${method}\n`,
                );
            }
        },
        reuseExisting: true,
    });

    console.log(`\n▶ recording ${programId} on ${cluster}`);
    console.log(`  bucket: ${bucket}`);
    console.log(`  rpc:    ${url.replace(/\/[a-f0-9-]{20,}\/?$/i, '/<redacted>')}`);

    console.log('  · current IDL (PMP canonical → fndn fallback → Anchor)');
    const current = await fetchCurrentIdlPreferPmp(rpc, programId);
    console.log(`    → ${current ? `${current.type}` : 'none'}`);

    console.log('  · PMP history (canonical + fndn fallback)');
    const lookups = await buildPmpIdlLookups(programId, 'idl');
    for (const lookup of lookups) {
        const tag = lookup.authority ?? '<canonical>';
        const history = await reconstructPmpHistory(rpc, programId, {
            authority: lookup.authority,
        });
        console.log(`    · ${tag} → ${history.length} snapshots`);
    }

    console.log('  · Anchor current (account fetch)');
    const anchorCurrent = await fetchCurrentAnchorIdlString(rpc, programId);
    console.log(`    → ${anchorCurrent ? 'present' : 'none'}`);

    console.log('  · Latest side-by-side (PMP + Anchor + last-write slot)');
    const latest = await fetchLatestIdls(rpc, programId);
    console.log(
        `    → pmp[${latest.pmp.length}] anchor[${latest.anchor.length}]`,
    );

    console.log('  · Anchor history');
    const anchorAddr = await findAnchorIdlAddress(programId);
    const anchorHistory = await reconstructAnchorHistory(rpc, programId);
    console.log(
        `    · anchor pda ${anchorAddr} → ${anchorHistory.length} snapshots`,
    );

    // Also force a final PMP resolve to be sure we have the fixtures the
    // production code paths need when only the resolver is called.
    await fetchPmpIdlContentResolved(rpc, programId, 'idl');

    console.log(`  ✓ done. ${total} RPC calls (${reused} reused from disk)`);
}

async function main(): Promise<void> {
    const [, , rawProgram, rawCluster] = process.argv;
    if (!rawProgram || !rawCluster) {
        console.error('usage: bun run __tests__/fixtures/record.ts <program-id> <cluster>');
        process.exit(1);
    }
    const programId = address(rawProgram);
    const cluster = parseCluster(rawCluster);
    await recordProgram(programId, cluster);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
