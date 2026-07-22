import { afterEach, describe, expect, test } from 'bun:test';
import { connect, type Database } from '@tursodatabase/database';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  AGENT_AUTHORING_MIGRATION_NAME,
  AGENT_AUTHORING_MIGRATION_VERSION,
  DATABASE_APPLICATION_ID,
  DATABASE_SCHEMA_VERSION,
  DEFAULT_OSS_ACCOUNT_ID,
  DEFAULT_OSS_ORGANIZATION_ID,
  FUNCTION_RUNTIME_MIGRATION_NAME,
  FUNCTION_RUNTIME_MIGRATION_VERSION,
  INITIAL_MIGRATION_NAME,
  INITIAL_MIGRATION_VERSION,
  WIDGET_REVISION_SEQUENCE_MIGRATION_NAME,
  WIDGET_REVISION_SEQUENCE_MIGRATION_VERSION,
  WIDGET_INSTANCE_PROJECTION_MIGRATION_NAME,
  WIDGET_INSTANCE_PROJECTION_MIGRATION_VERSION,
} from '../../../src/CONSTANTS';
import {
  AGENT_AUTHORING_MIGRATION,
  FUNCTION_RUNTIME_MIGRATION,
  INITIAL_MIGRATION,
  WIDGET_REVISION_SEQUENCE_MIGRATION,
  WIDGET_INSTANCE_PROJECTION_MIGRATION,
} from '../../../src/migrations/CONSTANTS';
import {
  DbServiceTurso,
  preflightDbServiceDatabase,
} from '../../../src/DbServiceTurso/DbServiceTurso';
import {
  fnFindTopLevelMigrationTransactionControl,
} from '../../../src/DbServiceTurso/fn.migration-sql-transaction-control';
import { listMigrationFiles } from '../../../src/DbServiceTurso/list-migration-files';
import { fxPreflightMigrationState } from '../../../src/DbServiceTurso/fx.migration-state';
import { txRunMigrations } from '../../../src/DbServiceTurso/tx.migrations';
import { listEmbeddedMigrationFiles } from '../../../src/_embedded-migrations';
import {
  EXPECTED_AGENT_AUTHORING_APPLICATION_TABLES,
  EXPECTED_DATABASE_SCHEMA_CONTRACTS,
} from '../../../src/schema/expected-schema';

const temporaryRoots: string[] = [];
const databases: Database[] = [];
const V0_DEFINITION_ID = '00000000-0000-4000-8000-000000000701';
const V0_ARTIFACT_ID = '00000000-0000-4000-8000-000000000702';
const V0_REVISION_ID = '00000000-0000-4000-8000-000000000703';

type TImmediateTransaction = (() => Promise<void>) & {
  immediate(): Promise<void>;
};

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
    expectedSchemaContracts: EXPECTED_DATABASE_SCHEMA_CONTRACTS,
    ...overrides,
  };
}

function syntheticPreflightArgs() {
  return {
    expectedSchemaContracts: EXPECTED_DATABASE_SCHEMA_CONTRACTS,
    migrations: [
      {
        version: INITIAL_MIGRATION_VERSION,
        name: INITIAL_MIGRATION_NAME,
        checksumSha256: 'a'.repeat(64),
      },
      {
        version: WIDGET_REVISION_SEQUENCE_MIGRATION_VERSION,
        name: WIDGET_REVISION_SEQUENCE_MIGRATION_NAME,
        checksumSha256: 'b'.repeat(64),
      },
      {
        version: FUNCTION_RUNTIME_MIGRATION_VERSION,
        name: FUNCTION_RUNTIME_MIGRATION_NAME,
        checksumSha256: 'c'.repeat(64),
      },
      {
        version: WIDGET_INSTANCE_PROJECTION_MIGRATION_VERSION,
        name: WIDGET_INSTANCE_PROJECTION_MIGRATION_NAME,
        checksumSha256: 'd'.repeat(64),
      },
      {
        version: AGENT_AUTHORING_MIGRATION_VERSION,
        name: AGENT_AUTHORING_MIGRATION_NAME,
        checksumSha256: 'e'.repeat(64),
      },
    ],
  } as const;
}

async function runMigrations(
  db: Database,
  overrides: Partial<Parameters<typeof txRunMigrations>[1]> = {},
) {
  return txRunMigrations({ db, Bun, TextDecoder }, migrationArgs(overrides));
}

async function pragma(db: Database, name: string): Promise<unknown> {
  return (await (await db.prepare(`PRAGMA ${name}`)).get())?.[name];
}

async function migrationChecksum(pathname: string): Promise<string> {
  return new Bun.CryptoHasher('sha256')
    .update(new Uint8Array(await Bun.file(pathname).arrayBuffer()))
    .digest('hex');
}

async function bootstrapVersionZero(db: Database, sqlOverride?: string): Promise<void> {
  const [registeredSql, checksum] = await Promise.all([
    Bun.file(INITIAL_MIGRATION.path).text(),
    migrationChecksum(INITIAL_MIGRATION.path),
  ]);
  const sql = sqlOverride ?? registeredSql;
  await db.exec('PRAGMA foreign_keys = ON; PRAGMA ignore_check_constraints = 0;');
  const apply = db.transaction(async () => {
    await db.exec(sql);
    await (await db.prepare(`
      INSERT INTO schema_migrations (
        version, name, checksum_sha256, applied_at_ms, application_version
      ) VALUES (?, ?, ?, 1, '0.9.0-test')
    `)).run(INITIAL_MIGRATION_VERSION, INITIAL_MIGRATION_NAME, checksum);
    await db.exec(`
      PRAGMA application_id = ${DATABASE_APPLICATION_ID};
      PRAGMA user_version = ${INITIAL_MIGRATION_VERSION};
    `);
  }) as TImmediateTransaction;
  await apply.immediate();
}

