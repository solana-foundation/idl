#!/usr/bin/env node
import fs, { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Address, createSolanaRpc } from '@solana/kit';
import { Command } from 'commander';
import pc from 'picocolors';

const PKG_VERSION: string = (() => {
    try {
        const here = path.dirname(fileURLToPath(import.meta.url));
        const pkgPath = path.resolve(here, '..', 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
        return pkg.version ?? '0.0.0';
    } catch {
        return '0.0.0';
    }
})();

import { findAnchorIdlAddress, reconstructAnchorHistory } from './anchor.js';
import { fetchIdl, fetchIdlFromBuffer } from './current-idl.js';
import { fetchLatestIdls } from './latest-idl.js';
import { buildPmpIdlLookups } from './pmp-idl.js';
import {
    COMPRESSION_NAME,
    DISC_LABEL,
    ENCODING_NAME,
    FORMAT_NAME,
    findPmpMetadataAddress,
    reconstructPmpHistory,
    type VirtualState,
} from './program-metadata.js';
import type { Snapshot } from './rpc.js';

// ─── Display ─────────────────────────────────────────────────────────────────

function fmtTime(blockTime: bigint | null): string {
    if (!blockTime) return 'unknown time         ';
    return new Date(Number(blockTime) * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

function isPmpState(state: unknown): state is VirtualState {
    return state !== null && typeof state === 'object' && 'discriminator' in (state as Record<string, unknown>);
}

function displaySnapshots(snapshots: Snapshot[], idlType: string): void {
    const count = snapshots.length;
    console.log(pc.bold(`Found ${count} state change${count === 1 ? '' : 's'} (${idlType}):\n`));

    for (const snap of snapshots) {
        const slot = pc.cyan(snap.slot.toString().padStart(14));
        const time = pc.dim(fmtTime(snap.blockTime));
        const instr = pc.yellow(snap.instruction.padEnd(14));

        if (!snap.state) {
            console.log(`${slot}  ${time}  ${instr}  ${pc.red('CLOSED')}`);
            console.log(`               ${' '.repeat(21)} ${pc.dim('sig: ' + snap.signature)}\n`);
            continue;
        }

        let dataInfo: string;

        if (isPmpState(snap.state)) {
            const state = snap.state;
            const discLabel = DISC_LABEL[state.discriminator] ?? 'Unknown';

            if (state.discriminator === 2) {
                const fmt = FORMAT_NAME[state.format] ?? `fmt(${state.format})`;
                const enc = ENCODING_NAME[state.encoding] ?? `enc(${state.encoding})`;
                const cmp = COMPRESSION_NAME[state.compression] ?? `cmp(${state.compression})`;
                const mutable = state.mutable ? '' : pc.red(' immutable');
                dataInfo = pc.green(`${state.dataLength} bytes`) + `  ${fmt}/${enc}/${cmp}${mutable}`;
            } else {
                dataInfo = pc.dim(discLabel + (state.data.length > 0 ? `  ${state.data.length} bytes buffered` : ''));
            }
        } else {
            const anchorState = snap.state as { data: Uint8Array; writeOffset: number };
            dataInfo = pc.green(`${anchorState.data.length} bytes`) + '  zlib/utf8';
        }

        console.log(`${slot}  ${time}  ${instr}  ${dataInfo}`);
        console.log(`               ${' '.repeat(21)} ${pc.dim('sig: ' + snap.signature)}`);

        if (snap.decodedContent !== null) {
            const preview =
                snap.decodedContent.length > 140
                    ? snap.decodedContent.slice(0, 140) + pc.dim('...')
                    : snap.decodedContent;
            console.log(`               ${' '.repeat(21)} ${pc.dim('↳')} ${preview}`);
        }

        console.log();
    }
}

// ─── Save / export ───────────────────────────────────────────────────────────

function saveSnapshots(snapshots: Snapshot[], outDir: string): void {
    fs.mkdirSync(outDir, { recursive: true });

    for (const snap of snapshots) {
        const filename = `${snap.slot}_${snap.instruction.toLowerCase()}.json`;
        const filepath = path.join(outDir, filename);

        let stateObj: Record<string, unknown> | null = null;

        if (snap.state && isPmpState(snap.state)) {
            const state = snap.state;
            stateObj = {
                authority: state.authority,
                canonical: state.canonical,
                compression: COMPRESSION_NAME[state.compression] ?? state.compression,
                data: Buffer.from(state.data.slice(0, state.dataLength)).toString('base64'),
                dataLength: state.dataLength,
                dataSource: state.dataSource,
                discriminator: state.discriminator,
                encoding: ENCODING_NAME[state.encoding] ?? state.encoding,
                format: FORMAT_NAME[state.format] ?? state.format,
                mutable: state.mutable,
                seed: Buffer.from(state.seed).toString('hex'),
            };
        } else if (snap.state) {
            const s = snap.state as { data: Uint8Array; writeOffset: number; authority: string | null };
            stateObj = {
                authority: s.authority,
                data: Buffer.from(s.data).toString('base64'),
                dataLength: s.data.length,
                writeOffset: s.writeOffset,
            };
        }

        const serialisable = {
            blockTime: snap.blockTime !== null ? Number(snap.blockTime) : null,
            decodedContent: snap.decodedContent,
            instruction: snap.instruction,
            signature: snap.signature,
            slot: snap.slot.toString(),
            state: stateObj,
        };

        fs.writeFileSync(filepath, JSON.stringify(serialisable, null, 2));
    }
}

type IdlVersion = {
    version: string | null;
    filename: string;
    activeFrom: { slot: string; time: string | null };
    activeTo: { slot: string; time: string | null } | 'current';
};

function dumpDistinctIdls(snapshots: Snapshot[], outDir: string): number {
    fs.mkdirSync(outDir, { recursive: true });

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
            const v = parsed['version'] ?? (parsed['metadata'] as Record<string, unknown> | undefined)?.['version'];
            if (typeof v === 'string') version = v;
        } catch {
            /* not JSON */
        }

        versions.push({
            content: snap.decodedContent,
            fromSlot: snap.slot,
            fromTime: snap.blockTime,
            version,
        });
    }

    const lastSnap = snapshots[snapshots.length - 1];
    const isClosed = lastSnap && !lastSnap.state;

    const index: IdlVersion[] = [];
    for (let i = 0; i < versions.length; i++) {
        const v = versions[i];
        const suffix = v.version ? `_v${v.version}` : '';
        const filename = `${v.fromSlot}${suffix}.json`;
        fs.writeFileSync(path.join(outDir, filename), v.content);

        const next = versions[i + 1];
        const activeTo: IdlVersion['activeTo'] = next
            ? { slot: next.fromSlot.toString(), time: fmtTimeIso(next.fromTime) }
            : isClosed
              ? { slot: lastSnap.slot.toString(), time: fmtTimeIso(lastSnap.blockTime) }
              : 'current';

        index.push({
            activeFrom: { slot: v.fromSlot.toString(), time: fmtTimeIso(v.fromTime) },
            activeTo,
            filename,
            version: v.version,
        });
    }

    fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2));

    if (versions.length > 0) {
        console.log(pc.bold(`\nIDL version timeline:\n`));
        for (let i = 0; i < index.length; i++) {
            const entry = index[i];
            const from = `slot ${pc.cyan(entry.activeFrom.slot)}`;
            const fromTime = entry.activeFrom.time ? pc.dim(` (${entry.activeFrom.time})`) : '';
            const to = entry.activeTo === 'current' ? pc.green('current') : `slot ${pc.cyan(entry.activeTo.slot)}`;
            const toTime =
                entry.activeTo !== 'current' && entry.activeTo.time ? pc.dim(` (${entry.activeTo.time})`) : '';
            const ver = entry.version ? pc.yellow(`v${entry.version}`) : pc.dim('(no version)');
            console.log(`  ${ver}  ${from}${fromTime}  →  ${to}${toTime}`);
            console.log(`  ${pc.dim(`  └─ ${entry.filename}`)}`);
        }
        console.log();
    }

    return versions.length;
}

