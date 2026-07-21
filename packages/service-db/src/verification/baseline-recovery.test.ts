import { afterEach, describe, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DATABASE_APPLICATION_ID,
  DATABASE_SCHEMA_VERSION,
  DEFAULT_OSS_CELL_ID,
  DEFAULT_OSS_ORGANIZATION_ID,
} from '../CONSTANTS';
import { DbServiceTurso } from '../DbServiceTurso/DbServiceTurso';
import { Database } from '../DbServiceTurso/turso-native';

const RESOURCE_ID = '00000000-0000-4000-8000-000000000070';
const KEY_ID = '00000000-0000-4000-8000-000000000071';
const temporaryRoots: string[] = [];

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `vibecanvas-${label}-`));
  temporaryRoots.push(root);
  return root;
}

async function waitForPath(targetPath: string, timeoutMs = 10_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await stat(targetPath).then(() => true).catch(() => false)) return;
    await Bun.sleep(10);
  }
  throw new Error(`Timed out waiting for ${targetPath}.`);
}

async function openNative(databasePath: string, readonly = false): Promise<Database> {
  const database = new Database(databasePath, {
    readonly,
    fileMustExist: readonly,
    // @ts-expect-error pinned native features are ahead of the public union.
    experimental: ['custom_types', 'triggers', 'index_method', 'multiprocess_wal'],
  });
  await database.connect();
  return database;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('managed baseline recovery', () => {
  test('WAL recovery retains committed rows and rolls back a killed in-flight writer', async () => {
    const root = await temporaryRoot('wal-recovery');
    const databasePath = path.join(root, 'writer.db');
    const readyPath = path.join(root, 'uncommitted.ready');
    const fixturePath = path.join(import.meta.dir, 'fixtures', 'wal-interrupted-writer.ts');
    const bunExecutable = Bun.which('bun') ?? process.execPath;
    const writer = Bun.spawn([bunExecutable, fixturePath, databasePath, readyPath], {
      cwd: path.resolve(import.meta.dir, '../../../..'),
      stdout: 'pipe',
      stderr: 'pipe',
    });

    try {
      await waitForPath(readyPath);
    } finally {
      writer.kill(9);
      await writer.exited;
    }

    const recovered = await openNative(databasePath);
    try {
      expect(await (await recovered.prepare('PRAGMA integrity_check')).get()).toEqual({ integrity_check: 'ok' });
      expect(await (await recovered.prepare('SELECT id, value FROM recovery_rows ORDER BY id')).all()).toEqual([
        { id: 1, value: 'committed' },
      ]);
    } finally {
      await recovered.close();
    }
  });

  test('backup and restore preserve main schema, ledger, catalog, encryption reference, and resource data', async () => {
    const root = await temporaryRoot('backup-restore');
    const home = path.join(root, 'home');
    const backup = path.join(root, 'backup');
    const restored = path.join(root, 'restored');
    await mkdir(home, { recursive: true });

    const service = new DbServiceTurso({
      databasePath: path.join(home, 'main.db'),
      dataDir: home,
      cacheDir: path.join(home, 'cache'),
      silentMigrations: true,
    });
    await service.start();
    const relativeResourcePath = `${RESOURCE_ID}/data.db`;
    await (await service.db.prepare(`
      INSERT INTO resource_catalog (
        org_id, id, kind, name, status, last_error_json, created_at_ms, updated_at_ms
      ) VALUES (?, ?, 'db', 'Recovery database', 'ready', NULL, 1, 1)
    `)).run(DEFAULT_OSS_ORGANIZATION_ID, RESOURCE_ID);
    await (await service.db.prepare(`
      INSERT INTO resource_placements (
        org_id, resource_id, cell_id, placement_epoch, relative_path, status, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, 1, ?, 'active', 1, 1)
    `)).run(DEFAULT_OSS_ORGANIZATION_ID, RESOURCE_ID, DEFAULT_OSS_CELL_ID, relativeResourcePath);
    await (await service.db.prepare(`
      INSERT INTO resource_encryption_keys (
        org_id, id, resource_id, purpose, algorithm, key_material, created_at_ms
      ) VALUES (?, ?, ?, 'resource-data', 'aegis-256', ?, 1)
    `)).run(DEFAULT_OSS_ORGANIZATION_ID, KEY_ID, RESOURCE_ID, new Uint8Array(32).fill(7));
    await service.stop();

    const resourceDirectory = path.join(
      home,
      'organizations',
      DEFAULT_OSS_ORGANIZATION_ID,
      'resources',
      RESOURCE_ID,
    );
    await mkdir(resourceDirectory, { recursive: true });
    const resource = await openNative(path.join(resourceDirectory, 'data.db'));
    try {
      await resource.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT NOT NULL) STRICT;');
      await (await resource.prepare("INSERT INTO notes (id, title) VALUES (1, 'preserved')")).run();
    } finally {
      await resource.close();
    }

    await cp(home, backup, { recursive: true, errorOnExist: true });
    await cp(backup, restored, { recursive: true, errorOnExist: true });

    const restoredService = new DbServiceTurso({
      databasePath: path.join(restored, 'main.db'),
      dataDir: restored,
      cacheDir: path.join(restored, 'cache'),
      silentMigrations: true,
    });
    await restoredService.start();
    try {
      expect(await (await restoredService.db.prepare('PRAGMA application_id')).get()).toEqual({
        application_id: DATABASE_APPLICATION_ID,
      });
      expect(await (await restoredService.db.prepare('PRAGMA user_version')).get()).toEqual({
        user_version: DATABASE_SCHEMA_VERSION,
      });
      expect(await (await restoredService.db.prepare('SELECT count(*) AS count FROM schema_migrations')).get())
        .toEqual({ count: 1 });
      expect(await (await restoredService.db.prepare(`
        SELECT relative_path FROM resource_placements WHERE org_id = ? AND resource_id = ?
      `)).get(DEFAULT_OSS_ORGANIZATION_ID, RESOURCE_ID)).toEqual({ relative_path: relativeResourcePath });
      expect(await (await restoredService.db.prepare(`
        SELECT length(key_material) AS key_bytes FROM resource_encryption_keys
        WHERE org_id = ? AND resource_id = ?
      `)).get(DEFAULT_OSS_ORGANIZATION_ID, RESOURCE_ID)).toEqual({ key_bytes: 32 });
    } finally {
      await restoredService.stop();
    }

    const restoredResource = await openNative(path.join(
      restored,
      'organizations',
      DEFAULT_OSS_ORGANIZATION_ID,
      'resources',
      RESOURCE_ID,
      'data.db',
    ), true);
    try {
      expect(await (await restoredResource.prepare('PRAGMA integrity_check')).get()).toEqual({ integrity_check: 'ok' });
      expect(await (await restoredResource.prepare('SELECT id, title FROM notes')).all()).toEqual([
        { id: 1, title: 'preserved' },
      ]);
    } finally {
      await restoredResource.close();
    }
  });
});