async function seedVersionZeroRevision(db: Database): Promise<void> {
  await (await db.prepare(`
    INSERT INTO artifact_references (
      org_id, id, kind, digest_sha256, byte_size,
      retention_state, retain_until_ms, created_at_ms
    ) VALUES (?, ?, 'ui', ?, 1, 'pinned', NULL, 1)
  `)).run(DEFAULT_OSS_ORGANIZATION_ID, V0_ARTIFACT_ID, 'a'.repeat(64));
  await (await db.prepare(`
    INSERT INTO widget_definitions (
      org_id, id, slug, name, status, active_revision_id, created_at_ms, updated_at_ms
    ) VALUES (?, ?, 'v0-sequence', 'V0 sequence', 'draft', NULL, 1, 1)
  `)).run(DEFAULT_OSS_ORGANIZATION_ID, V0_DEFINITION_ID);
  await (await db.prepare(`
    INSERT INTO widget_definition_revisions (
      org_id, id, definition_id, revision_number,
      ui_artifact_id, ui_artifact_kind, server_artifact_id, server_artifact_kind,
      manifest_json, contract_digest_sha256, created_at_ms
    ) VALUES (?, ?, ?, 4, ?, 'ui', NULL, NULL, '{}', ?, 1)
  `)).run(
    DEFAULT_OSS_ORGANIZATION_ID,
    V0_REVISION_ID,
    V0_DEFINITION_ID,
    V0_ARTIFACT_ID,
    'b'.repeat(64),
  );
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('migration SQL transaction-control guard', () => {
  for (const keyword of ['BEGIN', 'COMMIT', 'END', 'ROLLBACK', 'SAVEPOINT', 'RELEASE']) {
    test(`rejects top-level ${keyword} with or without an EXPLAIN prefix`, () => {
      expect(fnFindTopLevelMigrationTransactionControl(`${keyword} TRANSACTION;`)).toBe(keyword);
      expect(fnFindTopLevelMigrationTransactionControl(`SELECT 1; ${keyword};`)).toBe(keyword);
      expect(fnFindTopLevelMigrationTransactionControl(`EXPLAIN /* gap */ ${keyword};`)).toBe(keyword);
      expect(fnFindTopLevelMigrationTransactionControl(
        `EXPLAIN QUERY -- gap\n PLAN ${keyword};`,
      )).toBe(keyword);
    });
  }

  test('ignores transaction words in comments, literals, quoted names, and ordinary identifiers', () => {
    expect(fnFindTopLevelMigrationTransactionControl(`
      -- BEGIN; COMMIT; END;
      /* ROLLBACK; SAVEPOINT hidden; RELEASE hidden; */
      SELECT
        'BEGIN; COMMIT',
        "END",
        \`ROLLBACK\`,
        [SAVEPOINT];
      CREATE TABLE release_notes (
        beginning TEXT,
        committed_at TEXT,
        rollback_reason TEXT
      );
      INSERT INTO release_notes (beginning) VALUES ('END; BEGIN');
      SELECT explainable, release_candidate FROM ordinary_identifiers;
    `)).toBeNull();
  });

  test('does not treat a trigger body or CASE terminator as top-level transaction control', () => {
    expect(fnFindTopLevelMigrationTransactionControl(`
      CREATE TEMP TRIGGER audit_insert AFTER INSERT ON source
      BEGIN
        INSERT INTO audit_log(value) VALUES ('ROLLBACK;');
        UPDATE audit_log
        SET value = CASE WHEN value = 'BEGIN' THEN 'END' ELSE 'COMMIT' END;
        SELECT RAISE(ROLLBACK, 'blocked') WHERE NEW.blocked = 1;
      END;
      SELECT 1;
    `)).toBeNull();
  });

  test('resumes top-level scanning after a trigger body', () => {
    expect(fnFindTopLevelMigrationTransactionControl(`
      CREATE TRIGGER audit_insert AFTER INSERT ON source
      BEGIN
        INSERT INTO audit_log(value) VALUES (NEW.value);
      END;
      /* the trigger is complete */ RELEASE migration_guard;
    `)).toBe('RELEASE');
  });
});

describe('ordered managed migration runner', () => {
  test('statically registers and embeds the complete immutable migration sequence', async () => {
    expect(listMigrationFiles()).toEqual([
      expect.objectContaining({
        type: 'sql',
        name: INITIAL_MIGRATION_NAME,
        version: INITIAL_MIGRATION_VERSION,
      }),
      expect.objectContaining({
        type: 'sql',
        name: WIDGET_REVISION_SEQUENCE_MIGRATION_NAME,
        version: WIDGET_REVISION_SEQUENCE_MIGRATION_VERSION,
      }),
      expect.objectContaining({
        type: 'sql',
        name: FUNCTION_RUNTIME_MIGRATION_NAME,
        version: FUNCTION_RUNTIME_MIGRATION_VERSION,
      }),
      expect.objectContaining({
        type: 'sql',
        name: WIDGET_INSTANCE_PROJECTION_MIGRATION_NAME,
        version: WIDGET_INSTANCE_PROJECTION_MIGRATION_VERSION,
      }),
      expect.objectContaining({
        type: 'sql',
        name: AGENT_AUTHORING_MIGRATION_NAME,
        version: AGENT_AUTHORING_MIGRATION_VERSION,
      }),
    ]);
    expect(listEmbeddedMigrationFiles()).toEqual([
      INITIAL_MIGRATION_NAME,
      WIDGET_REVISION_SEQUENCE_MIGRATION_NAME,
      FUNCTION_RUNTIME_MIGRATION_NAME,
      WIDGET_INSTANCE_PROJECTION_MIGRATION_NAME,
      AGENT_AUTHORING_MIGRATION_NAME,
    ]);

    const migrationDirectory = new URL('../../../src/migrations/', import.meta.url).pathname;
    const discovered = (await fs.readdir(migrationDirectory))
      .filter((file) => file.endsWith('.sql'))
      .sort();
    expect(discovered).toEqual([
      INITIAL_MIGRATION_NAME,
      WIDGET_REVISION_SEQUENCE_MIGRATION_NAME,
      FUNCTION_RUNTIME_MIGRATION_NAME,
      WIDGET_INSTANCE_PROJECTION_MIGRATION_NAME,
      AGENT_AUTHORING_MIGRATION_NAME,
    ]);
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
        version: INITIAL_MIGRATION_VERSION,
        name: INITIAL_MIGRATION_NAME,
        checksum_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        applied_at_ms: 1_753_113_600_000,
        application_version: '1.2.3-test',
      },
      {
        version: WIDGET_REVISION_SEQUENCE_MIGRATION_VERSION,
        name: WIDGET_REVISION_SEQUENCE_MIGRATION_NAME,
        checksum_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        applied_at_ms: 1_753_113_600_000,
        application_version: '1.2.3-test',
      },
      {
        version: FUNCTION_RUNTIME_MIGRATION_VERSION,
        name: FUNCTION_RUNTIME_MIGRATION_NAME,
        checksum_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        applied_at_ms: 1_753_113_600_000,
        application_version: '1.2.3-test',
      },
      {
        version: WIDGET_INSTANCE_PROJECTION_MIGRATION_VERSION,
        name: WIDGET_INSTANCE_PROJECTION_MIGRATION_NAME,
        checksum_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        applied_at_ms: 1_753_113_600_000,
        application_version: '1.2.3-test',
      },
      {
        version: AGENT_AUTHORING_MIGRATION_VERSION,
        name: AGENT_AUTHORING_MIGRATION_NAME,
        checksum_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        applied_at_ms: 1_753_113_600_000,
        application_version: '1.2.3-test',
      },
    ]);
    expect((await (await db.prepare('PRAGMA table_info(widget_definitions)')).all())
      .find((column) => column.name === 'next_revision_number')).toMatchObject({
        type: 'INTEGER',
        notnull: 1,
        dflt_value: '1',
      });
    expect((await (await db.prepare('PRAGMA table_info(collaboration_documents)')).all())
      .find((column) => column.name === 'content_version')).toMatchObject({
        type: 'INTEGER',
        notnull: 1,
        dflt_value: '0',
      });
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
    expect(tables.map((row) => row.name)).toEqual(
      [...EXPECTED_AGENT_AUTHORING_APPLICATION_TABLES].sort(),
    );
    expect(tables.every((row) => row.strict === 1)).toBe(true);
  });

  test('asserts WAL for the pinned Turso in-memory connection too', async () => {
    const db = await openDatabase(':memory:');

    await expect(runMigrations(db)).resolves.toEqual({ applied: true });
    expect(await pragma(db, 'journal_mode')).toBe('wal');
  });

  test('a ledger constraint failure rolls every fresh pending migration back and retry succeeds', async () => {
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

  test('upgrades a valid v0 prefix, backfills its durable revision sequence, and is idempotent', async () => {
    const root = await temporaryRoot();
    const db = await openDatabase(path.join(root, 'main.db'));
    await bootstrapVersionZero(db);
    await seedVersionZeroRevision(db);

    expect(await pragma(db, 'user_version')).toBe(INITIAL_MIGRATION_VERSION);
    expect((await (await db.prepare('PRAGMA table_info(widget_definitions)')).all())
      .some((column) => column.name === 'next_revision_number')).toBe(false);

    expect(await runMigrations(db)).toEqual({ applied: true });
    expect(await pragma(db, 'user_version')).toBe(DATABASE_SCHEMA_VERSION);
    expect(await (await db.prepare(`
      SELECT next_revision_number FROM widget_definitions WHERE org_id = ? AND id = ?
    `)).get(DEFAULT_OSS_ORGANIZATION_ID, V0_DEFINITION_ID)).toEqual({ next_revision_number: 5 });
    expect(await (await db.prepare(`
      SELECT version, name FROM schema_migrations ORDER BY version
    `)).all()).toEqual([
      { version: INITIAL_MIGRATION_VERSION, name: INITIAL_MIGRATION_NAME },
      { version: WIDGET_REVISION_SEQUENCE_MIGRATION_VERSION, name: WIDGET_REVISION_SEQUENCE_MIGRATION_NAME },
      { version: FUNCTION_RUNTIME_MIGRATION_VERSION, name: FUNCTION_RUNTIME_MIGRATION_NAME },
      { version: WIDGET_INSTANCE_PROJECTION_MIGRATION_VERSION, name: WIDGET_INSTANCE_PROJECTION_MIGRATION_NAME },
      { version: AGENT_AUTHORING_MIGRATION_VERSION, name: AGENT_AUTHORING_MIGRATION_NAME },
    ]);

    const ledger = await (await db.prepare('SELECT * FROM schema_migrations ORDER BY version')).all();
    expect(await runMigrations(db, { appliedAtMs: 9_999 })).toEqual({ applied: false });
    expect(await (await db.prepare('SELECT * FROM schema_migrations ORDER BY version')).all()).toEqual(ledger);
  });

  test('rolls a failed v0-to-v1 migration back to the exact valid prefix and retries', async () => {
    const root = await temporaryRoot();
    const db = await openDatabase(path.join(root, 'main.db'));
    await bootstrapVersionZero(db);

    await expect(runMigrations(db, { applicationVersion: 'x'.repeat(101) })).rejects.toThrow();
    expect(await pragma(db, 'user_version')).toBe(INITIAL_MIGRATION_VERSION);
    expect(await (await db.prepare('SELECT version, name FROM schema_migrations')).all()).toEqual([
      { version: INITIAL_MIGRATION_VERSION, name: INITIAL_MIGRATION_NAME },
    ]);
    expect((await (await db.prepare('PRAGMA table_info(widget_definitions)')).all())
      .some((column) => column.name === 'next_revision_number')).toBe(false);

    expect(await runMigrations(db)).toEqual({ applied: true });
    expect((await (await db.prepare('PRAGMA table_info(widget_definitions)')).all())
      .some((column) => column.name === 'next_revision_number')).toBe(true);
  });

  test('refuses corrupt pending data before pragmas or migration mutate the v0 prefix', async () => {
    const root = await temporaryRoot();
    const db = await openDatabase(path.join(root, 'corrupt-v0.db'));
    await bootstrapVersionZero(db);
    await db.exec('PRAGMA ignore_check_constraints = 1');
    await (await db.prepare(`
      UPDATE organizations SET status = 'corrupt' WHERE id = ?
    `)).run(DEFAULT_OSS_ORGANIZATION_ID);
    await db.exec('PRAGMA ignore_check_constraints = 0; PRAGMA cache_size = 1234');
    const ledgerBefore = await (
      await db.prepare('SELECT * FROM schema_migrations ORDER BY version')
    ).all();
    const journalModeBefore = await pragma(db, 'journal_mode');

    await expect(runMigrations(db, { appliedAtMs: 9_999 })).rejects.toThrow(/integrity_check/i);

    expect(await pragma(db, 'journal_mode')).toBe(journalModeBefore);
    expect(await pragma(db, 'cache_size')).toBe(1234);
    expect(await pragma(db, 'user_version')).toBe(INITIAL_MIGRATION_VERSION);
    expect(await (
      await db.prepare('SELECT * FROM schema_migrations ORDER BY version')
    ).all()).toEqual(ledgerBefore);
    expect(await (await db.prepare(`
      SELECT status FROM organizations WHERE id = ?
    `)).get(DEFAULT_OSS_ORGANIZATION_ID)).toEqual({ status: 'corrupt' });
    expect((await (await db.prepare('PRAGMA table_info(widget_definitions)')).all())
      .some((column) => column.name === 'next_revision_number')).toBe(false);
  });

  test('rejects transaction control in a pending migration before inspecting or mutating v0', async () => {
    const root = await temporaryRoot();
    const db = await openDatabase(path.join(root, 'transaction-control-v0.db'));
    await bootstrapVersionZero(db);
    await seedVersionZeroRevision(db);
    await db.exec('PRAGMA cache_size = 1234');

    const registeredSql = await Bun.file(WIDGET_REVISION_SEQUENCE_MIGRATION.path).text();
    const unsafeBytes = new TextEncoder().encode(`
      -- Transaction words in comments are harmless, but the next statement is not.
      BEGIN IMMEDIATE;
      ${registeredSql}
      COMMIT;
    `);
    const migrationBun = {
      CryptoHasher: Bun.CryptoHasher,
      file: (pathname: string) => pathname === WIDGET_REVISION_SEQUENCE_MIGRATION.path
        ? { arrayBuffer: async () => unsafeBytes.buffer }
        : Bun.file(pathname),
    } as Pick<typeof Bun, 'CryptoHasher' | 'file'>;
    const ledgerBefore = await (
      await db.prepare('SELECT * FROM schema_migrations ORDER BY version')
    ).all();
    const revisionBefore = await (await db.prepare(`
      SELECT * FROM widget_definition_revisions WHERE org_id = ? AND id = ?
    `)).get(DEFAULT_OSS_ORGANIZATION_ID, V0_REVISION_ID);
    const journalModeBefore = await pragma(db, 'journal_mode');

    await expect(txRunMigrations(
      { db, Bun: migrationBun, TextDecoder },
      migrationArgs({ appliedAtMs: 9_999 }),
    )).rejects.toThrow(/top-level transaction control statement BEGIN/i);

    expect(await pragma(db, 'cache_size')).toBe(1234);
    expect(await pragma(db, 'journal_mode')).toBe(journalModeBefore);
    expect(await pragma(db, 'application_id')).toBe(DATABASE_APPLICATION_ID);
    expect(await pragma(db, 'user_version')).toBe(INITIAL_MIGRATION_VERSION);
    expect(await (
      await db.prepare('SELECT * FROM schema_migrations ORDER BY version')
    ).all()).toEqual(ledgerBefore);
    expect(await (await db.prepare(`
      SELECT * FROM widget_definition_revisions WHERE org_id = ? AND id = ?
    `)).get(DEFAULT_OSS_ORGANIZATION_ID, V0_REVISION_ID)).toEqual(revisionBefore);
    expect((await (await db.prepare('PRAGMA table_info(widget_definitions)')).all())
      .some((column) => column.name === 'next_revision_number')).toBe(false);
  });

  test('rolls back an executable pending migration whose final schema contract drifts', async () => {
    const root = await temporaryRoot();
    const db = await openDatabase(path.join(root, 'drifted-pending-migration.db'));
    await bootstrapVersionZero(db);
    const registeredSql = await Bun.file(WIDGET_REVISION_SEQUENCE_MIGRATION.path).text();
    const driftedSql = registeredSql.replace(
      'CHECK (next_revision_number >= 1)',
      'CHECK (next_revision_number >= 0)',
    );
    expect(driftedSql).not.toBe(registeredSql);
    const driftedBytes = new TextEncoder().encode(driftedSql);
    const migrationBun = {
      CryptoHasher: Bun.CryptoHasher,
      file: (pathname: string) => pathname === WIDGET_REVISION_SEQUENCE_MIGRATION.path
        ? { arrayBuffer: async () => driftedBytes.buffer }
        : Bun.file(pathname),
    } as Pick<typeof Bun, 'CryptoHasher' | 'file'>;
    const ledgerBefore = await (
      await db.prepare('SELECT * FROM schema_migrations ORDER BY version')
    ).all();

    await expect(txRunMigrations(
      { db, Bun: migrationBun, TextDecoder },
      migrationArgs({ appliedAtMs: 9_999 }),
    )).rejects.toThrow(/migration transaction|fingerprint/i);

    expect(await pragma(db, 'user_version')).toBe(INITIAL_MIGRATION_VERSION);
    expect(await (
      await db.prepare('SELECT * FROM schema_migrations ORDER BY version')
    ).all()).toEqual(ledgerBefore);
    expect((await (await db.prepare('PRAGMA table_info(widget_definitions)')).all())
      .some((column) => column.name === 'next_revision_number')).toBe(false);
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

  for (const corruption of [
    {
      label: 'missing',
      indexName: 'idempotency_records_org_key_idx',
      sql: 'DROP INDEX idempotency_records_org_key_idx',
      expectedPresent: false,
      expectedVersion: INITIAL_MIGRATION_VERSION,
    },
    {
      label: 'extra',
      indexName: 'unexpected_widget_slug_idx',
      sql: 'CREATE INDEX unexpected_widget_slug_idx ON widget_definitions (org_id, slug)',
      expectedPresent: true,
      expectedVersion: DATABASE_SCHEMA_VERSION,
    },
  ] as const) {
    test(`refuses a managed schema with a ${corruption.label} explicit index without repairing it`, async () => {
      const root = await temporaryRoot();
      const db = await openDatabase(path.join(root, `index-${corruption.label}.db`));
      if (corruption.expectedVersion === INITIAL_MIGRATION_VERSION) {
        await bootstrapVersionZero(db);
      } else {
        await runMigrations(db);
      }
      await db.exec(corruption.sql);
      const ledgerBefore = await (
        await db.prepare('SELECT * FROM schema_migrations ORDER BY version')
      ).all();

      await expect(runMigrations(db, { appliedAtMs: 9_999 })).rejects.toThrow(/fingerprint/i);
      expect(Boolean(await (await db.prepare(`
        SELECT 1 FROM sqlite_schema WHERE type = 'index' AND name = ?
      `)).get(corruption.indexName))).toBe(corruption.expectedPresent);
      expect(await (
        await db.prepare('SELECT * FROM schema_migrations ORDER BY version')
      ).all()).toEqual(ledgerBefore);
      expect(await pragma(db, 'user_version')).toBe(corruption.expectedVersion);
      if (corruption.expectedVersion === INITIAL_MIGRATION_VERSION) {
        expect((await (await db.prepare('PRAGMA table_info(widget_definitions)')).all())
          .some((column) => column.name === 'next_revision_number')).toBe(false);
      }
    });
  }

  test('whole-schema fingerprint rejects a weakened partial-index predicate with identical metadata', async () => {
    const root = await temporaryRoot();
    const db = await openDatabase(path.join(root, 'weakened-partial-index.db'));
    await runMigrations(db);
    await db.exec(`
      DROP INDEX idempotency_records_org_key_idx;
      CREATE UNIQUE INDEX idempotency_records_org_key_idx
        ON idempotency_records (org_id, idempotency_key)
        WHERE 0;
    `);
    const ledgerBefore = await (
      await db.prepare('SELECT * FROM schema_migrations ORDER BY version')
    ).all();
    const indexBefore = await (await db.prepare(`
      SELECT sql FROM sqlite_schema
      WHERE type = 'index' AND name = 'idempotency_records_org_key_idx'
    `)).get() as { sql: string };
    const indexMetadata = await (await db.prepare(
      'PRAGMA index_list(idempotency_records)',
    )).all() as Array<{ name: string; partial: number; unique: number }>;
    expect(indexMetadata.find((index) => index.name === 'idempotency_records_org_key_idx'))
      .toMatchObject({ partial: 1, unique: 1 });
    expect((await (await db.prepare(
      'PRAGMA index_info(idempotency_records_org_key_idx)',
    )).all()).map((row) => row.name)).toEqual(['org_id', 'idempotency_key']);

    await expect(runMigrations(db, { appliedAtMs: 9_999 })).rejects.toThrow(/fingerprint/i);
    expect(await (await db.prepare(`
      SELECT sql FROM sqlite_schema
      WHERE type = 'index' AND name = 'idempotency_records_org_key_idx'
    `)).get()).toEqual(indexBefore);
    expect(indexBefore.sql.replace(/\s+/g, '')).toContain('WHERE0');
    expect(await (
      await db.prepare('SELECT * FROM schema_migrations ORDER BY version')
    ).all()).toEqual(ledgerBefore);
    expect(await pragma(db, 'user_version')).toBe(DATABASE_SCHEMA_VERSION);
  });

  test('sqlite-like user index names are not misclassified as internal objects', async () => {
    const root = await temporaryRoot();
    const db = await openDatabase(path.join(root, 'sqlite-like-index.db'));
    await runMigrations(db);
    const indexName = 'sqlitexautoindexyunexpected';
    await db.exec(`CREATE INDEX ${indexName} ON widget_definitions (org_id, slug)`);
    const ledgerBefore = await (
      await db.prepare('SELECT * FROM schema_migrations ORDER BY version')
    ).all();

    await expect(runMigrations(db, { appliedAtMs: 9_999 })).rejects.toThrow(/fingerprint/i);
    expect(await (await db.prepare(`
      SELECT name FROM sqlite_schema WHERE type = 'index' AND name = ?
    `)).get(indexName)).toEqual({ name: indexName });
    expect(await (
      await db.prepare('SELECT * FROM schema_migrations ORDER BY version')
    ).all()).toEqual(ledgerBefore);
    expect(await pragma(db, 'user_version')).toBe(DATABASE_SCHEMA_VERSION);
  });

  for (const corruption of [
    {
      label: 'removed checksum CHECK',
      tableName: 'schema_migrations',
      original: `  checksum_sha256 TEXT NOT NULL CHECK (
    length(checksum_sha256) = 64
    AND checksum_sha256 = lower(checksum_sha256)
    AND checksum_sha256 NOT GLOB '*[^0-9a-f]*'
  ),`,
      replacement: '  checksum_sha256 TEXT NOT NULL,',
      removedFragment: 'length(checksum_sha256) = 64',
    },
    {
      label: 'removed column default',
      tableName: 'widget_definition_revisions',
      original: "  ui_artifact_kind TEXT NOT NULL DEFAULT 'ui' CHECK (ui_artifact_kind = 'ui'),",
      replacement: "  ui_artifact_kind TEXT NOT NULL CHECK (ui_artifact_kind = 'ui'),",
      removedFragment: "DEFAULT 'ui'",
    },
  ] as const) {
    test(`whole-schema fingerprint rejects a baseline with a ${corruption.label}`, async () => {
      const root = await temporaryRoot();
      const db = await openDatabase(path.join(root, `${corruption.tableName}-drift.db`));
      const baselineSql = await Bun.file(INITIAL_MIGRATION.path).text();
      const driftedSql = baselineSql.replace(corruption.original, corruption.replacement);
      expect(driftedSql).not.toBe(baselineSql);
      await bootstrapVersionZero(db, driftedSql);
      const ledgerBefore = await (
        await db.prepare('SELECT * FROM schema_migrations ORDER BY version')
      ).all();
      const schemaBefore = await (await db.prepare(`
        SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?
      `)).get(corruption.tableName) as { sql: string };
      expect(schemaBefore.sql).not.toContain(corruption.removedFragment);

      await expect(runMigrations(db, { appliedAtMs: 9_999 })).rejects.toThrow(/fingerprint/i);
      expect(await (await db.prepare(`
        SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?
      `)).get(corruption.tableName)).toEqual(schemaBefore);
      expect(await (
        await db.prepare('SELECT * FROM schema_migrations ORDER BY version')
      ).all()).toEqual(ledgerBefore);
      expect(await pragma(db, 'user_version')).toBe(INITIAL_MIGRATION_VERSION);
      expect((await (await db.prepare('PRAGMA table_info(widget_definitions)')).all())
        .some((column) => column.name === 'next_revision_number')).toBe(false);
    });
  }

  test('refuses a claimed v1 whose 001 column check drifted without repairing it', async () => {
    const root = await temporaryRoot();
    const db = await openDatabase(path.join(root, 'drifted-001.db'));
    await bootstrapVersionZero(db);
    await db.exec(`
      ALTER TABLE widget_definitions
        ADD COLUMN next_revision_number INTEGER NOT NULL DEFAULT 1
        CHECK (next_revision_number >= 0)
    `);
    await (await db.prepare(`
      INSERT INTO schema_migrations (
        version, name, checksum_sha256, applied_at_ms, application_version
      ) VALUES (?, ?, ?, 2, 'forged-v1')
    `)).run(
      WIDGET_REVISION_SEQUENCE_MIGRATION_VERSION,
      WIDGET_REVISION_SEQUENCE_MIGRATION_NAME,
      await migrationChecksum(WIDGET_REVISION_SEQUENCE_MIGRATION.path),
    );
    await db.exec(`PRAGMA user_version = ${WIDGET_REVISION_SEQUENCE_MIGRATION_VERSION}`);
    const ledgerBefore = await (
      await db.prepare('SELECT * FROM schema_migrations ORDER BY version')
    ).all();

    await expect(runMigrations(db, { appliedAtMs: 9_999 })).rejects.toThrow(/fingerprint/i);
    const schema = await (await db.prepare(`
      SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'widget_definitions'
    `)).get() as { sql: string };
    expect(schema.sql.replace(/\s+/g, '')).toContain(
      'next_revision_numberINTEGERNOTNULLDEFAULT1CHECK(next_revision_number>=0)',
    );
    expect(await (
      await db.prepare('SELECT * FROM schema_migrations ORDER BY version')
    ).all()).toEqual(ledgerBefore);
    expect(await pragma(db, 'user_version')).toBe(WIDGET_REVISION_SEQUENCE_MIGRATION_VERSION);
  });

  test('refuses a v0 foreign-key orphan before upgrade and preserves the damage', async () => {
    const root = await temporaryRoot();
    const db = await openDatabase(path.join(root, 'orphaned-v0.db'));
    await bootstrapVersionZero(db);
    await db.exec('PRAGMA foreign_keys = OFF');
    await (await db.prepare(`
      INSERT INTO widget_definitions (
        org_id, id, slug, name, status, active_revision_id, created_at_ms, updated_at_ms
      ) VALUES (?, ?, 'orphaned', 'Orphaned', 'draft', NULL, 1, 1)
    `)).run('00000000-0000-4000-8000-000000000799', '00000000-0000-4000-8000-000000000798');
    await db.exec('PRAGMA foreign_keys = ON');
    const ledgerBefore = await (
      await db.prepare('SELECT * FROM schema_migrations ORDER BY version')
    ).all();

    await expect(runMigrations(db, { appliedAtMs: 9_999 })).rejects.toThrow(/foreign-key integrity/i);
    expect(await (await db.prepare(`
      SELECT slug FROM widget_definitions WHERE id = '00000000-0000-4000-8000-000000000798'
    `)).get()).toEqual({ slug: 'orphaned' });
    expect(await (
      await db.prepare('SELECT * FROM schema_migrations ORDER BY version')
    ).all()).toEqual(ledgerBefore);
    expect(await pragma(db, 'user_version')).toBe(INITIAL_MIGRATION_VERSION);
    expect((await (await db.prepare('PRAGMA table_info(widget_definitions)')).all())
      .some((column) => column.name === 'next_revision_number')).toBe(false);
  });

  test('checksum tampering in every applied ledger row is fatal and is not repaired', async () => {
    const root = await temporaryRoot();
    const db = await openDatabase(path.join(root, 'main.db'));
    await runMigrations(db);
    const ledger = await (await db.prepare(`
      SELECT version, checksum_sha256 FROM schema_migrations ORDER BY version
    `)).all() as Array<{ version: number; checksum_sha256: string }>;

    for (const [index, migration] of ledger.entries()) {
      const tamperedChecksum = (index === 0 ? '0' : 'f').repeat(64);
      await (await db.prepare(`
        UPDATE schema_migrations SET checksum_sha256 = ? WHERE version = ?
      `)).run(tamperedChecksum, migration.version);
      await expect(runMigrations(db)).rejects.toThrow(/checksum/i);
      expect(await (await db.prepare(`
        SELECT checksum_sha256 FROM schema_migrations WHERE version = ?
      `)).get(migration.version)).toEqual({ checksum_sha256: tamperedChecksum });
      await (await db.prepare(`
        UPDATE schema_migrations SET checksum_sha256 = ? WHERE version = ?
      `)).run(migration.checksum_sha256, migration.version);
    }
  });

  test('rejects ledger gaps and database versions newer than this binary', async () => {
    const root = await temporaryRoot();
    const gapDb = await openDatabase(path.join(root, 'gap.db'));
    await runMigrations(gapDb);
    await (await gapDb.prepare('DELETE FROM schema_migrations WHERE version = ?'))
      .run(INITIAL_MIGRATION_VERSION);
    await expect(runMigrations(gapDb)).rejects.toThrow(/contiguous|missing/i);
    expect(await pragma(gapDb, 'user_version')).toBe(DATABASE_SCHEMA_VERSION);

    const newerDb = await openDatabase(path.join(root, 'newer.db'));
    await runMigrations(newerDb);
    await (await newerDb.prepare(`
      INSERT INTO schema_migrations (
        version, name, checksum_sha256, applied_at_ms, application_version
      ) VALUES (?, '002-future.sql', ?, 1, 'future')
    `)).run(DATABASE_SCHEMA_VERSION + 1, 'c'.repeat(64));
    await newerDb.exec(`PRAGMA user_version = ${DATABASE_SCHEMA_VERSION + 1}`);
    await expect(runMigrations(newerDb)).rejects.toThrow(/newer than this binary/i);
    expect(await pragma(newerDb, 'user_version')).toBe(DATABASE_SCHEMA_VERSION + 1);
  });

  test('serializes concurrent fresh starters under the immediate migration lock', async () => {
    const root = await temporaryRoot();
    const databasePath = path.join(root, 'concurrent.db');
    const first = await openDatabase(databasePath);
    const second = await openDatabase(databasePath);

    const results = await Promise.all([runMigrations(first), runMigrations(second)]);
    expect(results.map((result) => result.applied).sort()).toEqual([false, true]);
    expect(await (await first.prepare(`
      SELECT version, name FROM schema_migrations ORDER BY version
    `)).all()).toEqual([
      { version: INITIAL_MIGRATION_VERSION, name: INITIAL_MIGRATION_NAME },
      { version: WIDGET_REVISION_SEQUENCE_MIGRATION_VERSION, name: WIDGET_REVISION_SEQUENCE_MIGRATION_NAME },
      { version: FUNCTION_RUNTIME_MIGRATION_VERSION, name: FUNCTION_RUNTIME_MIGRATION_NAME },
      { version: WIDGET_INSTANCE_PROJECTION_MIGRATION_VERSION, name: WIDGET_INSTANCE_PROJECTION_MIGRATION_NAME },
      { version: AGENT_AUTHORING_MIGRATION_VERSION, name: AGENT_AUTHORING_MIGRATION_NAME },
    ]);
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

  test('a version-zero view-only database is non-empty and refused without mutation', async () => {
    const root = await temporaryRoot();
    const db = await openDatabase(path.join(root, 'view-only.db'));
    await db.exec('PRAGMA cache_size = 1234; CREATE VIEW unknown_view AS SELECT 1 AS value');
    const journalModeBefore = await pragma(db, 'journal_mode');

    await expect(runMigrations(db)).rejects.toThrow(/unknown|actor-era/i);
    expect(await pragma(db, 'journal_mode')).toBe(journalModeBefore);
    expect(await pragma(db, 'cache_size')).toBe(1234);
    expect(await pragma(db, 'application_id')).toBe(0);
    expect(await pragma(db, 'user_version')).toBe(0);
    expect(await (await db.prepare(`
      SELECT type, name FROM sqlite_schema
      WHERE type IN ('table', 'view', 'trigger') AND name NOT LIKE 'sqlite_%'
      ORDER BY type, name
    `)).all()).toEqual([{ type: 'view', name: 'unknown_view' }]);
  });

  test('unsupported virtual and shadow table-list rows are explicitly refused', async () => {
    for (const type of ['virtual', 'shadow'] as const) {
      const fakeDb = {
        prepare: async (sql: string) => {
          if (sql === 'PRAGMA application_id') {
            return { get: async () => ({ application_id: 0 }) };
          }
          if (sql === 'PRAGMA user_version') {
            return { get: async () => ({ user_version: 0 }) };
          }
          if (sql === 'PRAGMA table_list') {
            return {
              all: async () => [{
                schema: 'main',
                name: `unsupported_${type}`,
                type,
                strict: 0,
              }],
            };
          }
          if (sql.includes('FROM sqlite_schema')) return { all: async () => [] };
          throw new Error(`Unexpected preflight statement: ${sql}`);
        },
      } as unknown as Database;

      await expect(fxPreflightMigrationState(
        { Bun, db: fakeDb },
        syntheticPreflightArgs(),
      )).rejects.toThrow(/unsupported main-schema table-list objects/i);
    }
  });

  test('sqlite_schema makes a hidden virtual-table-only database non-empty', async () => {
    const fakeDb = {
      prepare: async (sql: string) => {
        if (sql === 'PRAGMA application_id') {
          return { get: async () => ({ application_id: 0 }) };
        }
        if (sql === 'PRAGMA user_version') {
          return { get: async () => ({ user_version: 0 }) };
        }
        if (sql === 'PRAGMA table_list') return { all: async () => [] };
        if (sql.includes('FROM sqlite_schema')) {
          return { all: async () => [{ type: 'table', name: 'hidden_virtual_table' }] };
        }
        throw new Error(`Unexpected preflight statement: ${sql}`);
      },
    } as unknown as Database;

    await expect(fxPreflightMigrationState(
      { Bun, db: fakeDb },
      syntheticPreflightArgs(),
    )).rejects.toThrow(/non-empty unknown|actor-era/i);
  });

  for (const extra of [
    {
      kind: 'view',
      name: 'unexpected_managed_view',
      sql: 'CREATE VIEW unexpected_managed_view AS SELECT 1 AS value',
    },
    {
      kind: 'trigger',
      name: 'unexpected_managed_trigger',
      sql: `
        CREATE TRIGGER unexpected_managed_trigger
        AFTER UPDATE ON widget_definitions
        BEGIN
          SELECT 1;
        END
      `,
    },
  ] as const) {
    test(`an otherwise managed database refuses an extra ${extra.kind} without repairing it`, async () => {
      const root = await temporaryRoot();
      const db = await openDatabase(path.join(root, `managed-extra-${extra.kind}.db`));
      await runMigrations(db);
      await db.exec(extra.sql);
      const ledgerBefore = await (
        await db.prepare('SELECT * FROM schema_migrations ORDER BY version')
      ).all();

      await expect(runMigrations(db, { appliedAtMs: 9_999 })).rejects.toThrow(/object manifest/i);
      expect(await (await db.prepare(`
        SELECT type, name FROM sqlite_schema WHERE type = ? AND name = ?
      `)).all(extra.kind, extra.name)).toEqual([{ type: extra.kind, name: extra.name }]);
      expect(await (
        await db.prepare('SELECT * FROM schema_migrations ORDER BY version')
      ).all()).toEqual(ledgerBefore);
      expect(await pragma(db, 'user_version')).toBe(DATABASE_SCHEMA_VERSION);
    });
  }

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
    ].map((name) => fs.mkdir(path.join(organizationRoot, name), { recursive: true })));
    await fs.mkdir(path.join(homeDir, 'cache'));
    await fs.mkdir(path.join(homeDir, 'logs'));

    await expect(preflightDbServiceDatabase({
      homeDir,
      databasePath: path.join(homeDir, 'main.db'),
    })).resolves.toEqual({ status: 'empty' });
  });

  test('accepts exact embedded installer prefixes and rejects gaps or unknown files', async () => {
    const homeDir = await temporaryRoot();
    const migrationDir = path.join(homeDir, 'database-migrations');
    await fs.mkdir(migrationDir);
    await fs.copyFile(INITIAL_MIGRATION.path, path.join(migrationDir, INITIAL_MIGRATION_NAME));

    await expect(preflightDbServiceDatabase({
      homeDir,
      databasePath: path.join(homeDir, 'main.db'),
    })).resolves.toEqual({ status: 'empty' });

    await fs.copyFile(
      WIDGET_REVISION_SEQUENCE_MIGRATION.path,
      path.join(migrationDir, WIDGET_REVISION_SEQUENCE_MIGRATION_NAME),
    );
    await expect(preflightDbServiceDatabase({
      homeDir,
      databasePath: path.join(homeDir, 'main.db'),
    })).resolves.toEqual({ status: 'empty' });

    await fs.copyFile(
      FUNCTION_RUNTIME_MIGRATION.path,
      path.join(migrationDir, FUNCTION_RUNTIME_MIGRATION_NAME),
    );
    await expect(preflightDbServiceDatabase({
      homeDir,
      databasePath: path.join(homeDir, 'main.db'),
    })).resolves.toEqual({ status: 'empty' });

    await fs.copyFile(
      WIDGET_INSTANCE_PROJECTION_MIGRATION.path,
      path.join(migrationDir, WIDGET_INSTANCE_PROJECTION_MIGRATION_NAME),
    );
    await expect(preflightDbServiceDatabase({
      homeDir,
      databasePath: path.join(homeDir, 'main.db'),
    })).resolves.toEqual({ status: 'empty' });

    await fs.copyFile(
      AGENT_AUTHORING_MIGRATION.path,
      path.join(migrationDir, AGENT_AUTHORING_MIGRATION_NAME),
    );
    await expect(preflightDbServiceDatabase({
      homeDir,
      databasePath: path.join(homeDir, 'main.db'),
    })).resolves.toEqual({ status: 'empty' });

    await fs.rm(path.join(migrationDir, INITIAL_MIGRATION_NAME));
    await expect(preflightDbServiceDatabase({
      homeDir,
      databasePath: path.join(homeDir, 'main.db'),
    })).rejects.toThrow(/contiguous prefix/i);

    await fs.copyFile(INITIAL_MIGRATION.path, path.join(migrationDir, INITIAL_MIGRATION_NAME));
    await fs.writeFile(path.join(migrationDir, '016-add-encryption-keys.sql'), 'legacy');
    await expect(preflightDbServiceDatabase({
      homeDir,
      databasePath: path.join(homeDir, 'main.db'),
    })).rejects.toThrow(/unknown database-migrations/i);
  });

  test('recognizes a valid v0 database as pending without modifying it', async () => {
    const homeDir = await temporaryRoot();
    const databasePath = path.join(homeDir, 'main.db');
    const db = await openDatabase(databasePath);
    await bootstrapVersionZero(db);
    const ledgerBefore = await (await db.prepare('SELECT * FROM schema_migrations')).all();
    await closeDatabase(db);

    await expect(preflightDbServiceDatabase({ homeDir, databasePath })).resolves.toMatchObject({
      status: 'pending',
      currentVersion: INITIAL_MIGRATION_VERSION,
      appliedMigrations: [{ name: INITIAL_MIGRATION_NAME, version: INITIAL_MIGRATION_VERSION }],
    });

    const reopened = await openDatabase(databasePath);
    expect(await pragma(reopened, 'user_version')).toBe(INITIAL_MIGRATION_VERSION);
    expect(await (await reopened.prepare('SELECT * FROM schema_migrations')).all()).toEqual(ledgerBefore);
    expect((await (await reopened.prepare('PRAGMA table_info(widget_definitions)')).all())
      .some((column) => column.name === 'next_revision_number')).toBe(false);
  });

  test('tolerates unknown home entries without creating or modifying main.db', async () => {
    const homeDir = await temporaryRoot();
    const legacyPath = path.join(homeDir, 'vibecanvas.turso');
    const finderPath = path.join(homeDir, '.DS_Store');
    const updateStatePath = path.join(homeDir, 'autoupdate-state.json');
    await fs.writeFile(legacyPath, 'legacy-bytes');
    await fs.writeFile(finderPath, 'finder-bytes');
    await fs.writeFile(updateStatePath, '{"version":"1"}');

    await expect(preflightDbServiceDatabase({
      homeDir,
      databasePath: path.join(homeDir, 'main.db'),
    })).resolves.toEqual({ status: 'empty' });
    expect(await fs.readFile(legacyPath, 'utf8')).toBe('legacy-bytes');
    expect(await fs.readFile(finderPath, 'utf8')).toBe('finder-bytes');
    expect(await fs.readFile(updateStatePath, 'utf8')).toBe('{"version":"1"}');
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
      currentVersion: DATABASE_SCHEMA_VERSION,
      appliedMigrations: [
        { name: INITIAL_MIGRATION_NAME, version: INITIAL_MIGRATION_VERSION },
        { name: WIDGET_REVISION_SEQUENCE_MIGRATION_NAME, version: WIDGET_REVISION_SEQUENCE_MIGRATION_VERSION },
        { name: FUNCTION_RUNTIME_MIGRATION_NAME, version: FUNCTION_RUNTIME_MIGRATION_VERSION },
        { name: WIDGET_INSTANCE_PROJECTION_MIGRATION_NAME, version: WIDGET_INSTANCE_PROJECTION_MIGRATION_VERSION },
        { name: AGENT_AUTHORING_MIGRATION_NAME, version: AGENT_AUTHORING_MIGRATION_VERSION },
      ],
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
