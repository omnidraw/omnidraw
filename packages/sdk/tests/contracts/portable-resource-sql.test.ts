import { describe, expect, test } from 'bun:test';
import {
  fnClassifyPortableResourceSql,
  fnValidatePortableResourceSql,
} from '../../src/contracts/core/fn.portable-resource-sql';

function allowed(sql: string) {
  const result = fnClassifyPortableResourceSql(sql);
  expect(result.allowed).toBe(true);
  if (!result.allowed) throw new Error(result.message);
  return result;
}

function rejection(sql: string) {
  const result = fnClassifyPortableResourceSql(sql);
  expect(result.allowed).toBe(false);
  if (result.allowed) throw new Error('Expected SQL rejection.');
  return result;
}

describe('portable resource SQL profile', () => {
  test('classifies reads and writes through comments, CTEs, and RETURNING', () => {
    expect(allowed('/* portable */ SELECT id, value FROM counters').effect).toBe('read');
    expect(allowed("VALUES (1), ('writefile(begin)')").effect).toBe('read');
    expect(allowed('INSERT INTO counters(id) VALUES (1) RETURNING id')).toMatchObject({
      effect: 'write',
      statement: 'insert',
      hasReturning: true,
    });
    expect(allowed('UPDATE counters SET value = value + 1').effect).toBe('write');
    expect(allowed('DELETE FROM counters WHERE id = 1').effect).toBe('write');
    expect(allowed('CREATE TABLE counters(id INTEGER PRIMARY KEY)').effect).toBe('write');

    expect(allowed([
      'WITH selected AS (SELECT id FROM counters)',
      'SELECT id FROM selected',
    ].join(' '))).toMatchObject({ effect: 'read', hasCte: true, statement: 'select' });
    expect(allowed([
      'WITH selected AS (SELECT id FROM counters)',
      'UPDATE counters SET value = 2 WHERE id IN (SELECT id FROM selected)',
      'RETURNING id',
    ].join(' '))).toMatchObject({ effect: 'write', hasCte: true, hasReturning: true });
    expect(allowed([
      'WITH changed AS (UPDATE counters SET value = 2 RETURNING id)',
      'SELECT id FROM changed',
    ].join(' ')).effect).toBe('write');
    expect(allowed([
      'WITH RECURSIVE ids(id) AS NOT MATERIALIZED (VALUES (1))',
      'SELECT id FROM ids',
    ].join(' ')).effect).toBe('read');
  });

  test('rejects transaction, attachment, pragma, vacuum, extension, file, temp, and trigger SQL', () => {
    expect(rejection('BEGIN IMMEDIATE').code).toBe('SQL_TRANSACTION_CONTROL');
    expect(rejection('COMMIT').code).toBe('SQL_TRANSACTION_CONTROL');
    expect(rejection('ROLLBACK TO savepoint_name').code).toBe('SQL_TRANSACTION_CONTROL');
    expect(rejection('SAVEPOINT nested').code).toBe('SQL_TRANSACTION_CONTROL');
    expect(rejection("ATTACH DATABASE 'other.db' AS other").code).toBe(
      'SQL_ATTACHMENT_FORBIDDEN',
    );
    expect(rejection('DETACH DATABASE other').code).toBe('SQL_ATTACHMENT_FORBIDDEN');
    expect(rejection('PRAGMA journal_mode = WAL').code).toBe('SQL_PRAGMA_FORBIDDEN');
    expect(rejection("VACUUM INTO 'copy.db'").code).toBe('SQL_VACUUM_FORBIDDEN');
    expect(rejection("SELECT load_extension('native')").code).toBe(
      'SQL_EXTENSION_FORBIDDEN',
    );
    expect(rejection('CREATE VIRTUAL TABLE search USING fts5(value)').code).toBe(
      'SQL_EXTENSION_FORBIDDEN',
    );
    expect(rejection("SELECT readfile('/etc/passwd')").code).toBe(
      'SQL_HOST_FILE_FORBIDDEN',
    );
    expect(rejection("SELECT sqlite_writefile('/tmp/x', value) FROM files").code).toBe(
      'SQL_HOST_FILE_FORBIDDEN',
    );
    expect(rejection('CREATE TEMP TABLE scratch(id INTEGER)').code).toBe(
      'SQL_TEMP_OBJECT_FORBIDDEN',
    );
    expect(rejection('INSERT INTO temp.scratch VALUES (1)').code).toBe(
      'SQL_TEMP_OBJECT_FORBIDDEN',
    );
    expect(rejection([
      'CREATE TRIGGER audit AFTER UPDATE ON counters',
      'BEGIN INSERT INTO audit_log(value) VALUES (NEW.value); END',
    ].join(' ')).code).toBe('SQL_TRIGGER_FORBIDDEN');
  });

  test('classifies authored calls independently of host-existing triggers', () => {
    expect(allowed('SELECT value FROM counters WHERE id = ?').effect).toBe('read');
    expect(allowed(
      'UPDATE counters SET value = ? WHERE id = ? RETURNING value',
    )).toMatchObject({ effect: 'write', hasReturning: true });
  });

  test('permits internal catalog reads but rejects internal namespace writes', () => {
    expect(allowed("SELECT name FROM sqlite_schema WHERE type = 'table'").effect).toBe('read');
    expect(allowed('INSERT INTO user_metrics(sqlite_version) VALUES (1)').effect).toBe('write');
    for (const sql of [
      "INSERT INTO sqlite_schema(name) VALUES ('x')",
      'UPDATE libsql_internal SET value = 1',
      'DELETE FROM _turso_state',
      'CREATE TABLE __omnidraw_private(id INTEGER)',
      'DROP TABLE omnidraw_state',
    ]) {
      expect(rejection(sql).code).toBe('SQL_INTERNAL_NAMESPACE_WRITE_FORBIDDEN');
    }
  });

  test('does not interpret forbidden words inside comments, strings, or quoted data names', () => {
    expect(allowed([
      '-- BEGIN; PRAGMA; readfile(',
      "SELECT 'ATTACH VACUUM load_extension(' AS message, \"commit\" FROM user_data",
    ].join('\n')).effect).toBe('read');
  });

  test('fails closed for multiple, malformed, oversized, and unclassified statements', () => {
    expect(rejection('SELECT 1; SELECT 2').code).toBe('SQL_MULTIPLE_STATEMENTS');
    expect(rejection('SELECT 1;;').code).toBe('SQL_MULTIPLE_STATEMENTS');
    expect(rejection("SELECT 'unterminated").code).toBe('SQL_MALFORMED');
    expect(rejection('/* unterminated').code).toBe('SQL_MALFORMED');
    expect(rejection('EXPLAIN SELECT 1').code).toBe('SQL_UNCLASSIFIED');
    expect(rejection('SELECT 1 '.repeat(10_000)).code).toBe('SQL_LIMIT_EXCEEDED');
  });

  test('enforces declared effects independently of row production', () => {
    expect(fnValidatePortableResourceSql({
      sql: 'WITH x AS (SELECT 1) SELECT * FROM x',
      expectedEffect: 'read',
    }).allowed).toBe(true);
    expect(fnValidatePortableResourceSql({
      sql: 'WITH x AS (SELECT 1) DELETE FROM counters RETURNING id',
      expectedEffect: 'read',
    })).toMatchObject({ allowed: false, code: 'SQL_EFFECT_MISMATCH' });
    expect(fnValidatePortableResourceSql({
      sql: 'SELECT id FROM counters',
      expectedEffect: 'write',
    })).toMatchObject({ allowed: false, code: 'SQL_EFFECT_MISMATCH' });
  });
});
