/**
 * Throwaway: trace exactly what `fetchMetadataContent` does for a given
 * (program, seed) pair. Helps when `fetchPmpSecurityTxt` returns null but
 * `debug-pmp` shows the account exists.
 */
import { fetchMetadataContent, fetchMetadataFromSeeds, type Seed } from '@solana-program/program-metadata';
import { type Address, createSolanaRpc } from '@solana/kit';

async function main(): Promise<void> {
    const programId = process.argv[2] as Address | undefined;
    const seed = (process.argv[3] ?? 'security') as Seed;
    if (!programId) {
        console.error('usage: tsx scripts/debug-fetch.ts <program-id> [seed]');
        process.exit(1);
    }
    const rpcUrl = process.env['RPC_MAINNET'] ?? 'https://api.mainnet-beta.solana.com';
    const rpc = createSolanaRpc(rpcUrl);
    console.log(`program: ${programId}`);
    console.log(`seed:    ${JSON.stringify(seed)}`);
    console.log(`rpc:     ${rpcUrl}\n`);

    console.log('1) fetchMetadataFromSeeds (raw account):');
    try {
        const meta = await fetchMetadataFromSeeds(rpc, { authority: null, program: programId, seed });
        console.log(`   PDA:      ${meta.address}`);
        console.log(`   seed:     ${JSON.stringify(meta.data.seed)}`);
        console.log(`   dataLen:  ${meta.data.dataLength}`);
        console.log(`   encoding: ${meta.data.encoding}`);
        console.log(`   compression: ${meta.data.compression}`);
        console.log(`   format:   ${meta.data.format}`);
        console.log(`   dataSource: ${meta.data.dataSource}`);
        console.log(`   data bytes (first 64): ${Buffer.from(meta.data.data.slice(0, 64)).toString('hex')}`);
    } catch (e) {
        console.log(`   ERROR: ${(e as Error).message}`);
    }

    console.log('\n2) fetchMetadataContent:');
    try {
        const content = await fetchMetadataContent(rpc, programId, seed, null);
        console.log(`   content length: ${content?.length ?? 0}`);
        console.log('   ---');
        console.log(content?.replaceAll('\0', '·'));
        console.log('   ---');
    } catch (e) {
        console.log(`   ERROR: ${(e as Error).message}`);
        console.log(`   stack: ${(e as Error).stack}`);
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
