/**
 * Proxy-based recording RPC that wraps a real `@solana/kit` RPC and writes
 * every response to disk under `bucket`, keyed by a stable hash of
 * `method + args`. The replay-side {@link makeFakeRpc} reads back the same
 * files using the same keying scheme.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';

import type { Rpc, SolanaRpcApi } from '@solana/kit';

import { fixtureFile, fixtureKey } from './fake-rpc.js';
import { stringifyFixture } from './serialize.js';

export type RecordOptions = {
    /** Skip an RPC round-trip if a fixture file already exists. */
    readonly reuseExisting?: boolean;
    readonly onCall?: (info: { method: string; key: string; reused: boolean }) => void;
};

export function makeRecordingRpc(
    realRpc: Rpc<SolanaRpcApi>,
    bucket: string,
    opts: RecordOptions = {},
): Rpc<SolanaRpcApi> {
    mkdirSync(bucket, { recursive: true });

    const handler: ProxyHandler<object> = {
        get(_target, prop) {
            if (typeof prop !== 'string') return undefined;
            const method = prop;
            return (...args: unknown[]) => ({
                async send() {
                    const key = fixtureKey(method, args);
                    const file = fixtureFile(bucket, method, key);

                    if (opts.reuseExisting && existsSync(file)) {
                        opts.onCall?.({ key, method, reused: true });
                        const { readFileSync } = await import('node:fs');
                        const { parseFixture } = await import('./serialize.js');
                        return parseFixture(readFileSync(file, 'utf8'));
                    }

                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const pending = (realRpc as any)[method](...args);
                    const result = await pending.send();
                    writeFileSync(file, stringifyFixture(result));
                    opts.onCall?.({ key, method, reused: false });
                    return result;
                },
            });
        },
    };

    return new Proxy({}, handler) as Rpc<SolanaRpcApi>;
}
