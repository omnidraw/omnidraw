import { describe, expect, test } from 'bun:test';
import {
  PORTABLE_RESOURCE_OPERATION_REGISTRY,
  PortableResourceOperationError,
  fnGetPortableResourceOperation,
  fnValidatePortableResourceOperationInput,
  fnValidatePortableResourceOperationResult,
} from '../../src/contracts/core/fn.resource-operation-registry';
import {
  fnEncodePortableResourceDbExecute,
  fnEncodePortableResourceDbRows,
} from '../../src/contracts/core/fn.resource-wire';

describe('portable resource operation registry', () => {
  test('freezes the complete KV, secret-store, and database operation surface', () => {
    expect(Object.keys(PORTABLE_RESOURCE_OPERATION_REGISTRY)).toEqual([
      'kv',
      'secretStore',
      'db',
    ]);
    expect(Object.keys(PORTABLE_RESOURCE_OPERATION_REGISTRY.kv)).toEqual([
      'get',
      'has',
      'list',
      'set',
      'delete',
      'compareAndSet',
    ]);
    expect(Object.keys(PORTABLE_RESOURCE_OPERATION_REGISTRY.secretStore)).toEqual([
      'get',
      'has',
      'list',
      'set',
      'delete',
      'compareAndSet',
    ]);
    expect(Object.keys(PORTABLE_RESOURCE_OPERATION_REGISTRY.db)).toEqual([
      'invoke',
      'query',
      'execute',
    ]);
    expect(fnGetPortableResourceOperation('db', 'invoke')).toEqual({
      effect: 'declared',
      inputSchema: 'db-invoke',
      resultSchema: 'declared-db-result',
    });
    expect(Object.isFrozen(PORTABLE_RESOURCE_OPERATION_REGISTRY.kv)).toBe(true);
  });

  test('enforces exact operation effects before input validation', () => {
    expect(() => fnValidatePortableResourceOperationInput({
      kind: 'kv',
      operation: 'get',
      effect: 'write',
      input: { key: 'count' },
    })).toThrow(PortableResourceOperationError);
    expect(() => fnValidatePortableResourceOperationInput({
      kind: 'kv',
      operation: 'unknown',
      effect: 'read',
      input: {},
    })).toThrow(/Unknown kv resource operation/);
    expect(() => fnValidatePortableResourceOperationInput({
      kind: 'db',
      operation: 'invoke',
      effect: 'write',
      declaredEffect: 'write',
      input: { operation: 'increment', parameters: { amount: 1 } },
    })).not.toThrow();
    expect(() => fnValidatePortableResourceOperationInput({
      kind: 'db',
      operation: 'invoke',
      effect: 'write',
      declaredEffect: 'read',
      input: { operation: 'increment' },
    })).toThrow(/effect/);
  });

  test('validates bounded KV JSON, revisions, pages, and conditional results', () => {
    expect(() => fnValidatePortableResourceOperationInput({
      kind: 'kv',
      operation: 'compareAndSet',
      effect: 'write',
      input: {
        key: 'count',
        expectedRevision: null,
        value: { count: 1, nested: [null, true] },
      },
    })).not.toThrow();
    expect(() => fnValidatePortableResourceOperationInput({
      kind: 'kv',
      operation: 'set',
      effect: 'write',
      input: { key: 'count', value: 1n },
    })).toThrow(/must not contain bigint or bytes/);
    expect(() => fnValidatePortableResourceOperationInput({
      kind: 'kv',
      operation: 'delete',
      effect: 'write',
      input: { key: 'count', expectedRevision: 0 },
    })).toThrow(/positive safe integer/);
    expect(() => fnValidatePortableResourceOperationResult({
      kind: 'kv',
      operation: 'list',
      result: {
        items: [{ key: 'count', value: { count: 2 }, revision: 3 }],
        nextCursor: 'count',
      },
    })).not.toThrow();
    expect(() => fnValidatePortableResourceOperationResult({
      kind: 'kv',
      operation: 'compareAndSet',
      result: { ok: false, currentRevision: null },
    })).not.toThrow();
  });

  test('keeps secret list metadata distinct from explicit plaintext get results', () => {
    expect(() => fnValidatePortableResourceOperationInput({
      kind: 'secretStore',
      operation: 'set',
      effect: 'write',
      input: { name: 'api-key', value: 'secret' },
    })).not.toThrow();
    expect(() => fnValidatePortableResourceOperationResult({
      kind: 'secretStore',
      operation: 'get',
      result: { value: 'secret', revision: 1 },
    })).not.toThrow();
    expect(() => fnValidatePortableResourceOperationResult({
      kind: 'secretStore',
      operation: 'list',
      result: { items: [{ name: 'api-key', revision: 1 }] },
    })).not.toThrow();
    expect(() => fnValidatePortableResourceOperationResult({
      kind: 'secretStore',
      operation: 'list',
      result: {
        items: [{
          name: 'api-key',
          revision: 1,
          createdAtSec: '2026-08-17 00:00:00',
          updatedAtSec: '2026-08-17 00:00:00',
          value: 'must-not-leak',
        }],
      },
    })).toThrow(/unsupported field/);
  });

  test('requires portable read SQL for query and portable write SQL for execute batches', () => {
    expect(() => fnValidatePortableResourceOperationInput({
      kind: 'db',
      operation: 'query',
      effect: 'read',
      input: {
        sql: 'WITH selected AS (SELECT id FROM counters) SELECT id FROM selected',
        parameters: { minimum: 1n, token: new Uint8Array([1, 2]) },
      },
    })).not.toThrow();
    expect(() => fnValidatePortableResourceOperationInput({
      kind: 'db',
      operation: 'query',
      effect: 'read',
      input: { sql: 'DELETE FROM counters RETURNING id' },
    })).toThrow(/write, not read/);
    expect(() => fnValidatePortableResourceOperationInput({
      kind: 'db',
      operation: 'execute',
      effect: 'write',
      input: {
        operations: [
          { sql: 'INSERT INTO counters(id) VALUES (:id)', parameters: { id: 1n } },
          { sql: 'UPDATE counters SET value = :value', parameters: { value: { count: 2 } } },
        ],
      },
    })).not.toThrow();
    expect(() => fnValidatePortableResourceOperationInput({
      kind: 'db',
      operation: 'execute',
      effect: 'write',
      input: { sql: 'BEGIN' },
    })).toThrow(/transactions/);
    expect(() => fnValidatePortableResourceOperationInput({
      kind: 'db',
      operation: 'execute',
      effect: 'write',
      input: { sql: 'INSERT INTO sqlite_schema(name) VALUES (1)' },
    })).toThrow(/internal database namespaces/);
  });

  test('validates deterministic row/execute results including named-operation declarations', () => {
    const rows = fnEncodePortableResourceDbRows({
      columns: ['id', 'payload'],
      rows: [[1n, new Uint8Array([1])]],
    });
    const execute = fnEncodePortableResourceDbExecute({
      rowsAffected: 1,
      lastInsertId: 1n,
    });
    expect(() => fnValidatePortableResourceOperationResult({
      kind: 'db',
      operation: 'query',
      result: rows,
    })).not.toThrow();
    expect(() => fnValidatePortableResourceOperationResult({
      kind: 'db',
      operation: 'execute',
      result: [execute, execute],
    })).not.toThrow();
    expect(() => fnValidatePortableResourceOperationResult({
      kind: 'db',
      operation: 'invoke',
      declaredResult: 'rows',
      result: rows,
    })).not.toThrow();
    expect(() => fnValidatePortableResourceOperationResult({
      kind: 'db',
      operation: 'invoke',
      result: rows,
    })).toThrow(/shape was not supplied/);
  });
});
