import type { Address } from '@solana/kit';

import { IdlDecodeError, IdlValidationError, type IdlDecodeReason, type IdlValidationReason } from './errors.js';

// ─── Core types ──────────────────────────────────────────────────────────────

export type IdlSource = 'pmp' | 'anchor';

/**
 * A resolved, valid IDL — what {@link unwrapIdl} / {@link unwrapIdlOrThrow}
 * produce. `T` defaults to `unknown`; pass your own IDL type to opt into a
 * typed `idl` (an unchecked assertion — the parsed value isn't checked against
 * `T` beyond "is a JSON object"). `idl` is always a parsed JSON **object**:
 * content that isn't valid JSON, or parses to a non-object, never reaches here
 * (see {@link IdlValidationReason}).
 */
export type Idl<T = unknown> = {
    source: IdlSource;
    address: Address;
    /** Always a parsed JSON object (never a string, primitive, or array). */
    idl: T;
};

// ─── Result types ──────────────────────────────────────────────────────────────

/**
 * The one fetch result shape, parameterized by source. Every fetch returns one
 * of three statuses:
 *  - `ok` carries the raw `content` — the lossless primitive, byte-exact for
 *    hashing/diffing. Parsing is deferred to the {@link unwrapIdl} boundary, so
 *    the parsed form lives only on {@link Idl}, never duplicated alongside
 *    `content`.
 *  - `corrupt` is **about bytes**: the account exists but its bytes fail to
 *    decode structurally — `'framing'` or `'payload'`. Decoded content that
 *    isn't valid JSON is *not* corrupt (it's `ok`, raw bytes preserved); that's
 *    a validation failure surfaced at unwrap time.
 *  - `absent` — no account published. Carries the `address` that was queried
 *    (the derived PDA, or the buffer address you passed) so callers can log or
 *    retry without re-deriving it. Note it has **no** `source`: for an
 *    auto-detect buffer or the PMP→Anchor orchestrator there's no honest single
 *    source when nothing was found, so every `absent` is just `{ address }`.
 *
 * `S` narrows the source per fetcher: `IdlResult<'anchor'>` is an Anchor
 * result, `IdlResult<'pmp'>` a PMP buffer, and bare `IdlResult` an auto-detect
 * buffer (`source` could be either).
 */
export type IdlResult<S extends IdlSource = IdlSource> =
    | { status: 'ok'; source: S; address: Address; content: string }
    | { status: 'corrupt'; source: S; address: Address; reason: IdlDecodeReason; cause?: unknown }
    | { status: 'absent'; address: Address };

/**
 * The lone specialization of {@link IdlResult}: a *resolved* PMP fetch
 * ({@link fetchPmpIdl}) also reports which `authority` matched (canonical
 * `null`, or a fallback). That's a fact about PMP resolution, not about a
 * result in general, so it lives only here — never on a buffer result.
 */
export type PmpIdlResult =
    | { status: 'ok'; source: 'pmp'; address: Address; authority: Address | null; content: string }
    | {
          status: 'corrupt';
          source: 'pmp';
          address: Address;
          authority: Address | null;
          reason: IdlDecodeReason;
          cause?: unknown;
      }
    | { status: 'absent'; address: Address };

/**
 * What {@link fetchIdlWrapped} returns: the winning (or most-relevant) single
 * per-source result — just the union of the two per-source result types, no
 * bespoke shape.
 */
export type FetchIdlResult = IdlResult<'anchor'> | PmpIdlResult;

/** Any per-source result accepted by the `unwrap*` helpers. */
type AnyIdlResult = IdlResult | PmpIdlResult;

// ─── Parse + validate ──────────────────────────────────────────────────────────

/**
 * The value-returning parse-and-validate primitive the `unwrap*` helpers build
 * on. Run it on an `ok` result's `content`: it must parse as JSON **and** be a
 * non-null, non-array object. The failure is *retrievable* as a `reason`
 * (`'json'` / `'shape'`) rather than just `null`.
 *
 * This is parse + object, **not** full IDL-schema validation: `{}` or
 * `{ "anything": 1 }` passes (a JSON object, just not checked for IDL fields),
 * while `42`, `"hi"`, and `[]` fail with `'shape'`.
 */
export function parseIdl<T = unknown>(
    content: string,
): { ok: true; idl: T } | { ok: false; reason: IdlValidationReason } {
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch {
        return { ok: false, reason: 'json' };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { ok: false, reason: 'shape' };
    }
    return { idl: parsed as T, ok: true };
}

// ─── Unwrap helpers ──────────────────────────────────────────────────────────

/**
 * Collapse any fetch result to the easy {@link Idl} shape. This is the single
 * parse-and-validate boundary: `content` is parsed to `idl` here and required
 * to be a JSON object, so raw and parsed never coexist on one type.
 *
 * `ok` + JSON object → {@link Idl}; invalid content / `corrupt` / `absent` →
 * `null`. Never throws on data — use {@link unwrapIdlOrThrow} to surface
 * present-but-unusable outcomes as errors.
 */
export function unwrapIdl<T = unknown>(result: AnyIdlResult): Idl<T> | null {
    if (result.status !== 'ok') return null;
    const parsed = parseIdl<T>(result.content);
    if (!parsed.ok) return null;
    return { address: result.address, idl: parsed.idl, source: result.source };
}

/**
 * Like {@link unwrapIdl}, but throws on anything *present but unusable*:
 * `corrupt` bytes throw {@link IdlDecodeError}, and invalid content throws
 * {@link IdlValidationError}. Only `absent` stays `null` (hence `Idl | null`,
 * not `Idl`) — "no IDL published" isn't an error. Want `absent` to throw too?
 * Check for `null` yourself.
 */
export function unwrapIdlOrThrow<T = unknown>(result: AnyIdlResult): Idl<T> | null {
    switch (result.status) {
        case 'absent':
            return null;
        case 'corrupt':
            throw new IdlDecodeError(
                `IDL account at ${result.address} is present but its bytes failed to decode (${result.reason})`,
                { address: result.address, cause: result.cause, reason: result.reason },
            );
        case 'ok': {
            const parsed = parseIdl<T>(result.content);
            if (!parsed.ok) {
                throw new IdlValidationError(
                    `IDL content at ${result.address} is not a usable IDL (${parsed.reason})`,
                    { address: result.address, content: result.content, reason: parsed.reason },
                );
            }
            return { address: result.address, idl: parsed.idl, source: result.source };
        }
    }
}
