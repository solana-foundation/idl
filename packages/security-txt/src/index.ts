// ─── Headline: "give me the security.txt" ────────────────────────────────────
export { fetchSecurityTxt } from './current-security-txt.js';

// ─── Per-source escape hatches ───────────────────────────────────────────────
export { fetchPmpSecurityTxt, findPmpSecurityTxtAddress, SECURITY_TXT_PMP_SEED } from './pmp-security-txt.js';
export { fetchElfSecurityTxt } from './elf-security-txt.js';

// ─── Public types ────────────────────────────────────────────────────────────
export type { SecurityTxt, SecurityTxtFields, SecurityTxtSource, PmpSecurityTxt, ElfSecurityTxt } from './types.js';
