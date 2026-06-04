/**
 * One-shot fixture seed: writes an IDL into a real PMP buffer account on
 * devnet (by shelling out to the upstream `program-metadata create-buffer`
 * CLI), then records the resulting on-chain bytes as a vitest fixture
 * under `__tests__/fixtures/<bufferAddress>-devnet/`.
 *
 * Why shell out: `@solana-program/program-metadata` v0.5 keeps the
 * higher-level transaction planner + `getCreateBufferInstructionPlan`
 * internal — they're declared in the .d.ts but never re-exported from the
 * JS bundle. Reimplementing them locally just to seed a single fixture
 * isn't worth the maintenance tax. The bundled CLI already encapsulates
 * the full flow (allocate + chunked writes + set-authority) and reads
 * the Solana CLI config for RPC URL + keypair, so a thin wrapper is the
 * cleanest path.
 *
 * Usage:
 *   pnpm seed:pmp-buffer <idl-file>
 *   pnpm seed:pmp-buffer idl.json
 *
 * Pre-requisites:
 *   - `solana config set --url devnet` (or any devnet RPC) and a funded
 *     default keypair at `~/.config/solana/id.json`. The PMP CLI picks
 *     both up automatically; override with `--rpc` / `--keypair` via the
 *     `EXTRA_PMP_ARGS` env var if needed.
 *
 * Outputs:
 *   __tests__/fixtures/<bufferAddress>-devnet/
 *     buffer-address.txt              the new buffer address
 *     source-idl.json                 the IDL content for round-trip assertion
 *     getAccountInfo--<hash>.json     the recorded RPC response that
 *                                     `fetchIdlFromBuffer` will replay against
 *
 * Idempotency: each run generates a fresh keypair → fresh buffer address
 * → fresh fixture bucket. To refresh, delete the old bucket and re-run.
 * The test reads its address from `buffer-address.txt` so source code
 * stays stable across re-seeds.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { address, createSolanaRpc } from '@solana/kit';

import { makeRecordingRpc } from '../__tests__/fixtures/_helpers/record-rpc.js';
import { fetchIdlFromBuffer } from '../src/current-idl.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Run `program-metadata create-buffer <file> [...extra]` and stream its
 *  output to the parent stdio while capturing for later parsing. */
function runCreateBuffer(idlPath: string, extraArgs: readonly string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        const args = ['exec', 'program-metadata', 'create-buffer', idlPath, ...extraArgs];
        const child = spawn('pnpm', args, { stdio: ['inherit', 'pipe', 'inherit'] });
        let captured = '';
        child.stdout.on('data', (chunk: Buffer) => {
            const text = chunk.toString('utf8');
            captured += text;
            process.stdout.write(text);
        });
        child.on('error', reject);
        child.on('close', code => {
            if (code === 0) resolve(captured);
            else reject(new Error(`program-metadata exited with code ${code}`));
        });
    });
}

/** The CLI prints the new buffer with logCommand() which renders as
 *  `<prefix>buffer: <BASE58>` on its own line. Match defensively against
 *  any leading box-drawing/whitespace and the optional ansi color reset. */
function parseBufferAddress(output: string): string {
    // Strip ANSI escapes so the regex stays simple. The ESC byte (0x1b)
    // is intentional here — we're parsing terminal output that the PMP
    // CLI colorizes with picocolors. The no-control-regex lint catches
    // accidental control bytes, not this use case.
    // oxlint-disable-next-line no-control-regex
    const stripped = output.replace(/\u001b\[[0-9;]*m/g, '');
    const match = stripped.match(/buffer:\s*([1-9A-HJ-NP-Za-km-z]{32,44})/);
    if (!match) {
        throw new Error(
            'Could not find a `buffer: <address>` line in CLI output — did the create-buffer command change?',
        );
    }
    return match[1]!;
}

function rpcUrlFromSolanaConfig(): string {
    // Read the same YAML the PMP CLI does, so our recording RPC hits the
    // same cluster. We deliberately avoid pulling in a YAML parser for one
    // line: the file is shaped `key: value` with no nesting.
    const cfgPath = path.join(process.env.HOME ?? '', '.config/solana/cli/config.yml');
    const text = readFileSync(cfgPath, 'utf8');
    const match = text.match(/^json_rpc_url:\s*"?([^"\n]+)"?/m);
    if (!match) throw new Error(`Could not find json_rpc_url in ${cfgPath}`);
    return match[1]!.trim();
}

async function main(): Promise<void> {
    const [, , rawIdlPath] = process.argv;
    if (!rawIdlPath) {
        console.error('usage: pnpm seed:pmp-buffer <idl-file>');
        process.exit(1);
    }
    const absIdlPath = path.resolve(rawIdlPath);
    const idlContent = readFileSync(absIdlPath, 'utf8');

    const extraArgs = process.env.EXTRA_PMP_ARGS ? process.env.EXTRA_PMP_ARGS.split(/\s+/).filter(Boolean) : [];

    console.log(`▶ creating PMP buffer on chain via @solana-program/program-metadata CLI`);
    console.log(`  idl file:    ${absIdlPath}`);
    console.log(`  idl bytes:   ${idlContent.length}`);
    if (extraArgs.length > 0) console.log(`  extra args:  ${extraArgs.join(' ')}`);
    console.log('');

    const cliOutput = await runCreateBuffer(absIdlPath, extraArgs);
    const bufferAddress = parseBufferAddress(cliOutput);
    console.log(`\n✓ buffer created at ${bufferAddress}`);

    console.log('\n▶ recording getAccountInfo fixture');
    const rpcUrl = rpcUrlFromSolanaConfig();
    console.log(`  rpc: ${rpcUrl.replace(/\/[a-f0-9-]{20,}\/?$/i, '/<redacted>')}`);

    const bucket = path.resolve(HERE, `../__tests__/fixtures/${bufferAddress}-devnet`);
    mkdirSync(bucket, { recursive: true });

    const recording = makeRecordingRpc(createSolanaRpc(rpcUrl), bucket, { reuseExisting: false });
    const decoded = await fetchIdlFromBuffer(recording, address(bufferAddress));
    if (decoded === null) {
        throw new Error(
            'fetchIdlFromBuffer returned null right after creating the buffer — ' +
                'either the CLI did not actually finalize the buffer or the recording RPC is on a different cluster',
        );
    }
    if (decoded.type !== 'pmp') {
        throw new Error(`expected decoded.type === 'pmp', got ${decoded.type}`);
    }
    if (decoded.content !== idlContent) {
        throw new Error('round-trip mismatch: decoded content does not equal the IDL we just wrote');
    }
    console.log(`  round-trip ✓ (${decoded.content.length} chars)`);

    writeFileSync(path.join(bucket, 'buffer-address.txt'), `${bufferAddress}\n`);
    writeFileSync(path.join(bucket, 'source-idl.json'), idlContent);

    console.log(`\nfixture bucket: ${bucket}`);
    console.log(`buffer address: ${bufferAddress}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
