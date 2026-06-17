import { LOADER_V2_PROGRAM_ADDRESS, LOADER_V3_PROGRAM_ADDRESS } from '@solana-program/program-metadata';
import { type Address, fetchEncodedAccount, getAddressDecoder, getU32Decoder } from '@solana/kit';

import type { SolanaRpcClient } from './types.js';


/**
 * `UpgradeableLoaderState` discriminators from
 * https://docs.rs/solana-bpf-loader-program/latest/. We only care about the
 * two we'll dereference: the `Program` variant (carries the ProgramData
 * address) and the `ProgramData` variant (carries the actual ELF after a
 * fixed header).
 */
const STATE_PROGRAM = 2;
const STATE_PROGRAM_DATA = 3;

/**
 * Borsh layout of `UpgradeableLoaderState::ProgramData`:
 *   - 4 bytes: variant discriminator (= 3, LE u32)
 *   - 8 bytes: slot (LE u64) — ignored here
 *   - 1 byte:  `Option<Pubkey>` tag for upgrade_authority_address (0 = None, 1 = Some)
 *   - if tag = 1, 32 bytes: upgrade_authority_address
 *   - rest:    raw ELF bytes
 *
 * So the ELF starts at byte 13 when there's no authority, or byte 45 when
 * there is one. The 1-byte option tag at offset 12 tells us which.
 */
const PROGRAM_DATA_HEADER_NO_AUTH = 13;
const PROGRAM_DATA_HEADER_WITH_AUTH = 45;

const U32_DECODER = getU32Decoder();
const ADDRESS_DECODER = getAddressDecoder();

/**
 * Locate and return the raw ELF byte slice for `programId`, traversing the
 * Upgradeable Loader's two-account layout if needed.
 *
 * Returns `null` for any of the (legitimate) "no ELF available" cases:
 *   - the program account doesn't exist
 *   - the program isn't owned by a known BPF loader (system account, token
 *     mint, normal data account, …)
 *   - upgradeable program account is malformed or its ProgramData child is
 *     missing or malformed
 *
 * Loader v4 isn't supported yet — it's still rare in the wild and has its
 * own layout. Adding it is a localized change to this function once a
 * representative deployment ships.
 *
 * Also returns the `address` we ultimately read ELF bytes from (the
 * ProgramData account for upgradeable programs, the program account itself
 * for v2) so callers can attribute the result on chain.
 */
export async function fetchProgramElf(
    rpc: SolanaRpcClient,
    programId: Address,
): Promise<{ bytes: Uint8Array; sourceAddress: Address } | null> {
    const programAccount = await fetchEncodedAccount(rpc, programId);
    if (!programAccount.exists) return null;

    const owner = programAccount.programAddress;
    const programData = programAccount.data as Uint8Array;

    if (owner === LOADER_V2_PROGRAM_ADDRESS) {
        // Legacy non-upgradeable loader: program account data IS the ELF.
        return programData.length > 0 ? { bytes: programData, sourceAddress: programId } : null;
    }

    if (owner === LOADER_V3_PROGRAM_ADDRESS) {
        // Program variant: 4-byte LE discriminator + 32-byte programdata_address.
        if (programData.length < 36) return null;
        if (U32_DECODER.decode(programData, 0) !== STATE_PROGRAM) return null;
        const programDataAddress = ADDRESS_DECODER.decode(programData, 4);

        const programDataAccount = await fetchEncodedAccount(rpc, programDataAddress);
        if (!programDataAccount.exists) return null;
        const pdBytes = programDataAccount.data as Uint8Array;
        if (pdBytes.length < PROGRAM_DATA_HEADER_NO_AUTH) return null;
        if (U32_DECODER.decode(pdBytes, 0) !== STATE_PROGRAM_DATA) return null;

        // Borsh `Option<Pubkey>` tag is strictly 0 (None) or 1 (Some). Any
        // other byte means the account is corrupt or isn't ProgramData at
        // all — bail rather than silently mis-slice and feed the parser
        // bytes that happen to start at offset 13.
        const authorityOption = pdBytes[12];
        if (authorityOption !== 0 && authorityOption !== 1) return null;
        const elfStart = authorityOption === 1 ? PROGRAM_DATA_HEADER_WITH_AUTH : PROGRAM_DATA_HEADER_NO_AUTH;
        if (pdBytes.length <= elfStart) return null;

        return { bytes: pdBytes.subarray(elfStart), sourceAddress: programDataAddress };
    }

    return null;
}
