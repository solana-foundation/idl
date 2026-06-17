/**
 * Tiny ANSI colorizer for the CLI. Drop-in shape-compatible with the
 * picocolors API (`colors.bold('x')` etc.) so call-sites read identically.
 *
 * Inlined verbatim (TypeScript-ified) from picocolors 1.1.1 by
 * Oleksii Raspopov, Kostiantyn Denysov, Anton Verinov, under the ISC
 * license:
 *
 *   ISC License
 *   Copyright (c) 2021-2024 Oleksii Raspopov, Kostiantyn Denysov, Anton Verinov
 *   Permission to use, copy, modify, and/or distribute this software for any
 *   purpose with or without fee is hereby granted, provided that the above
 *   copyright notice and this permission notice appear in all copies.
 *   THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES…
 *
 * We inline rather than depend on it directly because the surface area we
 * use is five color helpers — well below the maintenance cost of an external
 * dep that would land in the closure of every consumer of
 * `@solana/security-txt`.
 *
 * Detection mirrors the upstream `isColorSupported`: disabled when stdout
 * isn't a TTY, when `NO_COLOR` is set, or when `--no-color` is on argv;
 * forced on by `FORCE_COLOR`, `--color`, Windows, or a `CI` env var.
 */

const proc: NodeJS.Process = typeof process !== 'undefined' ? process : ({} as NodeJS.Process);
const argv: string[] = proc.argv ?? [];
const env: Record<string, string | undefined> = proc.env ?? {};

const stdoutIsTty = Boolean((proc.stdout as { isTTY?: boolean } | undefined)?.isTTY);

const isColorSupported =
    !(Boolean(env['NO_COLOR']) || argv.includes('--no-color')) &&
    (Boolean(env['FORCE_COLOR']) ||
        argv.includes('--color') ||
        proc.platform === 'win32' ||
        (stdoutIsTty && env['TERM'] !== 'dumb') ||
        Boolean(env['CI']));

type Formatter = (input: unknown) => string;

function replaceClose(string: string, close: string, replace: string, index: number): string {
    let result = '';
    let cursor = 0;
    let i = index;
    do {
        result += string.substring(cursor, i) + replace;
        cursor = i + close.length;
        i = string.indexOf(close, cursor);
    } while (~i);
    return result + string.substring(cursor);
}

function formatter(open: string, close: string, replace: string = open): Formatter {
    return (input: unknown): string => {
        const string = String(input);
        const index = string.indexOf(close, open.length);
        return ~index ? open + replaceClose(string, close, replace, index) + close : open + string + close;
    };
}

function identity(input: unknown): string {
    return String(input);
}

const enabled = isColorSupported;
const f = (open: string, close: string, replace?: string): Formatter =>
    enabled ? formatter(open, close, replace) : identity;

export const bold = f('\x1b[1m', '\x1b[22m', '\x1b[22m\x1b[1m');
export const dim = f('\x1b[2m', '\x1b[22m', '\x1b[22m\x1b[2m');
export const red = f('\x1b[31m', '\x1b[39m');
export const yellow = f('\x1b[33m', '\x1b[39m');
export const cyan = f('\x1b[36m', '\x1b[39m');

/**
 * Default export shaped like `import pc from 'picocolors'` so callers can
 * keep their existing `pc.bold(...)` etc. invocations without refactoring.
 */
const colors = { bold, cyan, dim, isColorSupported, red, yellow };
export default colors;
