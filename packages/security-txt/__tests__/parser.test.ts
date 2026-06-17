import { describe, expect, test } from 'vitest';

import {
    extractSecurityTxtSection,
    parseJsonSecurityTxt,
    parseSecurityTxtPayload,
    payloadToString,
} from '../src/parser.js';

// MUST stay in sync with the neodyme macro literal (7 `=` on each side).
// Mismatch here vs. the parser's constants would silently break extraction —
// see the regression test at the bottom of this file.
const BEGIN = '=======BEGIN SECURITY.TXT V1=======';
const END = '=======END SECURITY.TXT V1=======';

/**
 * Build the exact byte sequence the neodyme-labs `security_txt!` macro
 * emits into the `.security.txt` ELF section: the BEGIN sentinel, then
 * `\0`-terminated key/value pairs, then the END sentinel. Used as the
 * inner payload of every fixture in this file.
 */
function buildMacroBytes(fields: Record<string, string>): Uint8Array {
    const enc = new TextEncoder();
    const chunks: Uint8Array[] = [];
    chunks.push(enc.encode(BEGIN + '\0'));
    for (const [key, value] of Object.entries(fields)) {
        chunks.push(enc.encode(key + '\0'));
        chunks.push(enc.encode(value + '\0'));
    }
    chunks.push(enc.encode(END + '\0'));
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
        out.set(c, off);
        off += c.length;
    }
    return out;
}

describe('extractSecurityTxtSection', () => {
    test('finds payload between BEGIN and END markers', () => {
        const bytes = buildMacroBytes({ contacts: 'email:s@x.io', name: 'X' });
        const payload = extractSecurityTxtSection(bytes);
        expect(payload).not.toBeNull();
        const decoded = payloadToString(payload!);
        expect(decoded.includes('name\0X\0')).toBe(true);
        expect(decoded.includes('contacts\0email:s@x.io\0')).toBe(true);
        expect(decoded.includes(BEGIN)).toBe(false);
        expect(decoded.includes(END)).toBe(false);
    });

    test('finds payload when surrounded by unrelated bytes (ELF-like)', () => {
        const inner = buildMacroBytes({ name: 'X' });
        // Splice the macro bytes into the middle of a 1KB-of-junk "fake ELF".
        const junk = new Uint8Array(1024);
        for (let i = 0; i < junk.length; i++) junk[i] = (i * 17) & 0xff;
        const haystack = new Uint8Array(junk.length + inner.length + junk.length);
        haystack.set(junk, 0);
        haystack.set(inner, junk.length);
        haystack.set(junk, junk.length + inner.length);

        const payload = extractSecurityTxtSection(haystack);
        expect(payload).not.toBeNull();
        expect(payloadToString(payload!)).toContain('name\0X\0');
    });

    test('returns null when no BEGIN marker is present', () => {
        const bytes = new TextEncoder().encode('garbage bytes that have no marker at all');
        expect(extractSecurityTxtSection(bytes)).toBeNull();
    });

    test('returns null when BEGIN has no matching END', () => {
        const bytes = new TextEncoder().encode(BEGIN + '\0name\0X\0' /* no END */);
        expect(extractSecurityTxtSection(bytes)).toBeNull();
    });

    test('skips a stray BEGIN literal when a real section follows', () => {
        // First "BEGIN" with no end is a decoy — common false-positive shape if
        // someone embedded the literal as a doc string. The real section is
        // right after.
        const decoy = new TextEncoder().encode(BEGIN + ' (in some doc comment)\n');
        const real = buildMacroBytes({ name: 'real' });
        const buf = new Uint8Array(decoy.length + real.length);
        buf.set(decoy, 0);
        buf.set(real, decoy.length);

        const payload = extractSecurityTxtSection(buf);
        expect(payload).not.toBeNull();
        expect(payloadToString(payload!)).toContain('name\0real\0');
    });
});

