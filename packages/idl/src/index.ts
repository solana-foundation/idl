// ─── Headline: "give me the IDL" ─────────────────────────────────────────────
export {
    fetchAnchorIdl,
    fetchAnchorIdlFromBuffer,
    fetchIdl,
    fetchIdlFromBuffer,
    fetchIdlWrapped,
} from './current-idl.js';

// ─── Result types + unwrap helpers ───────────────────────────────────────────
export { parseIdl, unwrapIdl, unwrapIdlOrThrow } from './idl-result.js';
export type { FetchIdlResult, Idl, IdlResult, IdlSource, PmpIdlResult } from './idl-result.js';

// ─── Error handling: failure taxonomy + RPC classification ───────────────────
export { classifyRpcError, IdlDecodeError, IdlValidationError, isTransientRpcError } from './errors.js';
export type { IdlDecodeReason, IdlValidationReason, RpcErrorClass } from './errors.js';

export { buildPmpIdlLookups, fetchPmpIdl, fetchPmpIdlFromBuffer, IDL_FALLBACK_PMP_AUTHORITIES } from './pmp-idl.js';
export type { PmpDecodeFormat, PmpIdlLookup } from './pmp-idl.js';

export { fetchLatestIdls } from './latest-idl.js';
export type { LatestIdls, LatestIdlVersion } from './latest-idl.js';

// ─── History reconstruction ──────────────────────────────────────────────────
export { fetchAllHistories } from './history.js';
export type { AllHistories } from './history.js';

export { findPmpMetadataAddress, reconstructPmpHistory } from './program-metadata.js';
export type { VirtualState } from './program-metadata.js';

export { findAnchorIdlAddress, reconstructAnchorHistory } from './anchor.js';

// ─── Shared low-level types ──────────────────────────────────────────────────
export type { Snapshot, SolanaRpcClient } from './rpc.js';
