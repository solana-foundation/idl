import { LOADER_V3_PROGRAM_ADDRESS } from '@solana-program/program-metadata';
import {
    type Address,
    type ReadonlyUint8Array,
    getAddressDecoder,
    getBase64Encoder,
    getU32Decoder,
    getU64Decoder,
    isOffCurveAddress,
} from '@solana/kit';

import {
    LOADER_V2_PROGRAM_ADDRESS,
    PROGRAM_DATA_HEADER_NO_AUTH,
    PROGRAM_DATA_HEADER_WITH_AUTH,
    STATE_PROGRAM,
    STATE_PROGRAM_DATA,
} from './elf-loader.js';
import type { ProgramUpgradeAuthority, SolanaRpcClient } from './types.js';

/** `UpgradeableLoaderState::Program`: 4-byte discriminator + 32-byte programdata_address. */
const PROGRAM_ACCOUNT_HEADER = 36;

const BASE64_ENCODER = getBase64Encoder();
const U32_DECODER = getU32Decoder();
const U64_DECODER = getU64Decoder();
const ADDRESS_DECODER = getAddressDecoder();

/**
 * Fetch only the first `length` bytes of an account. Program and
 * ProgramData accounts carry the full ELF after a small header, so slicing
 * keeps this to a few hundred bytes over the wire instead of megabytes.
 */
async function fetchAccountHeader(
    rpc: SolanaRpcClient,
    account: Address,
    length: number,
): Promise<{ owner: Address; bytes: ReadonlyUint8Array } | null> {
    const { value } = await rpc
        .getAccountInfo(account, { dataSlice: { length, offset: 0 }, encoding: 'base64' })
        .send();
    if (!value) return null;
    return { bytes: BASE64_ENCODER.encode(value.data[0]), owner: value.owner };
}

/**
 * Report who can replace the code of `programId` — the on-chain equivalent
 * of reading the `Authority` and `Last Deployed In Slot` lines from
 * `solana program show`.
 *
 *   - Loader v2 programs are immutable by construction: `authority` is
 *     `null`, `authorityKind` is `'none'`.
 *   - Upgradeable (v3) programs report the `upgrade_authority_address`
 *     and deploy slot stored in their `ProgramData` account. A `null`
 *     authority means the program was made immutable.
 *
 * `authorityKind` distinguishes a plain keypair (one key can redeploy the
 * program) from an off-curve address (a PDA, typically a multisig vault
 * such as Squads, or another program). It does not resolve the multisig
 * behind a PDA, so members, threshold and timelock must be checked
 * separately.
 *
 * Returns `null` when the account doesn't exist, isn't owned by a
 * supported loader (v2 or v3; v4 is not supported yet), or is malformed.
 */
export async function fetchProgramUpgradeAuthority(
    rpc: SolanaRpcClient,
    programId: Address,
): Promise<ProgramUpgradeAuthority | null> {
    const program = await fetchAccountHeader(rpc, programId, PROGRAM_ACCOUNT_HEADER);
    if (!program) return null;

    if (program.owner === LOADER_V2_PROGRAM_ADDRESS) {
        return {
            authority: null,
            authorityKind: 'none',
            lastDeployedSlot: null,
            loader: 'v2',
            programDataAddress: null,
            programId,
        };
    }

    if (program.owner !== LOADER_V3_PROGRAM_ADDRESS) return null;
    if (program.bytes.length < PROGRAM_ACCOUNT_HEADER) return null;
    if (U32_DECODER.decode(program.bytes, 0) !== STATE_PROGRAM) return null;
    const programDataAddress = ADDRESS_DECODER.decode(program.bytes, 4);

    const programData = await fetchAccountHeader(rpc, programDataAddress, PROGRAM_DATA_HEADER_WITH_AUTH);
    if (!programData || programData.owner !== LOADER_V3_PROGRAM_ADDRESS) return null;
    const pdBytes = programData.bytes;
    if (pdBytes.length < PROGRAM_DATA_HEADER_NO_AUTH) return null;
    if (U32_DECODER.decode(pdBytes, 0) !== STATE_PROGRAM_DATA) return null;

    const lastDeployedSlot = U64_DECODER.decode(pdBytes, 4);
    const authorityOption = pdBytes[12];
    let authority: Address | null;
    if (authorityOption === 0) authority = null;
    else if (authorityOption === 1 && pdBytes.length >= PROGRAM_DATA_HEADER_WITH_AUTH)
        authority = ADDRESS_DECODER.decode(pdBytes, 13);
    else return null;

    return {
        authority,
        authorityKind: authority === null ? 'none' : isOffCurveAddress(authority) ? 'pda' : 'keypair',
        lastDeployedSlot,
        loader: 'v3',
        programDataAddress,
        programId,
    };
}
