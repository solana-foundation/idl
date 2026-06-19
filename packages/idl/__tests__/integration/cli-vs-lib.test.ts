import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Address } from '@solana/kit';
/**
 * End-to-end equivalence test: the `idl <program>` CLI and the library export
 * `fetchIdl` (bare mode) / `fetchLatestIdls` (`--latest` mode)
 * MUST produce byte-identical results for the same program against the same
 * fixture bucket.
 *
 * Strategy:
 *   1. Drive the CLI in-process via `runCli(argv, { rpcFactory })`, passing
 *      a factory that returns a fake RPC bound to the BUYux mainnet fixture
 *      bucket. The CLI exposes `rpcFactory` purely as a test seam — production
 *      callers leave it unset and `createSolanaRpc` is used as before.
 *   2. Capture stdout/stderr/exit code by spying on `console.*` and
 *      `process.exit`.
 *   3. Call the library entrypoints (`fetchIdl`, `fetchLatestIdls`) directly
 *      with a fresh fake RPC.
 *   4. Assert: parsed CLI JSON ≡ library result, and pin to a file snapshot
 *      so any future drift in the BUYux fixture surfaces loudly.
 *
 * We deliberately avoid `vi.mock('@solana/kit', ...)` here: kit is a barrel
 * re-export over ~28 sub-packages, and an async mock factory that calls
 * `importOriginal()` on it deadlocks vitest's module instrumentation (the
 * test file ends up stuck in `[queued]` forever). Dependency injection via
 * `rpcFactory` is the cheaper and more honest contract.
 */
import { describe, expect, it, vi } from 'vitest';

import { runCli } from '../../src/cli.js';
import { fetchIdl, fetchLatestIdls } from '../../src/index.js';
import type { LatestIdls } from '../../src/latest-idl.js';
import { makeFakeRpc } from '../fixtures/_helpers/fake-rpc.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUYUX = 'BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya' as Address;
const BUCKET = path.resolve(HERE, '../fixtures', `${BUYUX}-mainnet-beta`);

type CapturedRun = { stdout: string; stderr: string; exitCode: number };

async function runCliCaptured(argv: string[]): Promise<CapturedRun> {
    const out: string[] = [];
    const err: string[] = [];
    let exitCode = 0;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(((...args: unknown[]) => {
        out.push(args.map(a => (typeof a === 'string' ? a : String(a))).join(' '));
    }) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(((...args: unknown[]) => {
        err.push(args.map(a => (typeof a === 'string' ? a : String(a))).join(' '));
    }) as never);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        exitCode = code ?? 0;
        throw new Error(`__test_exit_${exitCode}`);
    }) as never);

    try {
        await runCli(argv, { rpcFactory: () => makeFakeRpc(BUCKET) });
    } catch (e) {
        if (!(e instanceof Error) || !e.message.startsWith('__test_exit_')) {
            throw e;
        }
    } finally {
        logSpy.mockRestore();
        errSpy.mockRestore();
        exitSpy.mockRestore();
    }

    return { exitCode, stderr: err.join('\n'), stdout: out.join('\n') };
}

/**
 * Pinned snapshot helper. Vitest's `expect.toMatchSnapshot` writes per-test
 * files under `__snapshots__/<test>.snap` that we'd rather not manage by hand,
 * so we keep our existing single-file snapshots and rebuild them on demand
 * with `UPDATE_SNAPSHOTS=1`.
 */
function expectMatchesFileSnapshot(actual: string, snapshotPath: string): void {
    if (process.env.UPDATE_SNAPSHOTS === '1') {
        writeFileSync(snapshotPath, actual);
        return;
    }
    const expected = readFileSync(snapshotPath, 'utf8');
    expect(actual).toBe(expected);
}