describe('parseSecurityTxtPayload', () => {
    test('parses all known keys to typed fields', () => {
        const bytes = buildMacroBytes({
            acknowledgements: 'thank you',
            auditors: 'Halborn',
            contacts: 'email:sec@example.com',
            encryption: '-----BEGIN PGP-----',
            expiry: '2030-01-01',
            name: 'Example',
            policy: 'https://example.com/security',
            preferred_languages: 'en,de',
            project_url: 'https://example.com',
            source_code: 'https://github.com/example/repo',
            source_release: 'v1.2.3',
            source_revision: 'abc123',
        });
        const inner = extractSecurityTxtSection(bytes)!;
        const fields = parseSecurityTxtPayload(inner);
        expect(fields).toMatchObject({
            acknowledgements: 'thank you',
            auditors: 'Halborn',
            contacts: 'email:sec@example.com',
            encryption: '-----BEGIN PGP-----',
            expiry: '2030-01-01',
            name: 'Example',
            policy: 'https://example.com/security',
            preferred_languages: 'en,de',
            project_url: 'https://example.com',
            source_code: 'https://github.com/example/repo',
            source_release: 'v1.2.3',
            source_revision: 'abc123',
        });
    });

    test('silently drops unknown keys (keeps the typed surface stable)', () => {
        const bytes = buildMacroBytes({ contacts: 'x', custom_unknown_field: 'should be dropped', name: 'Example' });
        const inner = extractSecurityTxtSection(bytes)!;
        const fields = parseSecurityTxtPayload(inner);
        expect(fields).toEqual({ contacts: 'x', name: 'Example' });
    });

    test('handles a payload with no fields (just the sentinels)', () => {
        const bytes = buildMacroBytes({});
        const inner = extractSecurityTxtSection(bytes)!;
        expect(parseSecurityTxtPayload(inner)).toEqual({});
    });

    test('regression: keeps a trailing empty value (do NOT trim trailing empties)', () => {
        // A previous version of splitNulPairs trimmed BOTH leading and
        // trailing empties; the trailing trim silently dropped legitimate
        // empty values (e.g. `expiry: ''`), shifting subsequent pairs and
        // losing data. The fix trims only the structural leading empty
        // from the BEGIN sentinel's NUL. This test pins the contract.
        const bytes = buildMacroBytes({ expiry: '', name: 'Example' });
        const inner = extractSecurityTxtSection(bytes)!;
        const fields = parseSecurityTxtPayload(inner);
        expect(fields).toEqual({ expiry: '', name: 'Example' });
    });

    test('regression: a single-field payload with an empty value still parses', () => {
        // Edge case of the above: the ONLY field has an empty value. The
        // payload is `\0expiry\0\0`, which used to trim down to `['expiry']`
        // and the pair loop dropped it entirely.
        const bytes = buildMacroBytes({ expiry: '' });
        const inner = extractSecurityTxtSection(bytes)!;
        expect(parseSecurityTxtPayload(inner)).toEqual({ expiry: '' });
    });

    test('regression: parses the EXACT neodyme macro byte layout (Token-2022 shape)', () => {
        // This test pins the parser to the literal 7-`=` sentinels the
        // upstream `security_txt!` macro emits. A previous version of the
        // parser hardcoded 5 `=` instead, which still indexOf-matched as a
        // substring of the 7-`=` sentinel but left leftover `==` bytes in
        // the payload and shifted every (key, value) pair by one slot —
        // silently producing `fields: {}` for every real-world ELF
        // security.txt. Token-2022 was the surface that exposed this.
        const enc = new TextEncoder();
        const wireBytes = enc.encode(
            '=======BEGIN SECURITY.TXT V1=======\0' +
                'name\0SPL Token-2022\0' +
                'project_url\0https://www.solana-program.com/docs/token-2022\0' +
                'contacts\0email:security@anza.xyz\0' +
                'policy\0https://github.com/solana-program/token-2022/blob/master/SECURITY.md\0' +
                '=======END SECURITY.TXT V1=======\0',
        );
        const inner = extractSecurityTxtSection(wireBytes);
        expect(inner).not.toBeNull();
        expect(parseSecurityTxtPayload(inner!)).toEqual({
            contacts: 'email:security@anza.xyz',
            name: 'SPL Token-2022',
            policy: 'https://github.com/solana-program/token-2022/blob/master/SECURITY.md',
            project_url: 'https://www.solana-program.com/docs/token-2022',
        });
    });
});

describe('parseJsonSecurityTxt', () => {
    test('parses the SPL Memo-style JSON shape including PMP-extended keys', () => {
        const content = JSON.stringify({
            contacts: 'link:https://github.com/x,email:security@x',
            description: 'Solana Program Library Memo',
            name: 'SPL Memo',
            policy: 'https://github.com/x/SECURITY.md',
            preferred_languages: 'en',
            project_url: 'https://github.com/solana-program/memo',
            source_code: 'https://github.com/solana-program/memo/tree/main/program',
            version: '4.0.0',
        });
        // All eight keys should round-trip — `description` and `version` are
        // PMP-extended keys and must NOT be dropped (regression: we used to
        // filter to the neodyme set only).
        expect(parseJsonSecurityTxt(content)).toEqual({
            contacts: 'link:https://github.com/x,email:security@x',
            description: 'Solana Program Library Memo',
            name: 'SPL Memo',
            policy: 'https://github.com/x/SECURITY.md',
            preferred_languages: 'en',
            project_url: 'https://github.com/solana-program/memo',
            source_code: 'https://github.com/solana-program/memo/tree/main/program',
            version: '4.0.0',
        });
    });

    test('exposes every PMP-extended key (logo, description, notification, sdk, version)', () => {
        const content = JSON.stringify({
            description: 'd',
            logo: 'https://example.com/logo.png',
            notification: 'n',
            sdk: 'https://github.com/example/sdk',
            version: '1.2.3',
        });
        expect(parseJsonSecurityTxt(content)).toEqual({
            description: 'd',
            logo: 'https://example.com/logo.png',
            notification: 'n',
            sdk: 'https://github.com/example/sdk',
            version: '1.2.3',
        });
    });

    test('joins array-valued fields with "," to match the security.txt convention', () => {
        const content = JSON.stringify({
            auditors: ['Audit Firm A', 'Researcher B'],
            contacts: ['email:a@x', 'discord:b'],
            name: 'X',
            preferred_languages: ['en', 'de'],
        });
        expect(parseJsonSecurityTxt(content)).toEqual({
            auditors: 'Audit Firm A,Researcher B',
            contacts: 'email:a@x,discord:b',
            name: 'X',
            preferred_languages: 'en,de',
        });
    });

    test('returns null for non-JSON, non-object JSON, or arrays', () => {
        expect(parseJsonSecurityTxt('not json')).toBeNull();
        expect(parseJsonSecurityTxt('42')).toBeNull();
        expect(parseJsonSecurityTxt('"a string"')).toBeNull();
        expect(parseJsonSecurityTxt('[1, 2, 3]')).toBeNull();
        expect(parseJsonSecurityTxt('null')).toBeNull();
    });

    test('returns {} when valid JSON object has zero recognized keys', () => {
        const content = JSON.stringify({ custom_x: '1', some_made_up_key: 'y', totally_unknown: 'z' });
        expect(parseJsonSecurityTxt(content)).toEqual({});
    });

    test('skips fields whose value is not a string or string[]', () => {
        const content = JSON.stringify({
            contacts: 42,
            name: 'X',
            policy: { nested: 'object' },
        });
        expect(parseJsonSecurityTxt(content)).toEqual({ name: 'X' });
    });
});
