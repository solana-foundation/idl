import { address } from '@solana/kit';
import { describe, expect, test } from 'vitest';

import { IdlDecodeError, IdlValidationError } from '../src/errors.js';
import { type IdlResult, parseIdl, unwrapIdl, unwrapIdlOrThrow } from '../src/idl-result.js';

const ADDR = address('BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya');

const okResult = (content: string): IdlResult<'anchor'> => ({
    address: ADDR,
    content,
    source: 'anchor',
    status: 'ok',
});

function caught(fn: () => unknown): unknown {
    try {
        fn();
        return undefined;
    } catch (e) {
        return e;
    }
}

describe('parseIdl', () => {
    test('parses a JSON object', () => {
        const r = parseIdl('{"a":1}');
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.idl).toEqual({ a: 1 });
    });

    test("rejects non-JSON with reason 'json'", () => {
        expect(parseIdl('not json at all')).toEqual({ ok: false, reason: 'json' });
    });

    test.each(['42', '"hi"', '[]', 'null', 'true'])("rejects non-object JSON `%s` with reason 'shape'", input => {
        expect(parseIdl(input)).toEqual({ ok: false, reason: 'shape' });
    });

    test('accepts an empty object — validation is parse + object, not IDL-schema', () => {
        expect(parseIdl('{}')).toEqual({ idl: {}, ok: true });
    });
});

describe('unwrapIdl', () => {
    test('ok + JSON object → Idl', () => {
        expect(unwrapIdl(okResult('{"name":"x"}'))).toEqual({ address: ADDR, idl: { name: 'x' }, source: 'anchor' });
    });

    test('ok + invalid content → null', () => {
        expect(unwrapIdl(okResult('not json'))).toBeNull();
        expect(unwrapIdl(okResult('42'))).toBeNull();
    });

    test('corrupt → null', () => {
        const corrupt: IdlResult<'anchor'> = { address: ADDR, reason: 'framing', source: 'anchor', status: 'corrupt' };
        expect(unwrapIdl(corrupt)).toBeNull();
    });

    test('absent → null', () => {
        expect(unwrapIdl({ address: ADDR, status: 'absent' })).toBeNull();
    });
});

describe('unwrapIdlOrThrow', () => {
    test('ok + JSON object → Idl', () => {
        expect(unwrapIdlOrThrow(okResult('{"name":"x"}'))).toEqual({
            address: ADDR,
            idl: { name: 'x' },
            source: 'anchor',
        });
    });

    test('absent → null (no IDL published is not an error)', () => {
        expect(unwrapIdlOrThrow({ address: ADDR, status: 'absent' })).toBeNull();
    });

    test('corrupt → throws IdlDecodeError carrying the byte-level reason', () => {
        const corrupt: IdlResult<'anchor'> = {
            address: ADDR,
            cause: new Error('zlib'),
            reason: 'payload',
            source: 'anchor',
            status: 'corrupt',
        };
        const err = caught(() => unwrapIdlOrThrow(corrupt));
        expect(err).toBeInstanceOf(IdlDecodeError);
        expect((err as IdlDecodeError).reason).toBe('payload');
    });

    test('ok + invalid content → throws IdlValidationError carrying reason + content', () => {
        const err = caught(() => unwrapIdlOrThrow(okResult('[1,2,3]')));
        expect(err).toBeInstanceOf(IdlValidationError);
        expect((err as IdlValidationError).reason).toBe('shape');
        expect((err as IdlValidationError).content).toBe('[1,2,3]');
    });
});