describe('CLI ↔ library equivalence on BUYux', () => {
    describe('default (bare IDL)', () => {
        it('prints just the IDL body — no {programId, type, idl} wrapper', async () => {
            const { stdout, stderr, exitCode } = await runCliCaptured([BUYUX, '--rpc', 'http://mocked.invalid/']);

            expect(exitCode).toBe(0);
            expect(stderr).toBe('');
            const parsed = JSON.parse(stdout) as Record<string, unknown>;
            // Bare IDL → real Anchor-shaped object (no wrapper keys).
            expect(parsed).not.toHaveProperty('programId');
            expect(parsed).not.toHaveProperty('type');
            expect(parsed).toHaveProperty('metadata');
            expect(parsed).toHaveProperty('instructions');
        });

        it('matches the library result byte-for-byte', async () => {
            // fetchIdl now returns the parsed IDL object itself (T | null),
            // not a { programId, type, idl } wrapper.
            const libResult = await fetchIdl(makeFakeRpc(BUCKET), BUYUX);
            expect(libResult).not.toBeNull();

            const { stdout } = await runCliCaptured([BUYUX, '--rpc', 'http://mocked.invalid/']);

            // For BUYux the IDL parses as JSON, so the CLI prints
            // JSON.stringify(libResult, null, 2).
            expect(stdout).toBe(JSON.stringify(libResult, null, 2));
        });

        it('matches the pinned bare-IDL snapshot', async () => {
            const { stdout } = await runCliCaptured([BUYUX, '--rpc', 'http://mocked.invalid/']);
            expectMatchesFileSnapshot(
                `${stdout}\n`,
                path.resolve(HERE, '../fixtures/__snapshots__/buyux-bare-idl.json'),
            );
        });
    });

    describe('--latest (PMP + Anchor side-by-side)', () => {
        it('CLI prints the {programId, pmpAddress, anchorAddress, pmp, anchor} payload', async () => {
            const { stdout, stderr, exitCode } = await runCliCaptured([
                BUYUX,
                '--latest',
                '--rpc',
                'http://mocked.invalid/',
            ]);

            expect(exitCode).toBe(0);
            expect(stderr).toBe('');
            const parsed = JSON.parse(stdout) as LatestIdls;
            expect(parsed.programId).toBe(BUYUX);
            expect(typeof parsed.pmpAddress).toBe('string');
            expect(typeof parsed.anchorAddress).toBe('string');
            expect(parsed.pmp).toHaveLength(1);
            expect(parsed.anchor).toHaveLength(1);
            expect(parsed.pmp[0]!.type).toBe('pmp');
            expect(parsed.anchor[0]!.type).toBe('anchor');
            // Parsed IDL version field (BUYux is at v0.1.0).
            expect(parsed.pmp[0]!.version).toBe('0.1.0');
            expect(parsed.anchor[0]!.version).toBe('0.1.0');
            // Latest path intentionally omits per-version slot/time —
            // those would require a sig walk that can be griefed for
            // pennies (see the module-level comment in latest-idl.ts).
            // Callers that need accurate publish timing use --history.
            expect(parsed.pmp[0]!).not.toHaveProperty('slot');
            expect(parsed.pmp[0]!).not.toHaveProperty('activeFrom');
        });

        it('library returns the exact same JSON as the CLI', async () => {
            const libResult = await fetchLatestIdls(makeFakeRpc(BUCKET), BUYUX);

            const { stdout } = await runCliCaptured([BUYUX, '--latest', '--rpc', 'http://mocked.invalid/']);

            expect(JSON.parse(stdout)).toEqual(libResult);
            expect(stdout).toBe(JSON.stringify(libResult, null, 2));
        });

        it('matches the pinned --latest snapshot', async () => {
            const { stdout } = await runCliCaptured([BUYUX, '--latest', '--rpc', 'http://mocked.invalid/']);
            expectMatchesFileSnapshot(
                `${stdout}\n`,
                path.resolve(HERE, '../fixtures/__snapshots__/buyux-latest-idl.json'),
            );
        });
    });

    describe('mode flag validation', () => {
        it('rejects --latest + --history', async () => {
            const { stderr, exitCode } = await runCliCaptured([BUYUX, '--latest', '--history', '--rpc', 'mock://x']);
            expect(exitCode).toBe(1);
            expect(stderr).toContain('mutually exclusive');
        });

        it('rejects --latest + --buffer', async () => {
            const { stderr, exitCode } = await runCliCaptured([BUYUX, '--latest', '--buffer', '--rpc', 'mock://x']);
            expect(exitCode).toBe(1);
            expect(stderr).toContain('mutually exclusive');
        });

        it('rejects --history + --buffer', async () => {
            const { stderr, exitCode } = await runCliCaptured([BUYUX, '--history', '--buffer', '--rpc', 'mock://x']);
            expect(exitCode).toBe(1);
            expect(stderr).toContain('mutually exclusive');
        });

        it('rejects --type without --history', async () => {
            const { stderr, exitCode } = await runCliCaptured([BUYUX, '--type', 'pmp', '--rpc', 'mock://x']);
            expect(exitCode).toBe(1);
            expect(stderr).toContain('--type is only valid with --history');
        });

        it('rejects --output without --history', async () => {
            const { stderr, exitCode } = await runCliCaptured([BUYUX, '--output', '/tmp/x', '--rpc', 'mock://x']);
            expect(exitCode).toBe(1);
            expect(stderr).toContain('only valid with --history');
        });
    });

    it('default and --latest invocations are deterministic across runs', async () => {
        const a1 = await runCliCaptured([BUYUX, '--rpc', 'mock://x']);
        const a2 = await runCliCaptured([BUYUX, '--rpc', 'mock://x']);
        const b1 = await runCliCaptured([BUYUX, '--latest', '--rpc', 'mock://x']);
        const b2 = await runCliCaptured([BUYUX, '--latest', '--rpc', 'mock://x']);
        expect(a1.stdout).toBe(a2.stdout);
        expect(b1.stdout).toBe(b2.stdout);
    });
});
