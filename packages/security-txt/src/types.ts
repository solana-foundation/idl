import type { Address } from '@solana/kit';

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
 * The full union of keys recognised by every on-chain security.txt
 * convention this package supports:
 *
 *   - The 12 keys from the original [neodyme spec][neodyme] (`.security.txt`
 *     ELF section), which is what older programs publish via the
 *     `security_txt!` Rust macro.
 *   - 5 extra keys from the [SPL Program Metadata convention][pmp] — `logo`,
 *     `description`, `notification`, `sdk`, `version` — that PMP uploads
 *     (e.g. via `solana-program-metadata metadata upload`) commonly carry.
 *
 * Every field is optional: implementations populate whichever were present
 * in the raw on-chain payload and leave the rest `undefined`. ELF-sourced
 * security.txts won't populate the PMP-specific keys (the macro doesn't
 * emit them); PMP-sourced ones may populate all 17.
 *
 * Unknown keys are intentionally NOT exposed here — the original raw string
 * is preserved on the wrapper types ({@link PmpSecurityTxt},
 * {@link ElfSecurityTxt}, {@link SecurityTxt}) so callers that need
 * byte-stable storage (hashes, diffs) or custom-key access can use that
 * and skip the parsed view.
 *
 * [neodyme]: https://github.com/neodyme-labs/solana-security-txt#format
 * [pmp]: https://github.com/solana-developers/idl-program#metadata
 */
export type SecurityTxtFields = {
    name?: string;
    logo?: string;
    description?: string;
    notification?: string;
    sdk?: string;
    project_url?: string;
    contacts?: string;
    policy?: string;
    preferred_languages?: string;
    encryption?: string;
    source_code?: string;
    source_release?: string;
    source_revision?: string;
    auditors?: string;
    acknowledgements?: string;
    expiry?: string;
    version?: string;
};

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
