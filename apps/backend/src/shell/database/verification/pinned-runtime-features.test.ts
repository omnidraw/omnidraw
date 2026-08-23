import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  TURSO_EXPERIMENTAL_FEATURES,
  TURSO_ON_DISK_EXPERIMENTAL_FEATURES,
} from '../DbServiceTurso/DbServiceTurso';
import { Database } from '../DbServiceTurso/turso-native';

const temporaryRoots: string[] = [];
const databases: Database[] = [];

async function openTemporaryDatabase(): Promise<Database> {
  const root = await mkdtemp(path.join(tmpdir(), 'omnidraw-turso-feature-probe-'));
  const database = new Database(path.join(root, 'probe.db'), {
    experimental: [...TURSO_ON_DISK_EXPERIMENTAL_FEATURES],
  });
  temporaryRoots.push(root);
  databases.push(database);
  await database.connect();
  await database.exec('PRAGMA foreign_keys = ON');
  await database.exec('PRAGMA ignore_check_constraints = 0');
  return database;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
  await Promise.all(temporaryRoots.splice(0).map((root) => (
    rm(root, { recursive: true, force: true })
  )));
});

describe('pinned @tursodatabase/database feature set', () => {
  test('keeps one shared production feature authority for memory and on-disk databases', () => {
    expect(TURSO_EXPERIMENTAL_FEATURES).toEqual([
      'custom_types',
      'triggers',
      'index_method',
      'generated_columns',
    ]);
    expect(TURSO_ON_DISK_EXPERIMENTAL_FEATURES).toEqual([
      ...TURSO_EXPERIMENTAL_FEATURES,
      'multiprocess_wal',
    ]);
    expect(new Set(TURSO_ON_DISK_EXPERIMENTAL_FEATURES).size)
      .toBe(TURSO_ON_DISK_EXPERIMENTAL_FEATURES.length);
  });

  test('supports the exact custom types, generated columns, strictness, and indexes used by 000', async () => {
    const database = await openTemporaryDatabase();
    await database.exec(`
      CREATE DOMAIN probe_status AS TEXT CHECK (
        value IN ('ready', 'failed')
      );

      CREATE TABLE probe_parents (
        id TEXT PRIMARY KEY NOT NULL,
        payload_json JSONB NOT NULL,
        status probe_status NOT NULL,
        enabled BOOLEAN NOT NULL,
        created_at_sec TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        kind TEXT GENERATED ALWAYS AS (
          json_extract(payload_json, '$.kind')
        ) VIRTUAL NOT NULL,
        CHECK (json_type(payload_json, '$') = 'object')
      ) STRICT;

      CREATE TABLE probe_children (
        id TEXT PRIMARY KEY NOT NULL,
        parent_id TEXT NOT NULL,
        state_json JSONB NOT NULL,
        FOREIGN KEY (parent_id) REFERENCES probe_parents (id) ON DELETE CASCADE
      ) STRICT;

      CREATE UNIQUE INDEX probe_ready_kind_idx
        ON probe_parents (kind)
        WHERE status = 'ready';
    `);

    await (await database.prepare(`
      INSERT INTO probe_parents (id, payload_json, status, enabled, created_at_sec)
      VALUES (?, ?, 'ready', ?, ?)
    `)).run('parent-a', '{"kind":"weather"}', true, '2026-08-04 12:34:56');
    await (await database.prepare(`
      INSERT INTO probe_children (id, parent_id, state_json)
      VALUES (?, ?, ?)
    `)).run('child-a', 'parent-a', '{"visible":true}');

    expect(await (await database.prepare(`
      SELECT id, kind, status, enabled, created_at_sec
      FROM probe_parents
    `)).get()).toMatchObject({
      id: 'parent-a',
      kind: 'weather',
      status: 'ready',
      enabled: 1,
      created_at_sec: '2026-08-04 12:34:56',
    });
    expect(await (await database.prepare('PRAGMA table_xinfo(probe_parents)')).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'payload_json', type: 'JSONB', hidden: 0, notnull: 1 }),
        expect.objectContaining({ name: 'status', type: 'probe_status', hidden: 0, notnull: 1 }),
        expect.objectContaining({ name: 'enabled', type: 'BOOLEAN', hidden: 0, notnull: 1 }),
        expect.objectContaining({ name: 'created_at_sec', type: 'TIMESTAMP', hidden: 0, notnull: 1 }),
        expect.objectContaining({ name: 'kind', type: 'TEXT', hidden: 2, notnull: 1 }),
      ]),
    );
    expect(await (await database.prepare('PRAGMA table_list')).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'probe_parents', strict: 1 }),
        expect.objectContaining({ name: 'probe_children', strict: 1 }),
      ]),
    );
    expect(await (await database.prepare('PRAGMA index_list(probe_parents)')).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'probe_ready_kind_idx', partial: 1, unique: 1 }),
      ]),
    );
    expect(await (await database.prepare('PRAGMA foreign_key_list(probe_children)')).all()).toEqual([
      expect.objectContaining({ from: 'parent_id', table: 'probe_parents', to: 'id', on_delete: 'CASCADE' }),
    ]);

    await expect((await database.prepare(`
      INSERT INTO probe_parents (id, payload_json, status, enabled)
      VALUES ('bad-domain', '{"kind":"other"}', 'unknown', TRUE)
    `)).run()).rejects.toThrow();
    await expect((await database.prepare(`
      INSERT INTO probe_parents (id, payload_json, status, enabled)
      VALUES ('bad-json', 'not-json', 'failed', TRUE)
    `)).run()).rejects.toThrow();
    await expect((await database.prepare(`
      INSERT INTO probe_parents (id, payload_json, status, enabled)
      VALUES ('bad-bool', '{"kind":"other"}', 'failed', 2)
    `)).run()).rejects.toThrow();
  });
});
