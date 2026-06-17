import type { NeodymeSecurityTxtFields, PmpExtraSecurityTxtFields, SecurityTxtFields } from './types.js';

/**
 * Sentinels written by the neodyme-labs `security_txt!` macro. The exact byte
 * counts matter: the macro emits seven `=` characters on each side, so any
 * shorter literal would still `indexOf`-match (as a substring) but leave
 * leftover `=` bytes inside the extracted payload — which then shifts every
 * NUL-delimited (key, value) pair by one slot and silently produces an empty
 * `fields` object. See the upstream macro at
 * https://github.com/neodyme-labs/solana-security-txt for the exact literal.
 */
const BEGIN_SENTINEL = '=======BEGIN SECURITY.TXT V1=======';
const END_SENTINEL = '=======END SECURITY.TXT V1=======';

/**
 * Hard cap on how many bytes after a BEGIN marker we'll scan looking for the
 * END marker. The whole macro-emitted section is a few KB at most in practice;
 * anything bigger is almost certainly a false positive (e.g. the BEGIN string
 * appearing as a static literal elsewhere in the binary) and we want to bail
 * fast rather than walk the entire ELF.
 */
const MAX_SECTION_SCAN_BYTES = 16 * 1024;

const TEXT_DECODER = new TextDecoder('utf-8', { fatal: false });

/**
 * The 12 keys defined by the original [neodyme spec][neodyme]. These are
 * the only keys the `security_txt!` Rust macro emits into the ELF section,
 * so ELF-sourced security.txts will only ever populate from this set.
 *
 * [neodyme]: https://github.com/neodyme-labs/solana-security-txt#format
 */
export const NEODYME_KEYS: ReadonlySet<keyof NeodymeSecurityTxtFields> = new Set([
    'name',
    'project_url',
    'contacts',
    'policy',
    'preferred_languages',
    'encryption',
    'source_code',
    'source_release',
    'source_revision',
    'auditors',
    'acknowledgements',
    'expiry',
]);

/**
 * The 5 extension keys defined by the SPL Program Metadata convention but
 * NOT by the original neodyme spec. PMP-sourced security.txts (JSON
 * uploads via `program-metadata write security ...`) commonly populate
 * these; ELF-sourced ones never will.
 */
export const PMP_EXTRA_KEYS: ReadonlySet<keyof PmpExtraSecurityTxtFields> = new Set([
    'logo',
    'description',
    'notification',
    'sdk',
    'version',
]);

/**
 * Union of every key the package will surface in {@link SecurityTxtFields}.
 * Both parsers ({@link parseSecurityTxtPayload} for NUL-delimited and
 * {@link parseJsonSecurityTxt} for JSON) currently accept the full union,
 * because consumer uploads sometimes mix conventions. If a caller wants to
 * filter to a stricter subset post-parse, the two sub-sets are exported
 * above for that purpose.
 */
const KNOWN_KEYS: ReadonlySet<keyof SecurityTxtFields> = new Set([...NEODYME_KEYS, ...PMP_EXTRA_KEYS]);

/** Lower-cased ASCII bytes for a small literal — used for the byte-level sentinel search. */
function asciiBytes(str: string): Uint8Array {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i);
    return out;
}

const BEGIN_BYTES = asciiBytes(BEGIN_SENTINEL);
const END_BYTES = asciiBytes(END_SENTINEL);

/**
 * Find `needle` inside `haystack` starting at `from`, or `-1` if absent.
 * Hand-rolled because `Uint8Array` has no `indexOf` for subarrays and we want
 * to avoid an O(n) String conversion on a multi-MB binary.
 */
function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from: number): number {
    if (needle.length === 0) return from;
    if (haystack.length - from < needle.length) return -1;
    const first = needle[0]!;
    const last = haystack.length - needle.length;
    outer: for (let i = from; i <= last; i++) {
        if (haystack[i] !== first) continue;
        for (let j = 1; j < needle.length; j++) {
            if (haystack[i + j] !== needle[j]) continue outer;
        }
        return i;
    }
    return -1;
}

/**
 * Locate the `.security.txt` payload inside arbitrary bytes — usually the raw
 * ELF of a Solana program. Returns the *inner* payload (everything between
 * the BEGIN and END sentinels, exclusive of both), or `null` if no
 * well-formed section is present.
 *
 * Implementation note: we don't parse ELF section tables. Instead we scan for
 * the BEGIN sentinel directly. The neodyme macro emits the section verbatim
 * into the binary, so the sentinel survives the link step and is trivially
 * findable. The false-positive risk (someone's string literal happening to
 * contain `=======BEGIN SECURITY.TXT V1=======`) is mitigated by also requiring
 * a matching END sentinel within {@link MAX_SECTION_SCAN_BYTES}.
 */
