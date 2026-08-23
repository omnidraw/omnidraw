import { describe, expect, test } from 'bun:test';
import {
  PORTABLE_RESOURCE_DB_ROWS_FORMAT,
  PORTABLE_RESOURCE_REQUEST_FORMAT,
  PortableResourceWireError,
  fnCanonicalizePortableResourceWireValue,
  fnDecodePortableResourceDbExecute,
  fnDecodePortableResourceDbRows,
  fnDecodePortableResourceFailure,
  fnDecodePortableResourceRequest,
  fnDecodePortableResourceValue,
  fnEncodePortableResourceDbExecute,
  fnEncodePortableResourceDbRows,
  fnEncodePortableResourceFailure,
  fnEncodePortableResourceRequest,
  fnEncodePortableResourceValue,
} from '../../src/contracts/core/fn.resource-wire';

describe('portable resource wire codec', () => {
  test('round-trips canonical JSON, signed int64, bytes, and normalized object order', () => {
    const encoded = fnEncodePortableResourceValue({
      z: null,
      a: [true, -9_223_372_036_854_775_808n, new Uint8Array([0, 1, 254, 255])],
      n: -0,
    });
    expect(encoded).toEqual({
      type: 'object',
      entries: [
        ['a', {
          type: 'array',
          items: [
            { type: 'boolean', value: true },
            { type: 'bigint', value: '-9223372036854775808' },
            { type: 'bytes', base64: 'AAH+/w==' },
          ],
        }],
        ['n', { type: 'number', value: 0 }],
        ['z', { type: 'null' }],
      ],
    });
    const decoded = fnDecodePortableResourceValue(encoded) as Record<string, unknown>;
    expect(Object.getPrototypeOf(decoded)).toBeNull();
    expect(decoded.a).toEqual([
      true,
      -9_223_372_036_854_775_808n,
      new Uint8Array([0, 1, 254, 255]),
    ]);
    expect(fnCanonicalizePortableResourceWireValue(encoded)).toBe(JSON.stringify(encoded));
  });

  test('rejects non-finite, cyclic, accessor, prototype, collision, and limit violations', () => {
    expect(() => fnEncodePortableResourceValue(Number.NaN)).toThrow(PortableResourceWireError);
    expect(() => fnEncodePortableResourceValue(9_223_372_036_854_775_808n)).toThrow(
      /signed 64-bit/,
    );
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => fnEncodePortableResourceValue(cyclic)).toThrow(/cycles/);
    let accessed = false;
    const accessor = Object.defineProperty({}, 'secret', {
      enumerable: true,
      get: () => {
        accessed = true;
        return 'no';
      },
    });
    expect(() => fnEncodePortableResourceValue(accessor)).toThrow(/data properties/);
    expect(accessed).toBe(false);
    expect(() => fnEncodePortableResourceValue(new Date())).toThrow(/plain prototype/);
    expect(() => fnEncodePortableResourceValue({ 'e\u0301': 1, 'é': 2 })).toThrow(
      /collide after normalization/,
    );
    expect(() => fnEncodePortableResourceValue([[[1]]], { maxDepth: 1 })).toThrow(
      /nesting limit/,
    );
    expect(() => fnEncodePortableResourceValue(new Uint8Array(3), {
      maxByteArrayBytes: 2,
    })).toThrow(/byte limit/);
    const sparse = new Array(1);
    expect(() => fnEncodePortableResourceValue(sparse)).toThrow(/dense data array/);
    let arrayAccessorRead = false;
    const accessorArray: unknown[] = [];
    Object.defineProperty(accessorArray, '0', {
      enumerable: true,
      get: () => {
        arrayAccessorRead = true;
        return 'no';
      },
    });
    accessorArray.length = 1;
    expect(() => fnEncodePortableResourceValue(accessorArray)).toThrow(/without accessors/);
    expect(arrayAccessorRead).toBe(false);
  });

  test('strictly rejects malformed and non-canonical tags', () => {
    expect(() => fnDecodePortableResourceValue({ type: 'bytes', base64: 'AB==' })).toThrow(
      /non-canonical base64/,
    );
    expect(() => fnDecodePortableResourceValue({ type: 'bigint', value: '01' })).toThrow(
      /malformed/,
    );
    expect(() => fnDecodePortableResourceValue({ type: 'number', value: -0 })).toThrow(
      /negative zero/,
    );
    expect(() => fnDecodePortableResourceValue({
      type: 'object',
      entries: [
        ['b', { type: 'null' }],
        ['a', { type: 'null' }],
      ],
    })).toThrow(/canonically ordered/);
    expect(() => fnDecodePortableResourceValue({ type: 'string', value: 'ok', extra: 1 }))
      .toThrow(/unsupported or missing fields/);
    expect(() => fnDecodePortableResourceValue({
      type: 'array',
      items: new Array(1),
    })).toThrow(/dense data array/);
  });

  test('uses exact versioned envelopes without identities or provider authority', () => {
    const wire = fnEncodePortableResourceRequest({
      correlationId: 'invocation-1:0',
      slot: 'counter',
      operation: 'compareAndSet',
      effect: 'write',
      input: { key: 'count', expectedRevision: 2, value: 3 },
    });
    expect(wire.format).toBe(PORTABLE_RESOURCE_REQUEST_FORMAT);
    expect(wire).not.toHaveProperty('subject');
    expect(wire).not.toHaveProperty('resourceId');
    expect(wire).not.toHaveProperty('credential');
    expect(fnDecodePortableResourceRequest(wire)).toEqual({
      correlationId: 'invocation-1:0',
      slot: 'counter',
      operation: 'compareAndSet',
      effect: 'write',
      input: { key: 'count', expectedRevision: 2, value: 3 },
    });
    expect(() => fnDecodePortableResourceRequest({ ...wire, resourceId: 'private' }))
      .toThrow(/unsupported or missing fields/);

    const failure = fnEncodePortableResourceFailure({
      correlationId: 'invocation-1:0',
      failure: {
        code: 'RESOURCE_WRITE_OUTCOME_AMBIGUOUS',
        message: 'The write outcome is unknown and was not retried.',
      },
    });
    expect(fnDecodePortableResourceFailure(failure)).toEqual({
      correlationId: 'invocation-1:0',
      failure: {
        code: 'RESOURCE_WRITE_OUTCOME_AMBIGUOUS',
        message: 'The write outcome is unknown and was not retried.',
      },
    });
    expect(() => fnDecodePortableResourceFailure({
      ...failure,
      failure: { code: 'DRIVER_STACK', message: 'private' },
    })).toThrow(/failure code/);
  });

  test('preserves ordered and duplicate database columns with deterministic cell tags', () => {
    const wire = fnEncodePortableResourceDbRows({
      columns: ['id', 'value', 'value'],
      rows: [[
        9_223_372_036_854_775_807n,
        new Uint8Array([1, 2, 3]),
        { nested: [null, true] },
      ]],
    });
    expect(wire.format).toBe(PORTABLE_RESOURCE_DB_ROWS_FORMAT);
    expect(wire.columns).toEqual(['id', 'value', 'value']);
    expect(wire.rows[0]?.cells).toEqual([
      { type: 'integer', value: '9223372036854775807' },
      { type: 'blob', base64: 'AQID' },
      {
        type: 'json',
        value: {
          type: 'object',
          entries: [['nested', {
            type: 'array',
            items: [{ type: 'null' }, { type: 'boolean', value: true }],
          }]],
        },
      },
    ]);
    const decoded = fnDecodePortableResourceDbRows(wire);
    expect(decoded.columns).toEqual(['id', 'value', 'value']);
    expect(decoded.rows[0]?.[0]).toBe(9_223_372_036_854_775_807n);
    expect(decoded.rows[0]?.[1]).toEqual(new Uint8Array([1, 2, 3]));
    expect(decoded.rows[0]?.[2]).toEqual({ nested: [null, true] });
    expect(() => fnDecodePortableResourceDbRows({
      ...wire,
      rows: [{ cells: [{ type: 'null' }] }],
    })).toThrow(/row width/);
    const sparseRow = new Array(3);
    expect(() => fnEncodePortableResourceDbRows({
      columns: ['id', 'value', 'value'],
      rows: [sparseRow],
    })).toThrow(/dense data array/);
    expect(() => fnDecodePortableResourceDbRows({
      ...wire,
      rows: [{ cells: new Array(3) }],
    })).toThrow(/dense data array/);
  });

  test('preserves declared JSON cell identity for every JSON shape', () => {
    const columns = ['string', 'number', 'boolean', 'null', 'object', 'array'];
    const wire = fnEncodePortableResourceDbRows({
      columns,
      rows: [[
        'value',
        42,
        true,
        null,
        { nested: 'value' },
        [1, false, null],
      ]],
      jsonColumns: columns,
    });
    expect(wire.rows[0]?.cells).toEqual([
      { type: 'json', value: { type: 'string', value: 'value' } },
      { type: 'json', value: { type: 'number', value: 42 } },
      { type: 'json', value: { type: 'boolean', value: true } },
      { type: 'json', value: { type: 'null' } },
      {
        type: 'json',
        value: {
          type: 'object',
          entries: [['nested', { type: 'string', value: 'value' }]],
        },
      },
      {
        type: 'json',
        value: {
          type: 'array',
          items: [
            { type: 'number', value: 1 },
            { type: 'boolean', value: false },
            { type: 'null' },
          ],
        },
      },
    ]);
    expect(fnDecodePortableResourceDbRows(wire).rows[0]).toEqual([
      'value',
      42,
      true,
      null,
      { nested: 'value' },
      [1, false, null],
    ]);
    expect(() => fnEncodePortableResourceDbRows({
      columns: ['json'],
      rows: [[1n]],
      jsonColumns: ['json'],
    })).toThrow(/must not contain bigint or bytes/);
    expect(() => fnDecodePortableResourceDbRows({
      format: PORTABLE_RESOURCE_DB_ROWS_FORMAT,
      columns: ['json'],
      rows: [{ cells: [{ type: 'json', value: { type: 'bigint', value: '1' } }] }],
    })).toThrow(/must not contain bigint or bytes/);
    expect(() => fnDecodePortableResourceDbRows({
      format: PORTABLE_RESOURCE_DB_ROWS_FORMAT,
      columns: ['json'],
      rows: [{ cells: [{
        type: 'json',
        value: {
          type: 'object',
          entries: [['nested', {
            type: 'array',
            items: [{ type: 'bytes', base64: 'AQID' }],
          }]],
        },
      }] }],
    })).toThrow(/must not contain bigint or bytes/);
    expect(() => fnEncodePortableResourceDbRows({
      columns: ['json'],
      rows: [[null]],
      jsonColumns: ['missing'],
    })).toThrow(/JSON column declaration is invalid/);
  });

  test('normalizes execute counts and insert IDs without unsafe numbers', () => {
    const wire = fnEncodePortableResourceDbExecute({
      rowsAffected: 2,
      lastInsertId: 9_223_372_036_854_775_807n,
    });
    expect(fnDecodePortableResourceDbExecute(wire)).toEqual({
      rowsAffected: 2,
      lastInsertId: 9_223_372_036_854_775_807n,
    });
    expect(() => fnEncodePortableResourceDbExecute({
      rowsAffected: -1,
      lastInsertId: null,
    })).toThrow(/affected-row count/);
  });
});
