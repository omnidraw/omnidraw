import { afterEach, describe, expect, test } from 'bun:test';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DATABASE_APPLICATION_ID,
  DATABASE_SCHEMA_VERSION,
} from '../CONSTANTS';
import {
  DbServiceTurso,
  preflightDbServiceDatabase,
  TURSO_EXPERIMENTAL_FEATURES,
  TURSO_ON_DISK_EXPERIMENTAL_FEATURES,
} from '../DbServiceTurso/DbServiceTurso';
import { fnSerializeDatabaseSchemaFingerprint } from '../DbServiceTurso/fn.database-schema-fingerprint';
import { Database } from '../DbServiceTurso/turso-native';
import { MIGRATION_FILES } from '../migrations/CONSTANTS';
import { EXPECTED_DATABASE_SCHEMA_CONTRACTS } from '../schema/expected-schema';

const VALID_TIMESTAMP = '2026-08-04 12:34:56';
const LATER_TIMESTAMP = '2026-08-04 12:35:56';
const RESOURCE_ID = 'resource-recovery';
const CANVAS_ID = 'canvas-recovery';
const ELEMENT_ID = 'element-recovery';
const INSTANCE_ID = 'instance-recovery';
const temporaryRoots: string[] = [];
const runningServices: DbServiceTurso[] = [];

type TSnapshotEntry = Readonly<{
  digest?: string;
  kind: 'directory' | 'file' | 'symlink' | 'other';
  link?: string;
  mode: number;
  mtimeMs?: number;
  path: string;
  size?: number;
}>;

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `omnidraw-${label}-`));
  temporaryRoots.push(root);
  return root;
}

async function waitForPath(targetPath: string, timeoutMs = 10_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await lstat(targetPath).then(() => true, () => false)) return;
    await Bun.sleep(10);
  }
  throw new Error(`Timed out waiting for ${targetPath}.`);
}

function serviceFor(home: string): DbServiceTurso {
  const service = new DbServiceTurso({
    databasePath: path.join(home, 'main.db'),
    dataDir: home,
    cacheDir: path.join(home, 'cache'),
    silentMigrations: true,
  });
  runningServices.push(service);
  return service;
}

async function stopService(service: DbServiceTurso): Promise<void> {
  await service.stop();
  const index = runningServices.indexOf(service);
  if (index >= 0) runningServices.splice(index, 1);
}

async function snapshotTree(root: string, includeModificationTimes = true): Promise<readonly TSnapshotEntry[]> {
  const snapshots: TSnapshotEntry[] = [];
  async function visit(target: string): Promise<void> {
    const info = await lstat(target);
    const relativePath = path.relative(root, target) || '.';
    const common = {
      path: relativePath,
      mode: info.mode,
      ...(includeModificationTimes ? { mtimeMs: info.mtimeMs } : {}),
    };
    if (info.isDirectory()) {
      snapshots.push({ ...common, kind: 'directory' });
      const entries = await readdir(target);
      for (const entry of entries.toSorted()) await visit(path.join(target, entry));
      return;
    }
    if (info.isFile()) {
      const bytes = await readFile(target);
      snapshots.push({
        ...common,
        kind: 'file',
        size: info.size,
        digest: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
      });
      return;
    }
    if (info.isSymbolicLink()) {
      snapshots.push({ ...common, kind: 'symlink', link: await readlink(target) });
      return;
    }
    snapshots.push({ ...common, kind: 'other' });
  }
  await visit(root);
  return snapshots;
}

function durableSnapshotEntry(entry: TSnapshotEntry): TSnapshotEntry {
  if (entry.kind !== 'file' || !path.basename(entry.path).endsWith('-tshm')) return entry;
  const { mtimeMs: _coordinationMtime, ...durableEntry } = entry;
  return durableEntry;
}

async function snapshotDurableTree(root: string): Promise<readonly TSnapshotEntry[]> {
  return (await snapshotTree(root)).map(durableSnapshotEntry);
}