export function extractSecurityTxtSection(bytes: Uint8Array): Uint8Array | null {
    let cursor = 0;
    while (cursor < bytes.length) {
        const beginAt = indexOfBytes(bytes, BEGIN_BYTES, cursor);
        if (beginAt === -1) return null;
        const payloadStart = beginAt + BEGIN_BYTES.length;
        // Cap the scan distance so a stray BEGIN string elsewhere in the
        // binary can't make us search to EOF.
        const scanEnd = Math.min(bytes.length, payloadStart + MAX_SECTION_SCAN_BYTES);
        const scanSlice = bytes.subarray(payloadStart, scanEnd);
        const endRelative = indexOfBytes(scanSlice, END_BYTES, 0);
        if (endRelative !== -1) {
            return scanSlice.subarray(0, endRelative);
        }
        // Maybe this BEGIN was a string literal somewhere; try again past it.
        cursor = payloadStart;
    }
    return null;
}

/**
 * Split a `\0`-terminated payload into the raw `(key, value)` string pairs
 * the macro emitted. Trailing NUL bytes on the last entry are tolerated, as
 * is a final empty trailing entry left by the macro's sentinel chunk.
 */
function splitNulPairs(payload: Uint8Array): { key: string; value: string }[] {
    const parts: string[] = [];
    let start = 0;
    for (let i = 0; i < payload.length; i++) {
        if (payload[i] === 0) {
            parts.push(TEXT_DECODER.decode(payload.subarray(start, i)));
            start = i + 1;
        }
    }
    if (start < payload.length) {
        parts.push(TEXT_DECODER.decode(payload.subarray(start)));
    }

    // The macro emits a single `\0` right after the BEGIN sentinel, which
    // splits into one structural leading empty. Drop ONLY that one so the
    // first real part is a key. We deliberately do NOT trim trailing
    // empties: a legitimate empty value (e.g. `expiry\0\0`) ends in an empty
    // string that would otherwise be dropped, shifting subsequent
    // (key, value) pairs and silently losing the field. The pair loop's
    // `i + 1 < parts.length` guard already tolerates an odd-length tail.
    if (parts[0] === '') parts.shift();

    const pairs: { key: string; value: string }[] = [];
    for (let i = 0; i + 1 < parts.length; i += 2) {
        pairs.push({ key: parts[i]!, value: parts[i + 1]! });
    }
    return pairs;
}

/**
 * Parse a raw security.txt payload (everything between the BEGIN and END
 * sentinels) into a typed {@link SecurityTxtFields}. Unknown keys are
 * silently dropped to keep the typed surface stable; callers that need
 * those should fall back to the raw `content` string preserved on the
 * wrapper types.
 */
export function parseSecurityTxtPayload(payload: Uint8Array): SecurityTxtFields {
    const fields: SecurityTxtFields = {};
    for (const { key, value } of splitNulPairs(payload)) {
        if (KNOWN_KEYS.has(key as keyof SecurityTxtFields)) {
            (fields as Record<string, string>)[key] = value;
        }
    }
    return fields;
}

/** Decode a payload to its raw UTF-8 string form (with NULs preserved). */
export function payloadToString(payload: Uint8Array): string {
    return TEXT_DECODER.decode(payload);
}

/**
 * Parse a `metadata.json`-shaped security.txt — the format the SPL
 * `program-metadata write security ...` CLI produces, which coexists with
 * the neodyme NUL-delimited format on PMP today.
 *
 * Extracts the full union of recognised keys ({@link NEODYME_KEYS} plus
 * {@link PMP_EXTRA_KEYS} — 17 total). Keys outside the union are dropped
 * from `fields` to keep the typed surface stable; callers that need the
 * full original JSON have it on the wrapping result's `content` field.
 *
 * Array values are joined with `,` so JSON shapes like
 * `"contacts": ["email:a@x", "discord:b"]` come out matching the
 * security.txt comma-separated convention (`"email:a@x,discord:b"`).
 *
 * Returns `null` for non-JSON, non-object JSON, or JSON arrays. Returns
 * `{}` for a JSON object with zero recognized keys (so callers can apply
 * their own "looks like a real security.txt" heuristic).
 */
export function parseJsonSecurityTxt(content: string): SecurityTxtFields | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    const fields: SecurityTxtFields = {};
    for (const key of KNOWN_KEYS) {
        const value = obj[key];
        if (typeof value === 'string') {
            (fields as Record<string, string>)[key] = value;
        } else if (Array.isArray(value)) {
            const strings = value.filter((v): v is string => typeof v === 'string');
            if (strings.length > 0) (fields as Record<string, string>)[key] = strings.join(',');
        }
    }
    return fields;
}
