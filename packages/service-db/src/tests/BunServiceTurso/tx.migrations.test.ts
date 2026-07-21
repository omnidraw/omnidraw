import { afterEach, describe, expect, test } from 'bun:test';
import { connect, type Database } from '@tursodatabase/database';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  DATABASE_APPLICATION_ID,
  DATABASE_SCHEMA_VERSION,
  DEFAULT_OSS_ACCOUNT_ID,
  DEFAULT_OSS_ORGANIZATION_ID,
  INITIAL_MIGRATION_NAME,
} from '../../../src/CONSTANTS';
import { INITIAL_MIGRATION } from '../../../src/migrations/CONSTANTS';
import {
  DbServiceTurso,
  preflightDbServiceDatabase,
} from '../../../src/DbServiceTurso/DbServiceTurso';
import { listMigrationFiles } from '../../../src/DbServiceTurso/list-migration-files';
import { txRunMigrations } from '../../../src/DbServiceTurso/tx.migrations';
import { listEmbeddedMigrationFiles } from '../../../src/_embedded-migrations';
import { EXPECTED_APPLICATION_TABLES } from '../../../src/schema/expected-schema';

const temporaryRoots: string[] = [];
const databases: Database[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'vibecanvas-migration-runner-'));
  temporaryRoots.push(root);
  return root;
}

async function openDatabase(databasePath: string): Promise<Database> {
  const db = await connect(databasePath);
  databases.push(db);
  return db;
}

async function closeDatabase(db: Database): Promise<void> {
  const index = databases.indexOf(db);
  if (index >= 0) databases.splice(index, 1);
  await db.close();
}

function migrationArgs(overrides: Partial<Parameters<typeof txRunMigrations>[1]> = {}) {
  return {
    applicationVersion: '1.2.3-test',
    appliedAtMs: 1_753_113_600_000,
    expectedApplicationTables: EXPECTED_APPLICATION_TABLES,
    ...overrides,
  };
}

async function runMigrations(
  db: Database,
  overrides: Partial<Parameters<typeof txRunMigrations>[1]> = {},
) {
  return txRunMigrations({ db, Bun }, migrationArgs(overrides));
}

