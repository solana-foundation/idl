/**
 * Throwaway debug script: enumerate every PMP metadata account that
 * references `<program-id>` (any seed, any authority) so we can see if a
 * security.txt exists under a non-canonical or non-default seed. Helps when
 * `fetchPmpSecurityTxt` returns null but you're pretty sure the program
 * has one.
 *
 *   pnpm --filter @solana/security-txt run debug-pmp <program-id>
 */
import { fetchAllMaybeMetadata, getMetadataDecoder } from '@solana-program/program-metadata';
import { type Address, createSolanaRpc, getAddressEncoder, getBase58Decoder } from '@solana/kit';

import { findPmpSecurityTxtAddress } from '../src/pmp-security-txt.js';

const PROGRAM_METADATA_ID = 'ProgM6JCCvbYkfKqJYHePx4xxSUSqJp7rh8Lyv7nk7S' as Address;
const PROGRAM_FIELD_OFFSET = 1n;

async function main(): Promise<void> {
    const programId = process.argv[2] as Address | undefined;
    if (!programId) {
        console.error('usage: pnpm --filter @solana/security-txt run debug-pmp <program-id>');
        process.exit(1);
    }
    const rpcUrl = process.env['RPC_MAINNET'] ?? 'https://api.mainnet-beta.solana.com';
    const rpc = createSolanaRpc(rpcUrl);

    console.log(`program: ${programId}`);
    console.log(`rpc:     ${rpcUrl}\n`);

    const canonical = await findPmpSecurityTxtAddress(programId, null);
    console.log(`canonical security.txt PDA: ${canonical}`);
    const canonicalAccounts = await fetchAllMaybeMetadata(rpc, [canonical]);
    const canonicalAcct = canonicalAccounts[0];
    if (canonicalAcct?.exists) {
        console.log(
            `  EXISTS — seed=${canonicalAcct.data.seed} authority=${canonicalAcct.data.authority.__option === 'Some' ? canonicalAcct.data.authority.value : '(canonical, no third-party)'} dataLen=${canonicalAcct.data.dataLength}`,
        );
    } else {
        console.log('  not initialised');
    }

    console.log('\nEnumerating all PMP accounts that reference this program …');
    const programBytes = getAddressEncoder().encode(programId);
    const b58 = getBase58Decoder().decode(programBytes);

    const accounts = await rpc
        .getProgramAccounts(PROGRAM_METADATA_ID, {
            commitment: 'confirmed',
            encoding: 'base64',
            filters: [{ memcmp: { bytes: b58, encoding: 'base58', offset: PROGRAM_FIELD_OFFSET } }],
        })
        .send();

    console.log(`found ${accounts.length} candidate account(s):\n`);
    const decoder = getMetadataDecoder();
    for (const { pubkey, account } of accounts) {
        try {
            const data = Buffer.from((account.data as unknown as [string, string])[0], 'base64');
            const meta = decoder.decode(data);
            const authority = meta.authority.__option === 'Some' ? meta.authority.value : '(canonical)';
            console.log(`- ${pubkey}`);
            console.log(`    seed:      ${meta.seed}`);
            console.log(`    authority: ${authority}`);
            console.log(`    program:   ${meta.program}`);
            console.log(`    dataLen:   ${meta.dataLength}`);
            console.log(`    encoding:  ${meta.encoding} compression: ${meta.compression} format: ${meta.format}`);
        } catch (e) {
            console.log(`- ${pubkey} (decode failed: ${(e as Error).message})`);
        }
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
