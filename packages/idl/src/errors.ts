import {
    type Address,
    isSolanaError,
    SOLANA_ERROR__JSON_RPC__INTERNAL_ERROR,
    SOLANA_ERROR__JSON_RPC__SCAN_ERROR,
    SOLANA_ERROR__JSON_RPC__SERVER_ERROR_BLOCK_CLEANED_UP,
    SOLANA_ERROR__JSON_RPC__SERVER_ERROR_BLOCK_NOT_AVAILABLE,
    SOLANA_ERROR__JSON_RPC__SERVER_ERROR_BLOCK_STATUS_NOT_AVAILABLE_YET,
    SOLANA_ERROR__JSON_RPC__SERVER_ERROR_KEY_EXCLUDED_FROM_SECONDARY_INDEX,
    SOLANA_ERROR__JSON_RPC__SERVER_ERROR_LONG_TERM_STORAGE_SLOT_SKIPPED,
    SOLANA_ERROR__JSON_RPC__SERVER_ERROR_MIN_CONTEXT_SLOT_NOT_REACHED,
    SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NO_SNAPSHOT,
    SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY,
    SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SLOT_SKIPPED,
    SOLANA_ERROR__JSON_RPC__SERVER_ERROR_TRANSACTION_HISTORY_NOT_AVAILABLE,
    SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
    type SolanaErrorCode,
} from '@solana/kit';

// ─── Decode failures (bytes) ─────────────────────────────────────────────────

/**
 * Why on-chain *bytes* couldn't be decoded — a byte-level failure. Distinct
 * from {@link IdlValidationReason}, which is about decoded *content* not being
 * a usable IDL. Note `'json'` is **not** here: content that decodes but isn't
 * JSON is an `ok` result (the raw bytes are preserved), surfaced later as a
 * *validation* failure (see {@link IdlValidationReason}), not a decode one.
 */
export type IdlDecodeReason =
    /**
     * The account isn't shaped like an IDL container at all — the outer
     * structure won't parse. (Anchor: bytes don't match the `IdlAccount`
     * header/length framing. PMP: the bytes aren't a decodable `Buffer` account,
     * with the decode error on `cause`.)
     */
    | 'framing'
    /**
     * The container parsed, but its payload couldn't be turned into content.
     * (Anchor: the zlib payload failed to inflate. PMP: it's empty, or no
     * candidate encoding/compression yielded a non-empty string.) The underlying
     * error, when there is one, is on `cause`.
     */
    | 'payload';

/**
 * Thrown when an IDL account **exists on-chain but its bytes can't be decoded**
 * — corrupt/partial writes, truncated buffers, or non-IDL data parked at the
 * derived address (a byte-level failure: `'framing'` or `'payload'`).
 *
 * This is deliberately distinct from a `null` return (no IDL published), from
 * an {@link IdlValidationError} (bytes decoded but the content isn't a usable
 * IDL), and from an RPC/transport {@link https://github.com/anza-xyz/kit SolanaError}
 * (upstream is flaky). Callers typically map this to a "present but
 * undecodable" outcome (e.g. HTTP 422) rather than a retry.
 *
 * TODO(anza-xyz/kit#1576): build on `createCodedErrorClass` once it ships, so
 * this aligns with kit's coded-error ergonomics instead of a bespoke subclass.
 */
export class IdlDecodeError extends Error {
    override readonly name = 'IdlDecodeError';
    /** Address of the account that failed to decode. */
    readonly address: Address;
    /** Which stage of decoding failed. */
    readonly reason: IdlDecodeReason;

    constructor(message: string, options: { address: Address; reason: IdlDecodeReason; cause?: unknown }) {
        super(message, { cause: options.cause });
        this.address = options.address;
        this.reason = options.reason;
    }
}

// ─── Validation failures (content) ───────────────────────────────────────────

/**
 * Why decoded *content* isn't a usable IDL — a validation failure, one layer
 * above {@link IdlDecodeReason} (which is byte-level). Validation is parse +
 * object, not full IDL-schema checking.
 */
export type IdlValidationReason =
    /** Content didn't parse as JSON. */
    | 'json'
    /** Parsed, but isn't a JSON object (array / primitive / null). */
    | 'shape';

