// ─── Headline: "give me the security.txt" ────────────────────────────────────
export { fetchSecurityTxt } from './current-security-txt.js';

// ─── Per-source escape hatches ───────────────────────────────────────────────
export {
    fetchPmpSecurityTxt,
    findPmpSecurityTxtAddress,
    SECURITY_TXT_FALLBACK_PMP_AUTHORITIES,
    SECURITY_TXT_PMP_SEED,
} from './pmp-security-txt.js';
export { fetchElfSecurityTxt } from './elf-security-txt.js';

// ─── Public types ────────────────────────────────────────────────────────────
export type {
    ElfSecurityTxt,
    NeodymeSecurityTxtFields,
    PmpExtraSecurityTxtFields,
    PmpSecurityTxt,
    SecurityTxt,
    SecurityTxtFields,
    SecurityTxtSource,
    SolanaRpcClient,
} from './types.js';
