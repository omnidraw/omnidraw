import { afterEach, describe, expect, test } from 'bun:test';
import type { Database as DatabaseType } from '@tursodatabase/database';
import { readdir } from 'node:fs/promises';
import {
  DATABASE_APPLICATION_ID,
  DATABASE_SCHEMA_VERSION,
  INITIAL_MIGRATION_NAME,
} from '../../../src/CONSTANTS';
import {
  TURSO_EXPERIMENTAL_FEATURES,
} from '../../../src/DbServiceTurso/DbServiceTurso';
import { fxReadMigrationFile } from '../../../src/DbServiceTurso/fx.migration-file';
import { Database } from '../../../src/DbServiceTurso/turso-native';
import { txRunMigrations } from '../../../src/DbServiceTurso/tx.migrations';
import { getEmbeddedMigrationPath, listEmbeddedMigrationFiles } from '../../../src/_embedded-migrations';
import { MIGRATION_FILES } from '../../../src/migrations/CONSTANTS';
import { EXPECTED_DATABASE_SCHEMA_CONTRACTS } from '../../../src/schema/expected-schema';

const databases: DatabaseType[] = [];

async function openDatabase(): Promise<Database> {
  const database = new Database(':memory:', { experimental: [...TURSO_EXPERIMENTAL_FEATURES] });
  await database.connect();
  databases.push(database);
  return database;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe('immutable single-baseline migration runner', () => {
  test('registers and embeds only 000-initial.sql', async () => {
    expect(MIGRATION_FILES).toHaveLength(1);
    expect(MIGRATION_FILES[0]).toMatchObject({ version: 0, name: INITIAL_MIGRATION_NAME });
    expect(listEmbeddedMigrationFiles()).toEqual([INITIAL_MIGRATION_NAME]);
    expect(getEmbeddedMigrationPath(INITIAL_MIGRATION_NAME)).toBe(MIGRATION_FILES[0]?.path);
    expect((await readdir(new URL('../../../src/migrations', import.meta.url)))
      .filter((name) => /^\d{3}-.*\.sql$/.test(name))).toEqual([INITIAL_MIGRATION_NAME]);
  });

  test('applies once, records the exact checksum with a DB clock, and is idempotent', async () => {
    const database = await openDatabase();
    const first = await txRunMigrations({ db: database, Bun, TextDecoder }, {
      applicationVersion: 'test-build',
      expectedSchemaContracts: EXPECTED_DATABASE_SCHEMA_CONTRACTS,
    });
    expect(first).toEqual({ applied: true });
    const migration = await fxReadMigrationFile(
      { Bun, TextDecoder },
      { path: MIGRATION_FILES[0]!.path },
    );
    expect(await (await database.prepare(`
      SELECT version, name, checksum_sha256, applied_at_sec, application_version
      FROM schema_migrations
    `)).get()).toEqual({
      version: 0,
      name: INITIAL_MIGRATION_NAME,
      checksum_sha256: migration.checksumSha256,
      applied_at_sec: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
      application_version: 'test-build',
    });
    expect(await (await database.prepare('PRAGMA application_id')).get())
      .toEqual({ application_id: DATABASE_APPLICATION_ID });
    expect(await (await database.prepare('PRAGMA user_version')).get())
      .toEqual({ user_version: DATABASE_SCHEMA_VERSION });
    expect(await txRunMigrations({ db: database, Bun, TextDecoder }, {
      applicationVersion: 'different-build',
      expectedSchemaContracts: EXPECTED_DATABASE_SCHEMA_CONTRACTS,
    })).toEqual({ applied: false });
  });

  test('rolls back all baseline DDL and ledger writes when exact attestation fails', async () => {
    const database = await openDatabase();
    const invalidContracts = [{
      ...EXPECTED_DATABASE_SCHEMA_CONTRACTS[0]!,
      fingerprintSha256: '0'.repeat(64),
    }];
    await expect(txRunMigrations({ db: database, Bun, TextDecoder }, {
      applicationVersion: 'test-build',
      expectedSchemaContracts: invalidContracts,
    })).rejects.toThrow('whole-schema SHA-256 fingerprint differs');
    expect(await (await database.prepare(`
      SELECT count(*) AS count
      FROM sqlite_schema
      WHERE type = 'table'
        AND name NOT GLOB 'sqlite_*'
    `)).get()).toEqual({ count: 0 });
    expect(await (await database.prepare(`
      SELECT count(*) AS count
      FROM sqlite_schema
      WHERE name = '__turso_internal_types'
    `)).get()).toEqual({ count: 0 });
    const domainRead = Promise.resolve().then(async () => (
      (await database.prepare('SELECT name, sql FROM __turso_internal_types')).all()
    ));
    await expect(domainRead).rejects.toThrow();
    expect(await (await database.prepare('PRAGMA application_id')).get()).toEqual({ application_id: 0 });
    expect(await (await database.prepare('PRAGMA user_version')).get()).toEqual({ user_version: 0 });
  });

  test('rejects empty application version before any schema write', async () => {
    const database = await openDatabase();
    await expect(txRunMigrations({ db: database, Bun, TextDecoder }, {
      applicationVersion: '   ',
      expectedSchemaContracts: EXPECTED_DATABASE_SCHEMA_CONTRACTS,
    })).rejects.toThrow('must not be empty');
    expect(await (await database.prepare(`
      SELECT count(*) AS count FROM sqlite_schema WHERE type = 'table' AND name NOT GLOB 'sqlite_*'
    `)).get()).toEqual({ count: 0 });
  });
});
