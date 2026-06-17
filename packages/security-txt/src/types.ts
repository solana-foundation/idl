import type { Address, createSolanaRpc } from '@solana/kit';

/**
 * Which on-chain mechanism a {@link SecurityTxt} was sourced from:
 *
 *   - `pmp`: a Program Metadata Program account with seed `security`.
 *     This is the newer, recommended path — see
 *     https://github.com/solana-program/program-metadata.
 *   - `elf`: a `.security.txt` ELF section embedded inside the program's
 *     BPF binary at build time. This is the legacy
 *     https://github.com/neodyme-labs/solana-security-txt convention.
 */
export type SecurityTxtSource = 'pmp' | 'elf';

/**
 * RPC handle from {@link createSolanaRpc} (mainnet or devnet URLs; PMP
 * isn't deployed on testnet). Re-exported here as a convenience so
 * callers don't have to spell out the full kit `Rpc<…Api>` generic.
 */
export type SolanaRpcClient = ReturnType<typeof createSolanaRpc>;

/**
 * The 12 keys defined by the original [neodyme spec][neodyme]. This is
 * exactly what the `security_txt!` Rust macro emits into the
 * `.security.txt` ELF section. ELF-sourced security.txts will only ever
 * populate from this set.
 *
 * [neodyme]: https://github.com/neodyme-labs/solana-security-txt#format
 */
export type NeodymeSecurityTxtFields = {
    /** Required by neodyme: project name. */
    name?: string;
    /** Required by neodyme: project home URL. */
    project_url?: string;
    /** Required by neodyme: comma-separated `<scheme>:<value>` contacts (`email:`, `discord:`, …). */
    contacts?: string;
    /** Required by neodyme: link to the security policy. */
    policy?: string;
    /** Optional: comma-separated ISO 639-1 language codes the team accepts reports in. */
    preferred_languages?: string;
    /** Optional: PGP key (URL or inline). */
    encryption?: string;
    /** Optional: URL to the program source code. */
    source_code?: string;
    /** Optional: release tag/version the deployed program corresponds to. */
    source_release?: string;
    /** Optional: git revision hash the deployed program corresponds to. */
    source_revision?: string;
    /** Optional: comma-separated auditor names or URLs. */
    auditors?: string;
    /** Optional: URL to a public security acknowledgements / hall-of-fame page. */
    acknowledgements?: string;
    /** Optional: expiry date in `YYYY-MM-DD` form. */
    expiry?: string;
};

/**
 * The 5 extension keys defined by the [SPL Program Metadata
 * convention][pmp] on top of the neodyme spec. PMP-sourced security.txts
 * (JSON uploads via `program-metadata write security ...`) commonly
 * carry these; the neodyme `security_txt!` macro never emits them, so
 * ELF-sourced security.txts won't have them populated.
 *
 * [pmp]: https://github.com/solana-program/program-metadata#securitytxt-file-format
 */
export type PmpExtraSecurityTxtFields = {
    /** URL of a project logo. Often shown by the Solana Explorer next to the program. */
    logo?: string;
    /** Short human description of what the program does. */
    description?: string;
    /** Maintainer's most current notification (e.g. "upgrade pending on $DATE"). */
    notification?: string;
    /** URL to the project SDK / clients. */
    sdk?: string;
    /** Version string for the published metadata itself (NOT the program's release tag — that's `source_release`). */
    version?: string;
};

/**
 * Full union of keys recognised by every on-chain security.txt
 * convention this package supports. Splits cleanly into:
 *
 *   - {@link NeodymeSecurityTxtFields} — the 12 keys from the original
 *     [neodyme spec][neodyme], emitted by the `security_txt!` Rust macro.
 *     ELF and PMP can both carry these.
 *   - {@link PmpExtraSecurityTxtFields} — 5 extra keys from the
 *     [SPL Program Metadata convention][pmp]. PMP-only — the macro
 *     doesn't emit them.
 *
 * Every field is optional: implementations populate whichever were present
 * in the raw on-chain payload and leave the rest `undefined`.
 *
 * Unknown keys are intentionally NOT exposed here — the original raw
 * string is preserved on the wrapper types ({@link PmpSecurityTxt},
 * {@link ElfSecurityTxt}, {@link SecurityTxt}) so callers that need
 * byte-stable storage (hashes, diffs) or custom-key access can use that
 * and skip the parsed view.
 *
 * [neodyme]: https://github.com/neodyme-labs/solana-security-txt#format
 * [pmp]: https://github.com/solana-program/program-metadata#securitytxt-file-format
 */
export type SecurityTxtFields = NeodymeSecurityTxtFields & PmpExtraSecurityTxtFields;

export type PmpSecurityTxt = {
    /** PMP metadata account holding the security.txt. */
    address: Address;
    /** PMP authority that published this entry (null = canonical / upgrade authority). */
    authority: Address | null;
    /** Raw on-chain bytes, decoded as a UTF-8 string. */
    content: string;
    /** Parsed key/value fields. */
    fields: SecurityTxtFields;
};

export type ElfSecurityTxt = {
    /** The program executable account whose ELF binary held the section. */
    address: Address;
    /** Raw `.security.txt` ELF section payload, decoded as UTF-8. */
    content: string;
    /** Parsed key/value fields. */
    fields: SecurityTxtFields;
};

/**
 * Result of {@link fetchSecurityTxt}: the parsed security.txt plus which
 * source produced it. Mirrors `Idl` from `@solana/idl`.
 */
export type SecurityTxt = {
    programId: string;
    type: SecurityTxtSource;
    content: string;
    fields: SecurityTxtFields;
};
