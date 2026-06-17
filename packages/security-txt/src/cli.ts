#!/usr/bin/env node
import fs, { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { type Address, createSolanaRpc } from '@solana/kit';
import { Command } from 'commander';

import pc from './colors.js';
import { fetchSecurityTxt } from './current-security-txt.js';
import { fetchElfSecurityTxt } from './elf-security-txt.js';
import { fetchPmpSecurityTxt } from './pmp-security-txt.js';
import type { ElfSecurityTxt, PmpSecurityTxt, SecurityTxt, SecurityTxtFields } from './types.js';

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

type Source = 'pmp' | 'elf' | 'both';
type Format = 'text' | 'json';

// ─── Display ─────────────────────────────────────────────────────────────────

function printFields(fields: SecurityTxtFields, indent = '  '): void {
    const entries = Object.entries(fields);
    if (entries.length === 0) {
        console.log(`${indent}${pc.dim('(no recognized fields)')}`);
        return;
    }
    const keyWidth = Math.max(...entries.map(([k]) => k.length));
    for (const [k, v] of entries) {
        console.log(`${indent}${pc.cyan(k.padEnd(keyWidth))}  ${v}`);
    }
}

function printPmpText(result: PmpSecurityTxt): void {
    console.log(pc.bold(`PMP security.txt`));
    console.log(`  ${pc.dim('address:')}   ${result.address}`);
    console.log(`  ${pc.dim('authority:')} ${result.authority ?? pc.dim('(canonical)')}`);
    console.log(`  ${pc.dim('fields:')}`);
    printFields(result.fields, '    ');
}

function printElfText(result: ElfSecurityTxt): void {
    console.log(pc.bold(`ELF security.txt`));
    console.log(`  ${pc.dim('address:')}   ${result.address}`);
    console.log(`  ${pc.dim('fields:')}`);
    printFields(result.fields, '    ');
}

function printResolvedText(result: SecurityTxt): void {
    console.log(pc.bold(`security.txt`) + pc.dim(`  (source: ${result.type})`));
    printFields(result.fields, '  ');
}

// ─── Modes ───────────────────────────────────────────────────────────────────

async function runDefault(
    rpc: ReturnType<typeof createSolanaRpc>,
    addr: Address,
    authority: Address | undefined,
    format: Format,
    raw: boolean,
): Promise<number> {
    const result = await fetchSecurityTxt(rpc, addr, authority !== undefined ? { authority } : undefined);
    if (!result) {
        console.error(pc.red('No security.txt found for this program (checked PMP and ELF).'));
        return 1;
    }

    if (raw) {
        process.stdout.write(result.content);
        if (!result.content.endsWith('\n')) process.stdout.write('\n');
        return 0;
    }

    if (format === 'json') {
        console.log(JSON.stringify(result, null, 2));
        return 0;
    }

    printResolvedText(result);
    return 0;
}

async function runPmpOnly(
    rpc: ReturnType<typeof createSolanaRpc>,
    addr: Address,
    authority: Address | undefined,
    format: Format,
    raw: boolean,
): Promise<number> {
    const result = await fetchPmpSecurityTxt(rpc, addr, authority);
    if (!result) {
        console.error(pc.red('No PMP security.txt found for this program.'));
        return 1;
    }

    if (raw) {
        process.stdout.write(result.content);
        if (!result.content.endsWith('\n')) process.stdout.write('\n');
        return 0;
    }

    if (format === 'json') {
        console.log(JSON.stringify(result, null, 2));
        return 0;
    }

    printPmpText(result);
    return 0;
}

async function runElfOnly(
    rpc: ReturnType<typeof createSolanaRpc>,
    addr: Address,
    format: Format,
    raw: boolean,
): Promise<number> {
    const result = await fetchElfSecurityTxt(rpc, addr);
    if (!result) {
        console.error(
            pc.red('No ELF security.txt found (either no .security.txt section, or unsupported program loader).'),
        );
        return 1;
    }

    if (raw) {
        process.stdout.write(result.content);
        if (!result.content.endsWith('\n')) process.stdout.write('\n');
        return 0;
    }

    if (format === 'json') {
        console.log(JSON.stringify(result, null, 2));
        return 0;
    }

    printElfText(result);
    return 0;
}

/**
 * --source both: report both sources independently. Exit 0 if AT LEAST ONE
 * source returned a result (so scripts can `security-txt … --source both ||
 * echo "neither"`); both sources missing is exit 1.
 *
 * JSON output is `{ pmp: PmpSecurityTxt | null, elf: ElfSecurityTxt | null }`
 * so the structure is stable regardless of which sources hit.
 */
async function runBoth(
    rpc: ReturnType<typeof createSolanaRpc>,
    addr: Address,
    authority: Address | undefined,
    format: Format,
): Promise<number> {
    const [pmp, elf] = await Promise.all([fetchPmpSecurityTxt(rpc, addr, authority), fetchElfSecurityTxt(rpc, addr)]);

    if (format === 'json') {
        console.log(JSON.stringify({ elf, pmp }, null, 2));
        return pmp || elf ? 0 : 1;
    }

    if (pmp) printPmpText(pmp);
    else console.log(pc.dim('PMP: not published'));

    console.log();

    if (elf) printElfText(elf);
    else console.log(pc.dim('ELF: no .security.txt section (or unsupported loader)'));

    return pmp || elf ? 0 : 1;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

/** Public mainnet RPC; used as the silent default when nothing else is configured. */
const PUBLIC_MAINNET_RPC = 'https://api.mainnet-beta.solana.com';

/**
 * Resolve which RPC URL the CLI should use, with a friendly fallback so
 * `security-txt <pid>` works out of the box. Priority: `--rpc` > `$RPC_URL`
 * > public mainnet (with a stderr warning, since the public endpoint
 * rate-limits aggressively on large ELF programs).
 */
function resolveRpcUrl(rpcFlag: string | undefined): string {
    if (rpcFlag) return rpcFlag;
    if (process.env['RPC_URL']) return process.env['RPC_URL'];
    console.error(
        pc.yellow(
            `warn: no --rpc flag and no RPC_URL env var; falling back to ${PUBLIC_MAINNET_RPC} (may rate-limit on large programs)`,
        ),
    );
    return PUBLIC_MAINNET_RPC;
}

/**
 * Optional dependency-injection seam used by future tests. Production
 * callers leave this unset and the CLI falls back to `createSolanaRpc` from
 * `@solana/kit`. Tests can pass `{ rpcFactory: () => makeFakeRpc(...) }`
 * to drive the CLI against fixtures without mocking the kit module.
 *
 * Mirrors `RunCliOptions` in `@solana/idl`'s CLI.
 */
export type RunCliOptions = {
    rpcFactory?: (rpcUrl: string) => ReturnType<typeof createSolanaRpc>;
};

/**
 * Build a fresh commander instance. Exported as a function (rather than a
 * singleton) so each test invocation gets clean parser state. Mirrors
 * `buildProgram` in `@solana/idl`'s CLI.
 */
export function buildProgram(options: RunCliOptions = {}): Command {
    const rpcFactory = options.rpcFactory ?? createSolanaRpc;
    return new Command()
        .name('security-txt')
        .description(
            "Fetch a Solana program's security.txt from on-chain. " +
                'Default: the resolved security.txt (PMP first, then ELF). ' +
                'Use --source pmp or --source elf to pick a specific source, ' +
                'or --source both to report both side-by-side. ' +
                '--raw prints the raw on-chain bytes; --format json prints structured output for scripting.',
        )
        .version(PKG_VERSION)
        .argument('<program-id>', 'Program address')
        .option('-r, --rpc <url>', 'Solana RPC URL (or set RPC_URL env var)')
        .option(
            '-s, --source <source>',
            'Which source to fetch: "pmp", "elf", or "both" (default: resolved PMP-first → ELF fallback)',
        )
        .option('-a, --authority <address>', 'Non-canonical PMP authority (only meaningful with PMP)')
        .option('-f, --format <format>', 'Output format: "text" or "json"', 'text')
        .option('--raw', 'Print the raw on-chain content instead of parsed fields (incompatible with --source both)')
        .action(async (programAddress: string, opts) => {
            const rpcUrl = resolveRpcUrl(opts.rpc);

            const sourceRaw: string | undefined = opts.source;
            if (sourceRaw !== undefined && sourceRaw !== 'pmp' && sourceRaw !== 'elf' && sourceRaw !== 'both') {
                console.error(pc.red(`Error: --source must be "pmp", "elf", or "both" (got "${sourceRaw}").`));
                process.exit(1);
            }
            const source = sourceRaw as Source | undefined;

            const formatRaw: string | undefined = opts.format;
            if (formatRaw !== undefined && formatRaw !== 'text' && formatRaw !== 'json') {
                console.error(pc.red(`Error: --format must be "text" or "json" (got "${formatRaw}").`));
                process.exit(1);
            }
            const format: Format = formatRaw === 'json' ? 'json' : 'text';

            const raw: boolean = Boolean(opts.raw);
            if (raw && source === 'both') {
                console.error(
                    pc.red(
                        "Error: --raw cannot be combined with --source both (which source's raw bytes would we print?). Pick --source pmp or --source elf.",
                    ),
                );
                process.exit(1);
            }

            const authority: Address | undefined = opts.authority ? (opts.authority as Address) : undefined;
            if (authority && source === 'elf') {
                console.error(pc.red('Error: --authority only applies to PMP. Drop --source elf or drop --authority.'));
                process.exit(1);
            }

            const rpc = rpcFactory(rpcUrl);
            const addr = programAddress as Address;

            let exitCode: number;
            try {
                if (source === 'pmp') exitCode = await runPmpOnly(rpc, addr, authority, format, raw);
                else if (source === 'elf') exitCode = await runElfOnly(rpc, addr, format, raw);
                else if (source === 'both') exitCode = await runBoth(rpc, addr, authority, format);
                else exitCode = await runDefault(rpc, addr, authority, format, raw);
            } catch (err) {
                console.error(pc.red(`Error: ${(err as Error).message ?? String(err)}`));
                process.exit(1);
            }

            if (exitCode !== 0) process.exit(exitCode);
        });
}

/**
 * Parse and run the CLI with the given argv (defaults to `process.argv`).
 * Returns a promise that resolves when the action completes, which makes it
 * usable from tests and from the binary entrypoint. Mirrors `runCli` in
 * `@solana/idl`'s CLI.
 */
export async function runCli(argv: string[] = process.argv.slice(2), options: RunCliOptions = {}): Promise<void> {
    await buildProgram(options).parseAsync(argv, { from: 'user' });
}

/**
 * `true` when this module is the process entrypoint (so we can auto-run
 * the CLI). The realpath dance handles both `tsx src/cli.ts` and the
 * symlinked `node_modules/.bin/security-txt` binary launcher. Mirrors the
 * same helper in `@solana/idl`'s CLI.
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
