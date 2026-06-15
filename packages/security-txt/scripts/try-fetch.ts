/**
 * Drive @solana/security-txt end-to-end against a real on-chain program from
 * the terminal. Runs all three fetchers (PMP, ELF, headline) side-by-side so
 * you can see which paths actually return something for the program you pass
 * in. No part of the public package surface depends on this — it's a thin
 * dev-only harness for manual smoke tests, equivalent to `scripts/seed-pmp-
 * buffer.ts` in `@solana/idl`.
 *
 * Usage:
 *   pnpm --filter @solana/security-txt run try <program-id> [--rpc <url>]
 *
 * RPC priority: --rpc flag > $RPC_MAINNET env var > public mainnet (warned).
 */
import { type Address, createSolanaRpc } from '@solana/kit';

import { fetchElfSecurityTxt, fetchPmpSecurityTxt, fetchSecurityTxt } from '../src/index.js';
import type { SecurityTxtFields } from '../src/types.js';

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

function parseArgs(argv: readonly string[]): { programId: string; rpcUrl: string } {
    const positional: string[] = [];
    let rpcOverride: string | null = null;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (arg === '--rpc') {
            rpcOverride = argv[++i] ?? '';
        } else if (arg.startsWith('--rpc=')) {
            rpcOverride = arg.slice('--rpc='.length);
        } else if (arg === '--help' || arg === '-h') {
            usage();
            process.exit(0);
        } else {
            positional.push(arg);
        }
    }
    const programId = positional[0];
    if (!programId) {
        usage();
        process.exit(1);
    }

    let rpcUrl: string;
    if (rpcOverride) {
        rpcUrl = rpcOverride;
    } else if (process.env['RPC_MAINNET']) {
        rpcUrl = process.env['RPC_MAINNET'];
    } else {
        console.error(
            `${YELLOW}warn:${RESET} no --rpc flag and no $RPC_MAINNET set; falling back to the public mainnet RPC (may rate-limit on large programs)`,
        );
        rpcUrl = 'https://api.mainnet-beta.solana.com';
    }

    return { programId, rpcUrl };
}

function usage(): void {
    console.error(
        `usage: pnpm --filter @solana/security-txt run try <program-id> [--rpc <url>]\n` +
            `       (defaults to $RPC_MAINNET, then public mainnet)`,
    );
}

function fieldsBlock(fields: SecurityTxtFields, indent = '  '): string {
    const entries = Object.entries(fields);
    if (entries.length === 0) return `${indent}${DIM}(no fields)${RESET}`;
    const keyWidth = Math.max(...entries.map(([k]) => k.length));
    return entries.map(([k, v]) => `${indent}${k.padEnd(keyWidth)}  ${v}`).join('\n');
}

/**
 * When `fields` is empty but a section was found, dump a peek of the raw
 * bytes so the caller can see WHY parsing failed (stray sentinel match,
 * unrecognized format, custom keys, …). NULs are rendered as `·` to keep
 * the output single-line and readable.
 */
function contentPeek(content: string, max = 240): string {
    const truncated =
        content.length > max ? content.slice(0, max) + `… (+${content.length - max} more bytes)` : content;
    return truncated.replaceAll('\0', '·');
}

function header(label: string, color: string): void {
    console.log('');
    console.log(`${color}${BOLD}── ${label} ──${RESET}`);
}

async function main(): Promise<void> {
    const { programId, rpcUrl } = parseArgs(process.argv.slice(2));
    console.log(`${DIM}program:${RESET} ${programId}`);
    console.log(`${DIM}rpc:    ${RESET} ${rpcUrl}`);

    const rpc = createSolanaRpc(rpcUrl);
    const addr = programId as Address;

    // Run all three in parallel so we can fall through to whichever ones the
    // program actually has, without serializing the slow ELF download.
    const [pmpResult, elfResult, headline] = await Promise.allSettled([
        fetchPmpSecurityTxt(rpc, addr),
        fetchElfSecurityTxt(rpc, addr),
        fetchSecurityTxt(rpc, addr),
    ]);

    header('PMP (seed: security)', CYAN);
    if (pmpResult.status === 'rejected') {
        console.log(`${RED}error:${RESET} ${String(pmpResult.reason)}`);
    } else if (pmpResult.value === null) {
        console.log(`${DIM}no PMP security.txt published for this program${RESET}`);
    } else {
        const { address, authority, content, fields } = pmpResult.value;
        console.log(`  address:   ${address}`);
        console.log(`  authority: ${authority ?? `${DIM}(canonical)${RESET}`}`);
        console.log(`  ${GREEN}fields:${RESET}`);
        console.log(fieldsBlock(fields, '    '));
        if (Object.keys(fields).length === 0) {
            console.log(`  ${YELLOW}raw content peek:${RESET} ${contentPeek(content)}`);
        }
    }

    header('ELF (.security.txt section in BPF binary)', CYAN);
    if (elfResult.status === 'rejected') {
        console.log(`${RED}error:${RESET} ${String(elfResult.reason)}`);
    } else if (elfResult.value === null) {
        console.log(`${DIM}no ELF security.txt found (either no section, or owned by an unsupported loader)${RESET}`);
    } else {
        const { address, content, fields } = elfResult.value;
        console.log(`  address: ${address}`);
        console.log(`  ${GREEN}fields:${RESET}`);
        console.log(fieldsBlock(fields, '    '));
        if (Object.keys(fields).length === 0) {
            console.log(`  ${YELLOW}raw content peek:${RESET} ${contentPeek(content)}`);
        }
    }

    header('Headline: fetchSecurityTxt (PMP-first → ELF fallback)', CYAN);
    if (headline.status === 'rejected') {
        console.log(`${RED}error:${RESET} ${String(headline.reason)}`);
    } else if (headline.value === null) {
        console.log(`${DIM}no security.txt available from either source${RESET}`);
    } else {
        console.log(`  ${GREEN}winner:${RESET} ${BOLD}${headline.value.type}${RESET}`);
        console.log(fieldsBlock(headline.value.fields, '    '));
        if (Object.keys(headline.value.fields).length === 0) {
            console.log(`  ${YELLOW}raw content peek:${RESET} ${contentPeek(headline.value.content)}`);
        }
    }
    console.log('');
}

main().catch(err => {
    console.error(`${RED}fatal:${RESET}`, err);
    process.exit(1);
});