async function pragma(db: Database, name: string): Promise<unknown> {
  return (await (await db.prepare(`PRAGMA ${name}`)).get())?.[name];
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('managed baseline migration runner', () => {
  test('statically registers and embeds only 000-initial.sql', async () => {
    expect(listMigrationFiles()).toEqual([
      expect.objectContaining({
        type: 'sql',
        name: INITIAL_MIGRATION_NAME,
        version: DATABASE_SCHEMA_VERSION,
      }),
    ]);
    expect(listEmbeddedMigrationFiles()).toEqual([INITIAL_MIGRATION_NAME]);

    const migrationDirectory = new URL('../../../src/migrations/', import.meta.url).pathname;
    const discovered = (await fs.readdir(migrationDirectory))
      .filter((file) => file.endsWith('.sql'))
      .sort();
    expect(discovered).toEqual([INITIAL_MIGRATION_NAME]);
  });

  test('applies DDL, deterministic seed, ledger, and header metadata atomically', async () => {
    const root = await temporaryRoot();
    const db = await openDatabase(path.join(root, 'main.db'));

    expect(await runMigrations(db)).toEqual({ applied: true });
    expect(await pragma(db, 'application_id')).toBe(DATABASE_APPLICATION_ID);
    expect(await pragma(db, 'user_version')).toBe(DATABASE_SCHEMA_VERSION);
    expect(await pragma(db, 'foreign_keys')).toBe(1);
    expect(await pragma(db, 'ignore_check_constraints')).toBe(0);
    expect(await pragma(db, 'journal_mode')).toBe('wal');
    expect(await pragma(db, 'synchronous')).toBe(2);

    const ledger = await (
      await db.prepare('SELECT * FROM schema_migrations ORDER BY version')
    ).all();
    expect(ledger).toEqual([
      {
        version: 0,
        name: INITIAL_MIGRATION_NAME,
        checksum_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        applied_at_ms: 1_753_113_600_000,
        application_version: '1.2.3-test',
      },
    ]);
    expect(
      await (await db.prepare('SELECT id, slug, name FROM organizations')).all(),
    ).toEqual([{ id: DEFAULT_OSS_ORGANIZATION_ID, slug: 'local', name: 'Local' }]);
    expect(
      await (await db.prepare('SELECT id, display_name FROM accounts')).all(),
    ).toEqual([{ id: DEFAULT_OSS_ACCOUNT_ID, display_name: 'Local Owner' }]);
    expect(
      await (await db.prepare('SELECT org_id, account_id, role, status FROM organization_memberships')).all(),
    ).toEqual([{
      org_id: DEFAULT_OSS_ORGANIZATION_ID,
      account_id: DEFAULT_OSS_ACCOUNT_ID,
      role: 'owner',
      status: 'active',
    }]);

    const tableRows = await (await db.prepare('PRAGMA table_list')).all();
    const tables = tableRows
      .filter((row) => row.schema === 'main' && row.type === 'table' && !String(row.name).startsWith('sqlite_'))
      .sort((left, right) => String(left.name).localeCompare(String(right.name)));
    expect(tables.map((row) => row.name)).toEqual([...EXPECTED_APPLICATION_TABLES].sort());
    expect(tables.every((row) => row.strict === 1)).toBe(true);
  });

  test('asserts WAL for the pinned Turso in-memory connection too', async () => {
    const db = await openDatabase(':memory:');

    await expect(runMigrations(db)).resolves.toEqual({ applied: true });
    expect(await pragma(db, 'journal_mode')).toBe('wal');
  });

  test('a ledger constraint failure rolls the entire baseline back and retry succeeds', async () => {
    const root = await temporaryRoot();
    const db = await openDatabase(path.join(root, 'main.db'));

    await expect(runMigrations(db, { applicationVersion: 'x'.repeat(101) })).rejects.toThrow();
    const tablesAfterFailure = await (await db.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    `)).all();
    expect(tablesAfterFailure).toEqual([]);
    expect(await pragma(db, 'application_id')).toBe(0);
    expect(await pragma(db, 'user_version')).toBe(0);

    expect(await runMigrations(db)).toEqual({ applied: true });
  });

  test('restart is idempotent and verifies integrity and the immutable checksum', async () => {
    const root = await temporaryRoot();
    const databasePath = path.join(root, 'main.db');
    const first = await openDatabase(databasePath);
    await runMigrations(first);
    const firstLedger = await (await first.prepare('SELECT * FROM schema_migrations')).all();
    await closeDatabase(first);

    const restarted = await openDatabase(databasePath);
    expect(await runMigrations(restarted, { appliedAtMs: 9_999 })).toEqual({ applied: false });
    expect(await (await restarted.prepare('SELECT * FROM schema_migrations')).all()).toEqual(firstLedger);
    expect(await (await restarted.prepare('PRAGMA integrity_check')).get()).toEqual({ integrity_check: 'ok' });
  });

  test('checksum tampering is fatal and is not repaired', async () => {
    const root = await temporaryRoot();
    const db = await openDatabase(path.join(root, 'main.db'));
    await runMigrations(db);
    const tamperedChecksum = '0'.repeat(64);
    await db.exec(`UPDATE schema_migrations SET checksum_sha256 = '${tamperedChecksum}'`);

    await expect(runMigrations(db)).rejects.toThrow(/checksum/i);
    expect(
      await (await db.prepare('SELECT checksum_sha256 FROM schema_migrations')).get(),
    ).toEqual({ checksum_sha256: tamperedChecksum });
  });

  test('unknown actor-era database is refused before write-affecting pragmas', async () => {
    const root = await temporaryRoot();
    const db = await openDatabase(path.join(root, 'main.db'));
    await db.exec('PRAGMA cache_size = 1234; CREATE TABLE actor_definitions (id TEXT)');
    const journalModeBefore = await pragma(db, 'journal_mode');

    await expect(runMigrations(db)).rejects.toThrow(/actor-era/i);
    expect(await pragma(db, 'journal_mode')).toBe(journalModeBefore);
    expect(await pragma(db, 'cache_size')).toBe(1234);
    expect(await pragma(db, 'application_id')).toBe(0);
    expect(
      await (await db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")).all(),
    ).toEqual([{ name: 'actor_definitions' }]);
  });

  test('partial managed database is refused without adding schema or ledger rows', async () => {
    const root = await temporaryRoot();
    const db = await openDatabase(path.join(root, 'main.db'));
    await db.exec(`
      CREATE TABLE interrupted_bootstrap (id TEXT PRIMARY KEY) STRICT;
      PRAGMA application_id = ${DATABASE_APPLICATION_ID};
      PRAGMA user_version = ${DATABASE_SCHEMA_VERSION};
    `);

    await expect(runMigrations(db)).rejects.toThrow(/manifest differs/i);
    expect(
      await (await db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")).all(),
    ).toEqual([{ name: 'interrupted_bootstrap' }]);
  });
});

describe('read-only startup preflight', () => {
  test('accepts an installer-only home without creating main.db', async () => {
    const homeDir = await temporaryRoot();
    await fs.mkdir(path.join(homeDir, 'bin'));
    await fs.mkdir(path.join(homeDir, 'native'));
    await fs.writeFile(path.join(homeDir, 'bin', 'vibecanvas'), 'binary');
    await fs.writeFile(path.join(homeDir, 'native', 'turso.node'), 'native');
    const databasePath = path.join(homeDir, 'main.db');

    await expect(preflightDbServiceDatabase({ homeDir, databasePath })).resolves.toEqual({ status: 'empty' });
    await expect(fs.lstat(databasePath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.readdir(homeDir)).sort()).toEqual(['bin', 'native']);
  });

  test('accepts the exact empty managed directory tree after home initialization', async () => {
    const homeDir = await temporaryRoot();
    const organizationRoot = path.join(homeDir, 'organizations', DEFAULT_OSS_ORGANIZATION_ID);
    await Promise.all([
      'agent',
      'artifacts',
      'resources',
      'temp',
      'pty',
    ].map((name) => fs.mkdir(path.join(organizationRoot, name), { recursive: true })));
    await fs.mkdir(path.join(homeDir, 'cache'));
    await fs.mkdir(path.join(homeDir, 'logs'));

    await expect(preflightDbServiceDatabase({
      homeDir,
      databasePath: path.join(homeDir, 'main.db'),
    })).resolves.toEqual({ status: 'empty' });
  });

  test('accepts only the exact embedded 000 in an installer migration directory', async () => {
    const homeDir = await temporaryRoot();
    const migrationDir = path.join(homeDir, 'database-migrations');
    await fs.mkdir(migrationDir);
    await fs.copyFile(INITIAL_MIGRATION.path, path.join(migrationDir, INITIAL_MIGRATION_NAME));

    await expect(preflightDbServiceDatabase({
      homeDir,
      databasePath: path.join(homeDir, 'main.db'),
    })).resolves.toEqual({ status: 'empty' });

    await fs.writeFile(path.join(migrationDir, '016-add-encryption-keys.sql'), 'legacy');
    await expect(preflightDbServiceDatabase({
      homeDir,
      databasePath: path.join(homeDir, 'main.db'),
    })).rejects.toThrow(/actor-era or unknown database-migrations/i);
  });

  test('refuses actor-era home data without creating or modifying main.db', async () => {
    const homeDir = await temporaryRoot();
    const legacyPath = path.join(homeDir, 'vibecanvas.turso');
    await fs.writeFile(legacyPath, 'legacy-bytes');

    await expect(preflightDbServiceDatabase({
      homeDir,
      databasePath: path.join(homeDir, 'main.db'),
    })).rejects.toThrow(/unknown entry/i);
    expect(await fs.readFile(legacyPath, 'utf8')).toBe('legacy-bytes');
    await expect(fs.lstat(path.join(homeDir, 'main.db'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('recognizes a valid managed database through a readonly connection', async () => {
    const homeDir = await temporaryRoot();
    const databasePath = path.join(homeDir, 'main.db');
    const db = await openDatabase(databasePath);
    await runMigrations(db);
    await closeDatabase(db);
    const entriesBefore = (await fs.readdir(homeDir)).sort();

    await expect(preflightDbServiceDatabase({ homeDir, databasePath })).resolves.toMatchObject({
      status: 'ready',
      migration: { name: INITIAL_MIGRATION_NAME, version: 0 },
    });
    expect((await fs.readdir(homeDir)).sort()).toEqual(entriesBefore);
  });
});

describe('database service lifecycle', () => {
  test('stop closes the native database and remains idempotent', async () => {
    const homeDir = await temporaryRoot();
    const service = new DbServiceTurso({
      databasePath: path.join(homeDir, 'main.db'),
      dataDir: homeDir,
      cacheDir: path.join(homeDir, 'cache'),
      silentMigrations: true,
    });

    await service.start();
    await service.stop();
    expect(() => service.db.prepare('SELECT 1')).toThrow(/not open|closed/i);
    await expect(service.stop()).resolves.toBeUndefined();
  });

  test('failed startup closes the native database before rethrowing', async () => {
    const homeDir = await temporaryRoot();
    const databasePath = path.join(homeDir, 'main.db');
    const setupDb = await openDatabase(databasePath);
    await setupDb.exec('CREATE TABLE actor_definitions (id TEXT)');
    await closeDatabase(setupDb);
    const service = new DbServiceTurso({
      databasePath,
      dataDir: homeDir,
      cacheDir: path.join(homeDir, 'cache'),
      silentMigrations: true,
    });

    await expect(service.start()).rejects.toThrow(/actor-era/i);
    expect(() => service.db.prepare('SELECT 1')).toThrow(/not open|closed/i);
    await expect(service.stop()).resolves.toBeUndefined();
  });
});