async function expectRejectedWithoutDurableMutation(
  root: string,
  operation: () => Promise<unknown>,
  message: RegExp,
): Promise<void> {
  const before = await snapshotDurableTree(root);
  await expect(operation()).rejects.toThrow(message);
  expect(await snapshotDurableTree(root)).toEqual(before);
}

async function migrationSource(): Promise<{
  checksumSha256: string;
  sql: string;
}> {
  const bytes = new Uint8Array(await Bun.file(MIGRATION_FILES[0]!.path).arrayBuffer());
  return {
    checksumSha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
    sql: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  };
}

async function createClaimedManagedDatabase(args: {
  home: string;
  migrationSql: string;
}): Promise<void> {
  await mkdir(args.home, { recursive: true });
  await mkdir(path.join(args.home, 'cache'), { recursive: true });
  await mkdir(path.join(args.home, 'main.db-shm'));
  const database = new Database(path.join(args.home, 'main.db'), {
    experimental: [...TURSO_ON_DISK_EXPERIMENTAL_FEATURES],
  });
  const migration = await migrationSource();
  await database.connect();
  try {
    await database.exec('PRAGMA foreign_keys = ON; PRAGMA ignore_check_constraints = 0;');
    await database.exec(args.migrationSql);
    await (await database.prepare(`
      INSERT INTO schema_migrations (
        version, name, checksum_sha256, application_version
      ) VALUES (0, '000-initial.sql', ?, 'verification')
    `)).run(migration.checksumSha256);
    await database.exec(`
      PRAGMA application_id = ${DATABASE_APPLICATION_ID};
      PRAGMA user_version = ${DATABASE_SCHEMA_VERSION};
    `);
  } finally {
    await database.close();
  }
}

async function schemaFingerprint(database: Database): Promise<string> {
  const [schemaObjects, domains] = await Promise.all([
    (await database.prepare(`
      SELECT type, name, tbl_name AS table_name, sql
      FROM sqlite_schema
      WHERE type IN ('table', 'index', 'view', 'trigger')
        AND name NOT GLOB 'sqlite_*'
      ORDER BY type, name, tbl_name
    `)).all() as Promise<Array<{
      name: string;
      sql: string | null;
      table_name: string;
      type: 'index' | 'table' | 'trigger' | 'view';
    }>>,
    (await database.prepare(`
      SELECT name, sql FROM __turso_internal_types ORDER BY name
    `)).all() as Promise<Array<{ name: string; sql: string }>>,
  ]);
  return new Bun.CryptoHasher('sha256')
    .update(fnSerializeDatabaseSchemaFingerprint([
      ...schemaObjects.map((row) => ({
        name: row.name,
        sql: row.sql,
        tableName: row.table_name,
        type: row.type,
      })),
      ...domains.map((row) => ({
        name: row.name,
        sql: row.sql,
        tableName: '__turso_internal_types',
        type: 'domain' as const,
      })),
    ]))
    .digest('hex');
}

async function representativeRows(database: Database): Promise<Readonly<Record<string, readonly unknown[]>>> {
  const orderBy: Readonly<Record<string, string>> = {
    canvases: 'id',
    canvas_items: 'canvas_id, id',
    widget_instance_states: 'canvas_id, element_id',
    resource_catalog: 'id',
    resource_placements: 'resource_id',
    resource_encryption_keys: 'id',
    db_resource_drafts: 'id',
    db_resource_draft_changes: 'draft_id, sequence',
    db_resource_apply_runs: 'id',
    db_resource_backups: 'id',
    key_values: 'name',
    media_files: 'id',
    chats: 'id',
    schema_migrations: 'version',
  };
  const rows = await Promise.all(Object.entries(orderBy).map(async ([table, order]) => (
    [table, await (await database.prepare(`SELECT * FROM ${table} ORDER BY ${order}`)).all()] as const
  )));
  return Object.freeze(Object.fromEntries(rows));
}

