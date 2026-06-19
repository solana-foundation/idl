import {
    address,
    SOLANA_ERROR__JSON_RPC__METHOD_NOT_FOUND,
    SOLANA_ERROR__JSON_RPC__PARSE_ERROR,
    SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY,
    SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
    SolanaError,
} from '@solana/kit';
import { describe, expect, test } from 'vitest';

import { classifyRpcError, IdlDecodeError, isTransientRpcError } from '../src/errors.js';

const PROGRAM = address('BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya');

describe('classifyRpcError', () => {
    test('returns null for non-SolanaError input', () => {
        expect(classifyRpcError(new Error('boom'))).toBeNull();
        expect(classifyRpcError(new IdlDecodeError('x', { address: PROGRAM, reason: 'framing' }))).toBeNull();
        expect(classifyRpcError(undefined)).toBeNull();
    });

    test('classifies known transient JSON-RPC codes as transient', () => {
        const err = new SolanaError(SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY, {});
        expect(classifyRpcError(err)).toBe('transient');
        expect(isTransientRpcError(err)).toBe(true);
    });

    test('falls back to misconfig for a non-transient, non-transport SolanaError', () => {
        const err = new SolanaError(SOLANA_ERROR__JSON_RPC__METHOD_NOT_FOUND, { __serverMessage: 'Method not found' });
        expect(classifyRpcError(err)).toBe('misconfig');
        expect(isTransientRpcError(err)).toBe(false);
    });

    test('classifies a client-fault parse error (-32700) as misconfig, not transient', () => {
        // -32700 means the server couldn't parse our request — retrying it unchanged loops forever.
        const err = new SolanaError(SOLANA_ERROR__JSON_RPC__PARSE_ERROR, { __serverMessage: 'Parse error' });
        expect(classifyRpcError(err)).toBe('misconfig');
        expect(isTransientRpcError(err)).toBe(false);
    });

    test('treats 5xx/429 transport errors as transient and others as misconfig', () => {
        const make = (statusCode: number, message: string) =>
            new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, { headers: new Headers(), message, statusCode });
        expect(classifyRpcError(make(503, 'unavailable'))).toBe('transient');
        expect(classifyRpcError(make(429, 'rate limited'))).toBe('transient');
        expect(classifyRpcError(make(403, 'forbidden'))).toBe('misconfig');
        expect(classifyRpcError(make(404, 'not found'))).toBe('misconfig');
    });
});
