import type { Address } from '@solana/kit';

/**
 * Which on-chain mechanism a {@link SecurityTxt} was sourced from:
 *
 *   - `pmp`: a Program Metadata Program account with seed `security.txt`.
 *     This is the newer, recommended path — see
 *     https://github.com/solana-program/program-metadata.
 *   - `elf`: a `.security.txt` ELF section embedded inside the program's
 *     BPF binary at build time. This is the legacy
 *     https://github.com/neodyme-labs/solana-security-txt convention.
 */
export type SecurityTxtSource = 'pmp' | 'elf';

/**
 * The canonical fields described by the security.txt convention
 * (https://github.com/neodyme-labs/solana-security-txt#format). Every field
 * is optional: implementations should populate whichever were present in the
 * raw on-chain payload and leave the rest `undefined`.
 *
 * The original raw string is always preserved on the wrapper types
 * ({@link PmpSecurityTxt}, {@link ElfSecurityTxt}, {@link SecurityTxt}) so
 * callers that need byte-stable storage (hashes, diffs) can use that and
 * skip the parsed view.
 */
export type SecurityTxtFields = {
    name?: string;
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