function fmtTimeIso(blockTime: bigint | null): string | null {
    if (!blockTime) return null;
    return new Date(Number(blockTime) * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

// ─── Auto-detection ──────────────────────────────────────────────────────────

async function countSigs(rpc: ReturnType<typeof createSolanaRpc>, addr: Address): Promise<number> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sigs = await rpc.getSignaturesForAddress(addr, { limit: 1 }).send();
        return sigs?.length ?? 0;
    } catch {
        return 0;
    }
}

/**
 * Check both Anchor IDL and PMP metadata PDAs for transaction history.
 * Prefer Anchor if the Anchor IDL address has activity, since PMP PDAs
 * can coincidentally receive unrelated transactions.
 */
async function detectIdlType(
    rpc: ReturnType<typeof createSolanaRpc>,
    programAddress: Address,
    seed: string,
    authority?: Address,
): Promise<'pmp' | 'anchor'> {
    const anchorAddr = await findAnchorIdlAddress(programAddress);
    const pmpLookups = await buildPmpIdlLookups(programAddress, seed, authority);

    const [anchorCount, pmpCounts] = await Promise.all([
        countSigs(rpc, anchorAddr),
        Promise.all(pmpLookups.map(l => countSigs(rpc, l.address))),
    ]);
    const pmpHasSigs = pmpCounts.some(c => c > 0);

    if (anchorCount > 0 && pmpHasSigs) return 'anchor';
    if (pmpHasSigs) return 'pmp';
    return 'anchor';
}