async function seedEveryRetainedArea(database: Database): Promise<void> {
  const widgetItem = JSON.stringify({
    id: ELEMENT_ID,
    kind: 'rect',
    parentId: null,
    orderKey: 'a',
    extensions: {
      'omnidraw:widget': {
        type: 'widget-instance',
        instanceId: INSTANCE_ID,
        widgetKey: 'recovery-widget',
      },
    },
  });
  await (await database.prepare(`
    INSERT INTO canvases (id, name) VALUES (?, 'Recovery canvas')
  `)).run(CANVAS_ID);
  await (await database.prepare(`
    INSERT INTO canvas_items (canvas_id, id, item_json)
    VALUES (?, ?, ?)
  `)).run(CANVAS_ID, ELEMENT_ID, widgetItem);
  await (await database.prepare(`
    INSERT INTO widget_instance_states (
      canvas_id, element_id, instance_id, state_json
    ) VALUES (?, ?, ?, '{"count":7}')
  `)).run(CANVAS_ID, ELEMENT_ID, INSTANCE_ID);
  await (await database.prepare(`
    INSERT INTO resource_catalog (id, kind, name, status)
    VALUES (?, 'db', 'Recovery resource', 'ready')
  `)).run(RESOURCE_ID);
  await (await database.prepare(`
    INSERT INTO resource_placements (
      resource_id, cell_id, placement_epoch, relative_path, status
    ) VALUES (?, 'local', 1, ?, 'active')
  `)).run(RESOURCE_ID, `${RESOURCE_ID}/data.db`);
  await (await database.prepare(`
    INSERT INTO resource_encryption_keys (
      id, resource_id, purpose, algorithm, key_material
    ) VALUES ('recovery-key', ?, 'resource-data', 'aegis-256', ?)
  `)).run(RESOURCE_ID, new Uint8Array(32).fill(7));
  await (await database.prepare(`
    INSERT INTO db_resource_drafts (
      id, resource_id, name, status, created_at_sec, updated_at_sec, applied_at_sec
    ) VALUES ('recovery-draft', ?, 'Recovery draft', 'applied', ?, ?, ?)
  `)).run(RESOURCE_ID, VALID_TIMESTAMP, LATER_TIMESTAMP, LATER_TIMESTAMP);
  await (await database.prepare(`
    INSERT INTO db_resource_draft_changes (
      draft_id, sequence, kind, operation_json, sql_text, created_at_sec
    ) VALUES ('recovery-draft', 1, 'sql', NULL, 'SELECT 1', ?)
  `)).run(VALID_TIMESTAMP);
  await (await database.prepare(`
    INSERT INTO db_resource_apply_runs (
      id, resource_id, draft_id, status, backup_retained,
      created_at_sec, completed_at_sec
    ) VALUES ('recovery-apply', ?, 'recovery-draft', 'succeeded', TRUE, ?, ?)
  `)).run(RESOURCE_ID, VALID_TIMESTAMP, LATER_TIMESTAMP);
  await (await database.prepare(`
    INSERT INTO db_resource_backups (
      id, resource_id, apply_run_id, relative_path, digest_sha256,
      byte_size, state, created_at_sec, verified_at_sec, delete_after_sec
    ) VALUES ('recovery-backup', ?, 'recovery-apply', ?, ?, 4,
      'retained', ?, ?, ?)
  `)).run(
    RESOURCE_ID,
    `${RESOURCE_ID}/backups/recovery.db`,
    'a'.repeat(64),
    VALID_TIMESTAMP,
    LATER_TIMESTAMP,
    LATER_TIMESTAMP,
  );
  await (await database.prepare(`
    INSERT INTO key_values (name, kind, json_value)
    VALUES ('recovery-settings', 'json', '{"restored":true}')
  `)).run();
  await (await database.prepare(`
    INSERT INTO media_files (
      id, canvas_id, source_hash, digest_sha256, mime_type, byte_size, data
    ) VALUES ('recovery-media', ?, 'recovery-source', ?, 'text/plain', 4, ?)
  `)).run(CANVAS_ID, 'b'.repeat(64), new TextEncoder().encode('data'));
  await (await database.prepare(`
    INSERT INTO chats (
      id, canvas_id, name, status, workspace_relative_path, history_relative_path
    ) VALUES ('recovery-chat', ?, 'Recovery chat', 'archived',
      'agent/workspaces/recovery', 'agent/history/recovery.jsonl')
  `)).run(CANVAS_ID);
}

