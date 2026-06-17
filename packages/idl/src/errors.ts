import {
    type Address,
    isSolanaError,
    SOLANA_ERROR__JSON_RPC__INTERNAL_ERROR,
    SOLANA_ERROR__JSON_RPC__PARSE_ERROR,
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

// ─── Decode failures ─────────────────────────────────────────────────────────

/** Why an existing on-chain account could not be turned into an IDL. */
export type IdlDecodeReason =
    /** Account bytes don't form a decompressible `IdlAccount` (bad layout or inflate failure). */
    | 'bytes'
    /** Decompressed content is not valid JSON. */
    | 'json'
    /** Parsed JSON is not a recognisable IDL (e.g. missing `instructions`). */
    | 'shape';

/**
 * Thrown when an IDL account **exists on-chain but its bytes can't be turned
 * into a usable IDL** — corrupt/partial writes, truncated buffers, or non-IDL
 * data parked at the derived address.
 *
 * This is deliberately distinct from a `null` return (no IDL published) and
 * from an RPC/transport {@link https://github.com/anza-xyz/kit SolanaError}
 * (upstream is flaky). Callers typically map this to a "present but
 * undecodable" outcome (e.g. HTTP 200 with `null` body) rather than a retry.
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

// ─── RPC error classification ──────────────────────────────────────────────────

/**
 * How to treat an RPC failure:
 *  - `transient` — upstream is overloaded/flaky; safe to retry or surface as 5xx.
 *  - `misconfig`  — a 4xx-style / permanent fault (bad URL, auth, method); retrying won't help.
 */
export type RpcErrorClass = 'transient' | 'misconfig';

/**
 * JSON-RPC server error codes that reflect transient node/cluster state rather
 * than a permanent fault. Mirrors the set the Explorer used inline.
 */
const TRANSIENT_RPC_ERROR_CODES = new Set<SolanaErrorCode>([
    SOLANA_ERROR__JSON_RPC__INTERNAL_ERROR,
    SOLANA_ERROR__JSON_RPC__PARSE_ERROR,
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
 * `fetchAnchorIdl`, `resolveAnchorIdl`, history reconstruction, …).
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
