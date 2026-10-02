import { address, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY, SolanaError } from '@solana/kit';
import { describe, expect, test, vi } from 'vitest';

import { findAnchorIdlAddress, reconstructAnchorHistory } from '../src/anchor.js';
import { fetchAllHistories } from '../src/history.js';
import { reconstructPmpHistory } from '../src/program-metadata.js';
import type { SolanaRpcClient } from '../src/rpc.js';

const PROGRAM = address('BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya');
const SIGNATURE = '1'.repeat(88);
const SIG_INFO = { blockTime: 1n, err: null, signature: SIGNATURE, slot: 1n };

describe('history RPC failures', () => {
    test.each(['all', 'pmp', 'anchor'] as const)(
        'fetchAllHistories propagates a %s signature-list failure',
        async source => {
            const failure = new SolanaError(SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY, {});
            const anchor = await findAnchorIdlAddress(PROGRAM);
            const getSignaturesForAddress = vi.fn((queried: string) => ({
                send: () => {
                    const shouldFail =
                        source === 'all' || (source === 'anchor' ? queried === anchor : queried !== anchor);
                    return shouldFail ? Promise.reject(failure) : Promise.resolve([]);
                },
            }));
            const rpc = { getSignaturesForAddress } as unknown as SolanaRpcClient;

            await expect(fetchAllHistories(rpc, PROGRAM)).rejects.toBe(failure);
        },
    );

    test('no published history remains an empty result', async () => {
        const rpc = {
            getSignaturesForAddress: () => ({ send: () => Promise.resolve([]) }),
        } as unknown as SolanaRpcClient;

        await expect(fetchAllHistories(rpc, PROGRAM)).resolves.toMatchObject({ anchor: [], pmp: [] });
    });

    for (const [source, reconstruct] of [
        ['anchor', reconstructAnchorHistory],
        ['pmp', reconstructPmpHistory],
    ] as const) {
        test(`${source} propagates a transaction-fetch failure`, async () => {
            const failure = new SolanaError(SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY, {});
            const rpc = {
                getSignaturesForAddress: () => ({ send: () => Promise.resolve([SIG_INFO]) }),
                getTransaction: () => ({ send: () => Promise.reject(failure) }),
            } as unknown as SolanaRpcClient;

            await expect(reconstruct(rpc, PROGRAM)).rejects.toBe(failure);
        });

        test(`${source} still tolerates a transaction absent from RPC history`, async () => {
            const rpc = {
                getSignaturesForAddress: () => ({ send: () => Promise.resolve([SIG_INFO]) }),
                getTransaction: () => ({ send: () => Promise.resolve(null) }),
            } as unknown as SolanaRpcClient;

            await expect(reconstruct(rpc, PROGRAM)).resolves.toEqual([]);
        });

        test(`${source} does not fetch a failed transaction`, async () => {
            const getTransaction = vi.fn();
            const rpc = {
                getSignaturesForAddress: () => ({
                    send: () => Promise.resolve([{ ...SIG_INFO, err: { InstructionError: [0, 'InvalidArgument'] } }]),
                }),
                getTransaction,
            } as unknown as SolanaRpcClient;

            await expect(reconstruct(rpc, PROGRAM)).resolves.toEqual([]);
            expect(getTransaction).not.toHaveBeenCalled();
        });
    }
});
