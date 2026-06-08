/**
 * BigInt + Uint8Array aware JSON (de)serialization used by the fixture
 * record/replay layer. Solana RPC responses include `bigint` slot/lamports
 * fields and raw byte arrays that would otherwise be lossy as JSON.
 */

import { getBase64Decoder, getBase64Encoder } from '@solana/kit';

type EncodedBigInt = { __bigint: string };
type EncodedBytes = { __bytes_b64: string };

const BASE64_DECODER = getBase64Decoder();
const BASE64_ENCODER = getBase64Encoder();

export function jsonReplacer(_key: string, value: unknown): unknown {
    if (typeof value === 'bigint') {
        return { __bigint: value.toString() } satisfies EncodedBigInt;
    }
    if (value instanceof Uint8Array) {
        return { __bytes_b64: BASE64_DECODER.decode(value) } satisfies EncodedBytes;
    }
    return value;
}

export function jsonReviver(_key: string, value: unknown): unknown {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        if ('__bigint' in value && typeof (value as EncodedBigInt).__bigint === 'string') {
            return BigInt((value as EncodedBigInt).__bigint);
        }
        if (
            '__bytes_b64' in value &&
            typeof (value as EncodedBytes).__bytes_b64 === 'string'
        ) {
            return new Uint8Array(BASE64_ENCODER.encode((value as EncodedBytes).__bytes_b64));
        }
    }
    return value;
}

export function stringifyFixture(value: unknown): string {
    return JSON.stringify(value, jsonReplacer, 2);
}

export function parseFixture<T = unknown>(json: string): T {
    return JSON.parse(json, jsonReviver) as T;
}
