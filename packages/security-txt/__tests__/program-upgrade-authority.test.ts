import { LOADER_V3_PROGRAM_ADDRESS } from '@solana-program/program-metadata';
import {
    type Address,
    address,
    getAddressEncoder,
    getBase64Decoder,
    getProgramDerivedAddress,
    getU32Encoder,
    getU64Encoder,
} from '@solana/kit';
import { describe, expect, test } from 'vitest';

import { fetchProgramUpgradeAuthority } from '../src/index.js';
import type { SolanaRpcClient } from '../src/types.js';

const LOADER_V2 = address('BPFLoader2111111111111111111111111111111111');
const PROGRAM_ID = address('Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo');
const PROGRAM_DATA = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const KEYPAIR_AUTHORITY = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

type FakeAccount = { owner: Address; data: Uint8Array };

/**
 * Minimal `getAccountInfo` stub that honours `dataSlice`, so tests also
 * pin that the fetcher never asks for more than the account header.
 */
function makeFakeRpc(accounts: Record<string, FakeAccount>, requests: number[] = []): SolanaRpcClient {
    const base64 = getBase64Decoder();
    return {
        getAccountInfo: (addr: Address, config: { dataSlice: { offset: number; length: number } }) => ({
            send: () => {
                requests.push(config.dataSlice.length);
                const account = accounts[addr];
                if (!account) return Promise.resolve({ value: null });
                const { offset, length } = config.dataSlice;
                const data = account.data.subarray(offset, offset + length);
                return Promise.resolve({ value: { data: [base64.decode(data), 'base64'], owner: account.owner } });
            },
        }),
    } as unknown as SolanaRpcClient;
}

function concat(...parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let off = 0;
    for (const p of parts) {
        out.set(p, off);
        off += p.length;
    }
    return out;
}

const ELF = new Uint8Array(4096).fill(0x7f);

function programAccount(): FakeAccount {
    return {
        data: concat(
            new Uint8Array(getU32Encoder().encode(2)),
            new Uint8Array(getAddressEncoder().encode(PROGRAM_DATA)),
        ),
        owner: LOADER_V3_PROGRAM_ADDRESS,
    };
}

function programDataAccount(slot: bigint, authority: Address | null): FakeAccount {
    return {
        data: concat(
            new Uint8Array(getU32Encoder().encode(3)),
            new Uint8Array(getU64Encoder().encode(slot)),
            authority === null
                ? new Uint8Array([0])
                : concat(new Uint8Array([1]), new Uint8Array(getAddressEncoder().encode(authority))),
            ELF,
        ),
        owner: LOADER_V3_PROGRAM_ADDRESS,
    };
}

describe('fetchProgramUpgradeAuthority', () => {
    test('upgradeable program with a keypair authority', async () => {
        const requests: number[] = [];
        const rpc = makeFakeRpc(
            { [PROGRAM_DATA]: programDataAccount(123_456n, KEYPAIR_AUTHORITY), [PROGRAM_ID]: programAccount() },
            requests,
        );
        expect(await fetchProgramUpgradeAuthority(rpc, PROGRAM_ID)).toEqual({
            authority: KEYPAIR_AUTHORITY,
            authorityKind: 'keypair',
            lastDeployedSlot: 123_456n,
            loader: 'v3',
            programDataAddress: PROGRAM_DATA,
            programId: PROGRAM_ID,
        });
        expect(Math.max(...requests)).toBeLessThanOrEqual(45);
    });

    test('upgradeable program with a PDA authority', async () => {
        const [vault] = await getProgramDerivedAddress({ programAddress: PROGRAM_ID, seeds: ['vault'] });
        const rpc = makeFakeRpc({ [PROGRAM_DATA]: programDataAccount(1n, vault), [PROGRAM_ID]: programAccount() });
        const result = await fetchProgramUpgradeAuthority(rpc, PROGRAM_ID);
        expect(result?.authority).toBe(vault);
        expect(result?.authorityKind).toBe('pda');
    });

    test('upgradeable program made immutable', async () => {
        const rpc = makeFakeRpc({ [PROGRAM_DATA]: programDataAccount(42n, null), [PROGRAM_ID]: programAccount() });
        const result = await fetchProgramUpgradeAuthority(rpc, PROGRAM_ID);
        expect(result?.authority).toBeNull();
        expect(result?.authorityKind).toBe('none');
        expect(result?.lastDeployedSlot).toBe(42n);
    });

    test('loader v2 program is immutable', async () => {
        const rpc = makeFakeRpc({ [PROGRAM_ID]: { data: ELF, owner: LOADER_V2 } });
        expect(await fetchProgramUpgradeAuthority(rpc, PROGRAM_ID)).toEqual({
            authority: null,
            authorityKind: 'none',
            lastDeployedSlot: null,
            loader: 'v2',
            programDataAddress: null,
            programId: PROGRAM_ID,
        });
    });

    test('returns null for missing accounts, non-programs, and corrupt ProgramData', async () => {
        expect(await fetchProgramUpgradeAuthority(makeFakeRpc({}), PROGRAM_ID)).toBeNull();

        const systemOwned = makeFakeRpc({
            [PROGRAM_ID]: { data: new Uint8Array(0), owner: address('11111111111111111111111111111111') },
        });
        expect(await fetchProgramUpgradeAuthority(systemOwned, PROGRAM_ID)).toBeNull();

        const missingProgramData = makeFakeRpc({ [PROGRAM_ID]: programAccount() });
        expect(await fetchProgramUpgradeAuthority(missingProgramData, PROGRAM_ID)).toBeNull();

        const corrupt = programDataAccount(1n, null);
        corrupt.data[12] = 7;
        const badOption = makeFakeRpc({ [PROGRAM_DATA]: corrupt, [PROGRAM_ID]: programAccount() });
        expect(await fetchProgramUpgradeAuthority(badOption, PROGRAM_ID)).toBeNull();

        const buffer = programAccount();
        buffer.data[0] = 1;
        expect(await fetchProgramUpgradeAuthority(makeFakeRpc({ [PROGRAM_ID]: buffer }), PROGRAM_ID)).toBeNull();

        const truncated = programDataAccount(1n, KEYPAIR_AUTHORITY);
        truncated.data = truncated.data.subarray(0, 30);
        const truncatedRpc = makeFakeRpc({ [PROGRAM_DATA]: truncated, [PROGRAM_ID]: programAccount() });
        expect(await fetchProgramUpgradeAuthority(truncatedRpc, PROGRAM_ID)).toBeNull();
    });
});