async function createDirectResource(home: string): Promise<string> {
  const resourceDirectory = path.join(home, 'resources', RESOURCE_ID);
  await mkdir(resourceDirectory, { recursive: true });
  const databasePath = path.join(resourceDirectory, 'data.db');
  const database = new Database(databasePath, {
    experimental: [...TURSO_EXPERIMENTAL_FEATURES],
  });
  await database.connect();
  try {
    await database.exec(`
      CREATE TABLE notes (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL
      ) STRICT;
    `);
    await (await database.prepare(`
      INSERT INTO notes (id, title) VALUES (1, 'preserved')
    `)).run();
  } finally {
    await database.close();
  }
  return databasePath;
}

afterEach(async () => {
  await Promise.all(runningServices.splice(0).map((service) => service.stop().catch(() => undefined)));
  await Promise.all(temporaryRoots.splice(0).map((root) => (
    rm(root, { recursive: true, force: true })
  )));
});

describe('single-user managed database preflight and recovery', () => {
  test('durable snapshots ignore only Turso coordination mtime drift and detect database and sidecar byte changes', async () => {
    const root = await temporaryRoot('durable-snapshot');
    const files = [
      { name: 'main.db', initial: 'database-before', changed: 'database-after-' },
      { name: 'main.db-wal', initial: 'wal-before', changed: 'wal-after-' },
      { name: 'main.db-tshm', initial: 'tshm-before', changed: 'tshm-after-' },
    ] as const;
    await Promise.all(files.map((file) => writeFile(path.join(root, file.name), file.initial)));

    const beforeCoordinationTouch = await snapshotDurableTree(root);
    const coordinationPath = path.join(root, 'main.db-tshm');
    const coordinationStat = await lstat(coordinationPath);
    await utimes(
      coordinationPath,
      coordinationStat.atime,
      new Date(coordinationStat.mtimeMs + 60_000),
    );
    expect(await snapshotDurableTree(root)).toEqual(beforeCoordinationTouch);

    for (const fileName of ['main.db', 'main.db-wal']) {
      const beforeMtimeChange = await snapshotDurableTree(root);
      const filePath = path.join(root, fileName);
      const fileStat = await lstat(filePath);
      await utimes(filePath, fileStat.atime, new Date(fileStat.mtimeMs + 60_000));
      expect(await snapshotDurableTree(root)).not.toEqual(beforeMtimeChange);
    }

    for (const file of files) {
      const beforeByteChange = await snapshotDurableTree(root);
      await writeFile(path.join(root, file.name), file.changed);
      const afterByteChange = await snapshotDurableTree(root);
      expect(afterByteChange).not.toEqual(beforeByteChange);
      expect(afterByteChange.find((entry) => entry.path === file.name)?.digest)
        .not.toBe(beforeByteChange.find((entry) => entry.path === file.name)?.digest);
    }
  });

  test('starts a fresh home with exactly one baseline and directly preflights the resulting database', async () => {
    const root = await temporaryRoot('fresh-baseline');
    const home = path.join(root, 'home');
    await mkdir(path.join(home, 'cache'), { recursive: true });
    const databasePath = path.join(home, 'main.db');
    expect(await preflightDbServiceDatabase({ databasePath, homeDir: home })).toEqual({ status: 'empty' });

    const service = serviceFor(home);
    await service.start();
    expect(await (await service.db.prepare(`
      SELECT version, name FROM schema_migrations ORDER BY version
    `)).all()).toEqual([expect.objectContaining({ version: 0, name: '000-initial.sql' })]);
    await stopService(service);

    expect(await preflightDbServiceDatabase({ databasePath, homeDir: home })).toMatchObject({
      status: 'ready',
      currentVersion: 0,
      appliedMigrations: [expect.objectContaining({ version: 0, name: '000-initial.sql' })],
    });
  });

  test('rejects an old or unknown schema fingerprint without durable DB or sidecar mutation', async () => {
    const root = await temporaryRoot('old-fingerprint');
    const home = path.join(root, 'home');
    await mkdir(path.join(home, 'cache'), { recursive: true });
    const databasePath = path.join(home, 'main.db');
    const source = serviceFor(home);
    await source.start();
    await source.db.exec(`ALTER TABLE canvases ADD COLUMN unexpected_legacy_value TEXT;`);
    await stopService(source);

    await expectRejectedWithoutDurableMutation(
      home,
      () => preflightDbServiceDatabase({ databasePath, homeDir: home }),
      /Refusing to open Omnidraw database:.*whole-schema SHA-256 fingerprint differs.*explicit development database reset/s,
    );
    const rejectedService = serviceFor(home);
    await expectRejectedWithoutDurableMutation(
      home,
      () => rejectedService.start(),
      /Refusing to open Omnidraw database:.*whole-schema SHA-256 fingerprint differs.*explicit development database reset/s,
    );
    await stopService(rejectedService);
    expect(await lstat(path.join(home, 'cache', 'database-recovery')).then(
      () => true,
      () => false,
    )).toBe(false);

    const corruptCoordinator = Buffer.from('corrupt-coordinator-for-rollback');
    await writeFile(`${databasePath}-tshm`, corruptCoordinator);
    await expectRejectedWithoutDurableMutation(
      home,
      () => preflightDbServiceDatabase({ databasePath, homeDir: home }),
      /read-only preflight failed:.*shared WAL coordination file/s,
    );
    expect(await readFile(`${databasePath}-tshm`)).toEqual(corruptCoordinator);
    expect((await readdir(home)).some((entry) => entry.includes('healing-claim'))).toBe(false);
    expect(await lstat(path.join(home, 'cache', 'database-recovery')).then(
      () => true,
      () => false,
    )).toBe(false);
  });

  test('rejects a weakened custom domain even when the migration ledger claims the current immutable bytes', async () => {
    const root = await temporaryRoot('weakened-domain');
    const home = path.join(root, 'home');
    const migration = await migrationSource();
    const weakenedSql = migration.sql.replace(
      /CREATE DOMAIN sha256_hex AS TEXT CHECK \([\s\S]*?\n\);/,
      'CREATE DOMAIN sha256_hex AS TEXT CHECK (length(value) > 0);',
    );
    expect(weakenedSql).not.toBe(migration.sql);
    await createClaimedManagedDatabase({ home, migrationSql: weakenedSql });

    await expectRejectedWithoutDurableMutation(
      home,
      () => preflightDbServiceDatabase({ databasePath: path.join(home, 'main.db'), homeDir: home }),
      /Refusing to open Omnidraw database:.*custom domain definitions differ.*explicit development database reset/s,
    );
  });

  test('rejects legacy roots, orphan coordinators, and wrong-type or symlink entries without mutation', async () => {
    const root = await temporaryRoot('layout-refusal');
    const cases: Array<{
      label: string;
      arrange: (home: string) => Promise<void>;
      message: RegExp;
    }> = [
      {
        label: 'legacy-organizations',
        arrange: (home) => mkdir(path.join(home, 'organizations')),
        message: /legacy organizations entry.*explicit development cleanup/s,
      },
      {
        label: 'legacy-migrations',
        arrange: (home) => mkdir(path.join(home, 'database-migrations')),
        message: /legacy database-migrations entry.*explicit development cleanup/s,
      },
      {
        label: 'orphan-wal',
        arrange: async (home) => {
          await writeFile(path.join(home, 'main.db'), '');
          await writeFile(path.join(home, 'main.db-wal'), 'orphan');
        },
        message: /orphan database coordinator 'main\.db-wal'/,
      },
      {
        label: 'orphan-tshm',
        arrange: async (home) => {
          await writeFile(path.join(home, 'main.db'), '');
          await writeFile(path.join(home, 'main.db-tshm'), 'orphan');
        },
        message: /orphan database coordinator 'main\.db-tshm'/,
      },
      {
        label: 'orphan-shm',
        arrange: async (home) => {
          await writeFile(path.join(home, 'main.db'), '');
          await mkdir(path.join(home, 'main.db-shm'));
        },
        message: /orphan database coordinator 'main\.db-shm'/,
      },
      {
        label: 'managed-file',
        arrange: (home) => writeFile(path.join(home, 'widgets'), 'not a directory'),
        message: /non-directory managed entry 'widgets'/,
      },
      {
        label: 'managed-symlink',
        arrange: async (home) => {
          await mkdir(path.join(home, 'target'));
          await symlink(path.join(home, 'target'), path.join(home, 'resources'));
        },
        message: /non-directory managed entry 'resources'/,
      },
      {
        label: 'database-directory',
        arrange: (home) => mkdir(path.join(home, 'main.db')),
        message: /database path because it is not a regular file|non-file database entry/,
      },
      {
        label: 'database-symlink',
        arrange: async (home) => {
          await writeFile(path.join(home, 'target.db'), '');
          await symlink(path.join(home, 'target.db'), path.join(home, 'main.db'));
        },
        message: /database path because it is not a regular file|non-file database entry/,
      },
    ];

    for (const entry of cases) {
      const home = path.join(root, entry.label);
      await mkdir(home);
      await entry.arrange(home);
      await expectRejectedWithoutDurableMutation(
        home,
        () => preflightDbServiceDatabase({ databasePath: path.join(home, 'main.db'), homeDir: home }),
        entry.message,
      );
    }
  });

  test('refuses a tiny corrupt coordinator for a current valid schema without claiming or quarantining it', async () => {
    const root = await temporaryRoot('corrupt-coordinator-refusal');
    const home = path.join(root, 'home');
    await mkdir(path.join(home, 'cache'), { recursive: true });
    const databasePath = path.join(home, 'main.db');
    const service = serviceFor(home);
    await service.start();
    await stopService(service);

    const corruptCoordinator = Buffer.from('tiny-corrupt-coordinator');
    await writeFile(`${databasePath}-tshm`, corruptCoordinator);
    await expectRejectedWithoutDurableMutation(
      home,
      () => preflightDbServiceDatabase({ databasePath, homeDir: home }),
      /read-only preflight failed:.*shared WAL coordination file/s,
    );
    expect(await readFile(`${databasePath}-tshm`)).toEqual(corruptCoordinator);
    expect((await readdir(home)).some((entry) => entry.includes('healing-claim'))).toBe(false);
    expect(await lstat(path.join(home, 'cache', 'database-recovery')).then(
      () => true,
      () => false,
    )).toBe(false);
  });

  test('accepts and reopens a valid full-size coordinator left by a killed owner without mutating the database', async () => {
    const root = await temporaryRoot('coordinator-recovery');
    const home = path.join(root, 'home');
    await mkdir(path.join(home, 'cache'), { recursive: true });
    const databasePath = path.join(home, 'main.db');
    const service = serviceFor(home);
    await service.start();
    await (await service.db.prepare(`
      INSERT INTO canvases (id, name) VALUES ('coordinator-canvas', 'Coordinator canvas')
    `)).run();
    await stopService(service);

    const readyPath = path.join(root, 'holder.ready');
    const fixturePath = path.join(import.meta.dir, 'fixtures', 'multiprocess-wal-holder.ts');
    const bunExecutable = Bun.which('bun') ?? process.execPath;
    const holder = Bun.spawn([bunExecutable, fixturePath, databasePath, readyPath], {
      cwd: path.resolve(import.meta.dir, '../../../..'),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    try {
      await waitForPath(readyPath);
    } finally {
      holder.kill(9);
      await holder.exited;
    }

    const staleCoordinator = `${databasePath}-tshm`;
    const staleCoordinatorBytes = await readFile(staleCoordinator);
    expect(staleCoordinatorBytes.byteLength).toBeGreaterThanOrEqual(4096);
    const databaseBefore = new Bun.CryptoHasher('sha256')
      .update(await readFile(databasePath))
      .digest('hex');

    const preflight = await preflightDbServiceDatabase({ databasePath, homeDir: home });
    expect(preflight).toMatchObject({ status: 'ready', currentVersion: 0 });
    expect(await readFile(staleCoordinator)).toEqual(staleCoordinatorBytes);
    expect(await lstat(path.join(home, 'cache', 'database-recovery')).then(
      () => true,
      () => false,
    )).toBe(false);
    expect(new Bun.CryptoHasher('sha256').update(await readFile(databasePath)).digest('hex'))
      .toBe(databaseBefore);

    const reopened = serviceFor(home);
    await reopened.start();
    expect(await (await reopened.db.prepare(`
      SELECT id, name FROM canvases WHERE id = 'coordinator-canvas'
    `)).get()).toMatchObject({ id: 'coordinator-canvas', name: 'Coordinator canvas' });
    await stopService(reopened);
  });

  test('whole-home copy and reopen preserve every retained table and a direct-home resource database', async () => {
    const root = await temporaryRoot('whole-home-recovery');
    const home = path.join(root, 'home');
    const backup = path.join(root, 'backup');
    const restored = path.join(root, 'restored');
    await mkdir(path.join(home, 'cache'), { recursive: true });
    const service = serviceFor(home);
    await service.start();
    await seedEveryRetainedArea(service.db);
    await createDirectResource(home);

    const expectedRows = await representativeRows(service.db);
    expect(Object.keys(expectedRows)).toHaveLength(14);
    expect(Object.values(expectedRows).every((rows) => rows.length > 0)).toBe(true);
    const expectedFingerprint = await schemaFingerprint(service.db);
    expect(expectedFingerprint).toBe(EXPECTED_DATABASE_SCHEMA_CONTRACTS[0]!.fingerprintSha256);
    await stopService(service);

    await cp(home, backup, { recursive: true, errorOnExist: true });
    await cp(backup, restored, { recursive: true, errorOnExist: true });
    expect(await snapshotTree(backup, false)).toEqual(await snapshotTree(home, false));
    expect(await snapshotTree(restored, false)).toEqual(await snapshotTree(home, false));
    expect(await lstat(path.join(restored, 'organizations')).then(() => true, () => false)).toBe(false);
    expect(await lstat(path.join(restored, 'resources', RESOURCE_ID, 'data.db')).then(
      (value) => value.isFile(),
      () => false,
    )).toBe(true);

    const restoredService = serviceFor(restored);
    await restoredService.start();
    expect(await schemaFingerprint(restoredService.db)).toBe(expectedFingerprint);
    expect(await representativeRows(restoredService.db)).toEqual(expectedRows);
    expect(await (await restoredService.db.prepare('PRAGMA integrity_check')).all())
      .toEqual([expect.objectContaining({ integrity_check: 'ok' })]);
    expect(await (await restoredService.db.prepare('PRAGMA foreign_key_check')).all()).toEqual([]);
    await stopService(restoredService);

    const resource = new Database(path.join(restored, 'resources', RESOURCE_ID, 'data.db'), {
      readonly: true,
      fileMustExist: true,
      experimental: [...TURSO_EXPERIMENTAL_FEATURES],
    });
    await resource.connect();
    try {
      expect(await (await resource.prepare('SELECT id, title FROM notes')).all()).toEqual([
        expect.objectContaining({ id: 1, title: 'preserved' }),
      ]);
      expect(await (await resource.prepare('PRAGMA integrity_check')).all())
        .toEqual([expect.objectContaining({ integrity_check: 'ok' })]);
    } finally {
      await resource.close();
    }
  });
});