// ─── Single-type run ─────────────────────────────────────────────────────────

async function runSingle(
    rpc: ReturnType<typeof createSolanaRpc>,
    rpcUrl: string,
    addr: Address,
    idlType: 'pmp' | 'anchor',
    seed: string,
    authority: Address | undefined,
    outputDir: string | undefined,
    dumpDir: string | undefined,
): Promise<void> {
    let targetAddr: Address;
    let pmpAuthority: Address | null | undefined = authority;
    let snapshots: Snapshot[] | null = null;

    if (idlType === 'pmp' && authority === undefined) {
        // No explicit authority: try canonical, then the IDL fallback authority.
        // Replay each lookup directly; first non-empty wins. (Same logic as /api/history.)
        const pmpLookups = await buildPmpIdlLookups(addr, seed);
        if (pmpLookups.length === 0) {
            console.log(pc.yellow('No PMP metadata account found for this program.'));
            return;
        }
        targetAddr = pmpLookups[0]!.address;
        pmpAuthority = pmpLookups[0]!.authority;
        snapshots = [];
        let lastError: Error | null = null;
        for (const lookup of pmpLookups) {
            try {
                const snaps = await reconstructPmpHistory(rpc, addr, {
                    authority: lookup.authority,
                    seed,
                });
                if (snaps.length > 0) {
                    targetAddr = lookup.address;
                    pmpAuthority = lookup.authority;
                    snapshots = snaps;
                    break;
                }
            } catch (err) {
                lastError = err as Error;
            }
        }
        if (snapshots.length === 0 && lastError) {
            console.error(pc.red(`[PMP] ${lastError.message ?? String(lastError)}`));
            return;
        }
    } else if (idlType === 'pmp') {
        targetAddr = await findPmpMetadataAddress(addr, seed, authority);
    } else {
        targetAddr = await findAnchorIdlAddress(addr);
    }

    console.log(pc.bold(`Reconstructing ${idlType.toUpperCase()} IDL history...\n`));
    console.log(`  ${pc.dim('program:')}    ${addr}`);
    if (idlType === 'pmp') {
        console.log(`  ${pc.dim('seed:')}       ${seed}`);
        if (pmpAuthority) console.log(`  ${pc.dim('authority:')}  ${pmpAuthority}`);
    }
    console.log(`  ${pc.dim('idl acct:')}   ${targetAddr}`);
    console.log(`  ${pc.dim('rpc:')}        ${rpcUrl}`);
    console.log();

    if (snapshots === null) {
        try {
            if (idlType === 'pmp') {
                snapshots = await reconstructPmpHistory(rpc, addr, {
                    authority,
                    seed,
                });
            } else {
                snapshots = await reconstructAnchorHistory(rpc, addr);
            }
        } catch (err) {
            console.error(pc.red(`[${idlType.toUpperCase()}] ${(err as Error).message ?? String(err)}`));
            return;
        }
    }

    if (snapshots.length === 0) {
        console.log(pc.yellow(`No ${idlType.toUpperCase()} transactions found for this program.`));
        return;
    }

    displaySnapshots(snapshots, idlType.toUpperCase());

    if (outputDir) {
        saveSnapshots(snapshots, outputDir);
        console.log(pc.green(`Saved ${snapshots.length} snapshot(s) to ${pc.bold(outputDir)}`));
    }

    if (dumpDir) {
        const written = dumpDistinctIdls(snapshots, dumpDir);
        console.log(pc.green(`Wrote ${written} distinct IDL version(s) to ${pc.bold(dumpDir)}`));
    }
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

/** Public mainnet RPC; used as the silent default when nothing else is configured. */
const PUBLIC_MAINNET_RPC = 'https://api.mainnet-beta.solana.com';

/**
 * Resolve which RPC URL the CLI should use, with a friendly fallback so
 * `idl <pid>` works out of the box. Priority: `--rpc` > `$RPC_URL` >
 * public mainnet (with a stderr warning, since the public endpoint
 * rate-limits aggressively on large IDLs and history replays).
 */
function resolveRpcUrl(rpcFlag: string | undefined): string {
    if (rpcFlag) return rpcFlag;
    if (process.env.RPC_URL) return process.env.RPC_URL;
    console.error(
        pc.yellow(
            `warn: no --rpc flag and no RPC_URL env var; falling back to ${PUBLIC_MAINNET_RPC} (may rate-limit on large programs or history replays)`,
        ),
    );
    return PUBLIC_MAINNET_RPC;
}

/**
 * Optional dependency-injection seam used by the test suite. Production
 * callers leave this unset and the CLI falls back to `createSolanaRpc` from
 * `@solana/kit`. Tests pass `{ rpcFactory: () => makeFakeRpc(...) }` to drive
 * the CLI against recorded fixtures without mocking the kit module.
 */
export type RunCliOptions = {
    rpcFactory?: (rpcUrl: string) => ReturnType<typeof createSolanaRpc>;
};

/**
 * Build a fresh commander instance. Exported as a function (rather than a
 * singleton) so each test invocation gets clean parser state.
 */
export function buildProgram(options: RunCliOptions = {}): Command {
    const rpcFactory = options.rpcFactory ?? createSolanaRpc;
    return new Command()
        .name('idl')
        .description(
            'Fetch on-chain IDLs for Solana programs. ' +
                'Default: the live IDL (canonical PMP → fndn fallback PMP → Anchor). ' +
                'Use --latest for the PMP + Anchor side-by-side payload, --history to replay the full ' +
                'version history, or --buffer to decode a staging buffer account directly.',
        )
        .version(PKG_VERSION)
        .argument('<address>', 'Program address (default/--latest/--history) or buffer account address (--buffer)')
        .option('-r, --rpc <url>', 'Solana RPC URL (or set RPC_URL env var)')
        .option('-s, --seed <seed>', 'Metadata seed (PMP only)', 'idl')
        .option('-a, --authority <address>', 'Authority address (for non-canonical PMP metadata)')
        .option(
            '--latest',
            'Print {programId, pmpAddress, anchorAddress, pmp[], anchor[]} with parsed version (same shape as GET /api/latest). For publish timing, use --history.',
        )
        .option('--history', 'Replay the full IDL version history from on-chain transactions')
        .option(
            '--buffer',
            'Decode the IDL bytes from an Anchor or PMP buffer account (auto-detected from the account owner)',
        )
        .option('-t, --type <type>', '[--history only] IDL type: "pmp", "anchor", or "both" (auto-detected if omitted)')
        .option('-o, --output <dir>', '[--history only] Directory to save full snapshots')
        .option('--dump-idls <dir>', '[--history only] Directory to write each distinct IDL version')
        .action(async (programAddress: string, opts) => {
            const rpcUrl = resolveRpcUrl(opts.rpc);

            const rpc = rpcFactory(rpcUrl);
            const addr = programAddress as Address;
            const seed: string = opts.seed ?? 'idl';
            const authority: Address | undefined = opts.authority ? (opts.authority as Address) : undefined;

            const modes = [opts.latest, opts.history, opts.buffer].filter(Boolean).length;
            if (modes > 1) {
                console.error(pc.red('Error: --latest, --history, and --buffer are mutually exclusive.'));
                process.exit(1);
            }

            // History-only flags guard. `--type`/`--output`/`--dump-idls` describe how
            // to replay history, so they make no sense in the live (default/--latest/--buffer) modes.
            if (!opts.history) {
                if (opts.output || opts.dumpIdls) {
                    console.error(pc.red('Error: --output and --dump-idls are only valid with --history.'));
                    process.exit(1);
                }
                if (opts.type != null && opts.type !== 'auto') {
                    console.error(
                        pc.red(
                            'Error: --type is only valid with --history (live IDL resolution is always PMP → fndn fallback → Anchor).',
                        ),
                    );
                    process.exit(1);
                }
            }

            // ─── --buffer (decode raw buffer account) ──────────────────────────────
            if (opts.buffer) {
                const result = await fetchIdlFromBuffer(rpc, addr);
                if (!result) {
                    console.error(
                        pc.red(
                            'No IDL found at this address (not a PMP buffer, not an Anchor IdlAccount, or account does not exist).',
                        ),
                    );
                    process.exit(1);
                }

                // `result.content` is the raw on-chain string. Pretty-print
                // when it parses as JSON; otherwise pass it through verbatim
                // so non-JSON IDL formats survive a pipe to a file unchanged.
                // The try/catch is intentionally narrow: only `JSON.parse`
                // can throw — we always want exactly one stdout write.
                let body: string;
                try {
                    body = JSON.stringify(JSON.parse(result.content), null, 2);
                } catch {
                    body = result.content;
                }
                console.log(body);
                return;
            }

            // ─── --latest (PMP + Anchor side-by-side) ─────────────────────────────
            if (opts.latest) {
                const latest = await fetchLatestIdls(rpc, addr, {
                    seed,
                    ...(authority !== undefined ? { authority } : {}),
                });
                console.log(JSON.stringify(latest, null, 2));
                return;
            }

            // ─── Default: bare IDL ─────────────────────────────────────────────────
            if (!opts.history) {
                const result = await fetchIdl(rpc, addr, {
                    seed,
                    ...(authority !== undefined ? { authority } : {}),
                });
                if (!result) {
                    console.error(pc.red('No IDL found for this program (checked PMP and Anchor).'));
                    process.exit(1);
                }

                // Bare IDL: emit object as pretty JSON, or pass through a non-JSON
                // string IDL unchanged (so pipes get exactly what was uploaded).
                if (typeof result.idl === 'string') {
                    console.log(result.idl);
                } else {
                    console.log(JSON.stringify(result.idl, null, 2));
                }
                return;
            }

            // ─── History replay (--history) ───────────────────────────────────────
            let typeArg: string = opts.type ?? 'auto';

            if (typeArg === 'auto') {
                console.log(pc.dim('Auto-detecting IDL type...'));
                typeArg = await detectIdlType(rpc, addr, seed, authority);
                console.log(pc.dim(`Detected: ${typeArg}\n`));
            }

            const types: Array<'pmp' | 'anchor'> =
                typeArg === 'both' ? ['pmp', 'anchor'] : [typeArg as 'pmp' | 'anchor'];

            for (const t of types) {
                const outDir = opts.output ? (types.length > 1 ? path.join(opts.output, t) : opts.output) : undefined;
                const dumpDir = opts.dumpIdls
                    ? types.length > 1
                        ? path.join(opts.dumpIdls, t)
                        : opts.dumpIdls
                    : undefined;

                await runSingle(rpc, rpcUrl, addr, t, seed, authority, outDir, dumpDir);

                if (types.length > 1 && t !== types[types.length - 1]) {
                    console.log(pc.dim('─'.repeat(60) + '\n'));
                }
            }
        });
}

/**
 * Parse and run the CLI with the given argv (defaults to `process.argv`).
 * Returns a promise that resolves when the action completes — including async
 * actions — which makes it usable from tests and from the binary entrypoint.
 *
 * Pass `{ rpcFactory }` from tests to swap `createSolanaRpc` for a fake
 * fixture-backed RPC without having to mock `@solana/kit`.
 */
export async function runCli(argv: string[] = process.argv.slice(2), options: RunCliOptions = {}): Promise<void> {
    await buildProgram(options).parseAsync(argv, { from: 'user' });
}

/**
 * `true` when this module is the process entrypoint (so we can auto-run
 * the CLI). The realpath dance handles both `tsx src/cli.ts` and the
 * symlinked `node_modules/.bin/idl` binary launcher.
 */
function isMainModule(): boolean {
    if (!process.argv[1]) return false;
    try {
        const here = realpathSync(fileURLToPath(import.meta.url));
        const entry = realpathSync(process.argv[1]);
        return here === entry || pathToFileURL(entry).href === import.meta.url;
    } catch {
        return false;
    }
}

if (isMainModule()) {
    void runCli();
}