/**
 * Thrown when an IDL account decoded fine but its **content isn't a usable
 * IDL** — it didn't parse as JSON (`'json'`), or it parsed to something that
 * isn't a JSON object (`'shape'`: an array, primitive, or `null`).
 *
 * Distinct from {@link IdlDecodeError}: the bytes decoded successfully (the raw
 * text is preserved in {@link content}), so this is a *content* problem, not a
 * byte-level one. Carries the raw `content` so callers can inspect or re-store
 * it; `address` is optional because validation can run on content that wasn't
 * fetched from a specific account.
 */
export class IdlValidationError extends Error {
    override readonly name = 'IdlValidationError';
    /** Which validation step failed. */
    readonly reason: IdlValidationReason;
    /** The raw decoded content that failed validation. */
    readonly content: string;
    /** Address of the account the content came from, when known. */
    readonly address?: Address;

    constructor(message: string, options: { reason: IdlValidationReason; content: string; address?: Address }) {
        super(message);
        this.reason = options.reason;
        this.content = options.content;
        this.address = options.address;
    }
}

// ─── RPC error classification ──────────────────────────────────────────────────

/**
 * How to treat an RPC failure:
 *  - `transient` — upstream is overloaded/flaky; safe to retry or surface as 5xx.
 *  - `misconfig`  — a 4xx-style / permanent fault (bad URL, auth, method); retrying won't help.
 */
export type RpcErrorClass = 'transient' | 'misconfig';

/**
 * JSON-RPC server error codes that reflect transient node/cluster state rather
 * than a permanent fault; retrying (or surfacing as a 5xx) may succeed.
 *
 * Deliberately excludes the client-fault codes (`-32700` parse, `-32600`
 * invalid request, `-32601` method not found, `-32602` invalid params): those
 * mean the request itself is wrong, so retrying it unchanged loops forever.
 * They fall through to `misconfig`.
 */
const TRANSIENT_RPC_ERROR_CODES = new Set<SolanaErrorCode>([
    SOLANA_ERROR__JSON_RPC__INTERNAL_ERROR,
    SOLANA_ERROR__JSON_RPC__SCAN_ERROR,
    SOLANA_ERROR__JSON_RPC__SERVER_ERROR_BLOCK_CLEANED_UP,
    SOLANA_ERROR__JSON_RPC__SERVER_ERROR_BLOCK_NOT_AVAILABLE,
    SOLANA_ERROR__JSON_RPC__SERVER_ERROR_BLOCK_STATUS_NOT_AVAILABLE_YET,
    SOLANA_ERROR__JSON_RPC__SERVER_ERROR_KEY_EXCLUDED_FROM_SECONDARY_INDEX,
    SOLANA_ERROR__JSON_RPC__SERVER_ERROR_LONG_TERM_STORAGE_SLOT_SKIPPED,
    SOLANA_ERROR__JSON_RPC__SERVER_ERROR_MIN_CONTEXT_SLOT_NOT_REACHED,
    SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NO_SNAPSHOT,
    SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY,
    SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SLOT_SKIPPED,
    SOLANA_ERROR__JSON_RPC__SERVER_ERROR_TRANSACTION_HISTORY_NOT_AVAILABLE,
]);

/**
 * Classify an error thrown out of an RPC-backed fetch (`fetchIdl`,
 * `fetchAnchorIdl`, history reconstruction, …).
 *
 * Returns `null` for anything that isn't a `SolanaError` — e.g. an
 * {@link IdlDecodeError} or a programming bug — so callers can branch on
 * "is this even an RPC problem?" without reaching into `@solana/kit` internals.
 */
export function classifyRpcError(error: unknown): RpcErrorClass | null {
    if (!isSolanaError(error)) return null;
    if (TRANSIENT_RPC_ERROR_CODES.has(error.context.__code)) return 'transient';
    if (isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR)) {
        const { statusCode } = error.context;
        return statusCode >= 500 || statusCode === 429 ? 'transient' : 'misconfig';
    }
    return 'misconfig';
}

/**
 * Convenience predicate over {@link classifyRpcError}: `true` only for RPC
 * errors that are worth retrying / surfacing as an upstream (5xx) failure.
 */
export function isTransientRpcError(error: unknown): boolean {
    return classifyRpcError(error) === 'transient';
}
