import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ChatStoreTurso } from '../ChatStoreTurso';
import { TURSO_ON_DISK_EXPERIMENTAL_FEATURES } from '../DbServiceTurso/DbServiceTurso';
import { Database } from '../DbServiceTurso/turso-native';
import { MIGRATION_FILES } from '../migrations/CONSTANTS';

const CANVAS_A = 'canvas-a';
const CANVAS_B = 'canvas-b';
const ELEMENT_A = 'element-a';
const ELEMENT_B = 'element-b';
const RESOURCE_A = 'resource-a';
const RESOURCE_B = 'resource-b';
const DRAFT_A = 'draft-a';
const DRAFT_B = 'draft-b';
const APPLY_A = 'apply-a';
const APPLY_B = 'apply-b';
const VALID_TIMESTAMP = '2026-08-04 12:34:56';
const LATER_TIMESTAMP = '2026-08-04 12:35:56';
const temporaryRoots: string[] = [];
const databases: Database[] = [];

const digest = (character: string): string => character.repeat(64);

async function openBaseline(): Promise<Database> {
  const root = await mkdtemp(path.join(tmpdir(), 'omnidraw-baseline-constraints-'));
  temporaryRoots.push(root);
  const database = new Database(path.join(root, 'main.db'), {
    experimental: [...TURSO_ON_DISK_EXPERIMENTAL_FEATURES],
  });
  databases.push(database);
  await database.connect();
  await database.exec('PRAGMA foreign_keys = ON');
  await database.exec('PRAGMA ignore_check_constraints = 0');
  await database.exec(await Bun.file(MIGRATION_FILES[0]!.path).text());
  return database;
}

async function run(database: Database, sql: string, ...values: unknown[]): Promise<unknown> {
  return (await database.prepare(sql)).run(...values);
}

async function rejected(action: Promise<unknown>): Promise<void> {
  await expect(action).rejects.toThrow();
}

async function seedCanvas(database: Database, id = CANVAS_A, name = 'Primary canvas'): Promise<void> {
  await run(database, 'INSERT INTO canvases (id, name) VALUES (?, ?)', id, name);
}

function canvasItem(args: {
  id: string;
  instanceId?: string;
  widgetKey?: string;
  parentId?: string | null;
  orderKey?: string;
}): string {
  const item: Record<string, unknown> = {
    id: args.id,
    kind: 'rect',
    parentId: args.parentId === undefined ? null : args.parentId,
    orderKey: args.orderKey ?? 'a',
  };
  if (args.instanceId !== undefined || args.widgetKey !== undefined) {
    item.extensions = {
      'omnidraw:widget': {
        type: 'widget-instance',
        instanceId: args.instanceId,
        widgetKey: args.widgetKey,
      },
    };
  }
  return JSON.stringify(item);
}

async function insertCanvasItem(
  database: Database,
  canvasId: string,
  id: string,
  itemJson: string,
): Promise<unknown> {
  return run(
    database,
    'INSERT INTO canvas_items (canvas_id, id, item_json) VALUES (?, ?, ?)',
    canvasId,
    id,
    itemJson,
  );
}

async function seedResource(database: Database, id = RESOURCE_A, name = 'Primary database'): Promise<void> {
  await run(
    database,
    `INSERT INTO resource_catalog (id, kind, name, status)
     VALUES (?, 'db', ?, 'ready')`,
    id,
    name,
  );
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
  await Promise.all(temporaryRoots.splice(0).map((root) => (
    rm(root, { recursive: true, force: true })
  )));
});

describe('single-user baseline constraints', () => {
  test('stores UTC whole-second TIMESTAMP values and rejects fractions, invalid calendars, hours, and JavaScript millisecond integers', async () => {
    const database = await openBaseline();
    await seedCanvas(database);
    const defaults = await (await database.prepare(`
      SELECT created_at_sec, updated_at_sec FROM canvases WHERE id = ?
    `)).get(CANVAS_A) as { created_at_sec: unknown; updated_at_sec: unknown };
    expect(defaults.created_at_sec).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(defaults.updated_at_sec).toBe(defaults.created_at_sec);

    const insert = (id: string, name: string, value: unknown) => run(
      database,
      `INSERT INTO canvases (id, name, created_at_sec, updated_at_sec)
       VALUES (?, ?, ?, ?)`,
      id,
      name,
      value,
      value,
    );
    await insert('valid-time', 'Valid time', VALID_TIMESTAMP);
    await insert('pre-epoch-time', 'Pre-epoch time', '1969-12-31 23:59:59');
    await rejected(insert('fractional-time', 'Fractional time', '2026-08-04 12:34:56.123'));
    await rejected(insert('non-leap-time', 'Non-leap time', '2026-02-29 12:34:56'));
    await rejected(insert('calendar-time', 'Calendar time', '2026-02-30 12:34:56'));
    await rejected(insert('hour-time', 'Hour time', '2026-08-04 25:34:56'));
    await rejected(insert('zero-time', 'Zero time', 0));
    await rejected(insert('integer-time', 'Integer time', Date.now()));

    await seedResource(database);
    await run(
      database,
      `INSERT INTO db_resource_apply_runs (
        id, resource_id, status, backup_retained, created_at_sec, completed_at_sec
      ) VALUES (?, ?, 'preparing', FALSE, ?, NULL)`,
      APPLY_A,
      RESOURCE_A,
      VALID_TIMESTAMP,
    );
    await rejected(run(
      database,
      `UPDATE db_resource_apply_runs
       SET status = 'succeeded', completed_at_sec = '2026-08-04 12:34:56.001'
       WHERE id = ?`,
      APPLY_A,
    ));
    expect(await (await database.prepare(`
      SELECT status, completed_at_sec FROM db_resource_apply_runs WHERE id = ?
    `)).get(APPLY_A)).toMatchObject({ status: 'preparing', completed_at_sec: null });
  });

  test('enforces JSONB, BOOLEAN, typed key-value exclusivity, and object error documents', async () => {
    const database = await openBaseline();
    await run(
      database,
      `INSERT INTO key_values (name, kind, bool_value)
       VALUES ('feature-enabled', 'bool', TRUE)`,
    );
    await run(
      database,
      `INSERT INTO key_values (name, kind, json_value)
       VALUES ('preferences', 'json', ?)`,
      '{"theme":"dark"}',
    );
    expect(await (await database.prepare(`
      SELECT name, kind, bool_value, json_value FROM key_values ORDER BY name
    `)).all()).toEqual([
      expect.objectContaining({ name: 'feature-enabled', kind: 'bool', bool_value: 1, json_value: null }),
      expect.objectContaining({ name: 'preferences', kind: 'json', bool_value: null, json_value: '{"theme":"dark"}' }),
    ]);

    await rejected(run(
      database,
      `INSERT INTO key_values (name, kind, bool_value)
       VALUES ('bad-bool', 'bool', 2)`,
    ));
    await rejected(run(
      database,
      `INSERT INTO key_values (name, kind, json_value)
       VALUES ('bad-json', 'json', 'not-json')`,
    ));
    await rejected(run(
      database,
      `INSERT INTO key_values (name, kind, text_value, json_value)
       VALUES ('two-values', 'text', 'text', '{}')`,
    ));
    await rejected(run(
      database,
      `INSERT INTO resource_catalog (id, kind, name, status, last_error_json)
       VALUES ('bad-error', 'db', 'Bad error', 'error', '[]')`,
    ));
    await run(
      database,
      `INSERT INTO resource_catalog (id, kind, name, status, last_error_json)
       VALUES ('good-error', 'db', 'Good error', 'error', '{"message":"offline"}')`,
    );
  });

  test('derives widget lookup identity from JSONB and enforces composite state ownership, uniqueness, and cascade', async () => {
    const database = await openBaseline();
    await seedCanvas(database, CANVAS_A, 'Canvas A');
    await seedCanvas(database, CANVAS_B, 'Canvas B');
    await insertCanvasItem(
      database,
      CANVAS_A,
      ELEMENT_A,
      canvasItem({ id: ELEMENT_A, instanceId: 'instance-a', widgetKey: 'weather-card' }),
    );
    expect(await (await database.prepare(`
      SELECT kind, parent_id, order_key, widget_instance_id, widget_key
      FROM canvas_items WHERE canvas_id = ? AND id = ?
    `)).get(CANVAS_A, ELEMENT_A)).toMatchObject({
      kind: 'rect',
      parent_id: null,
      order_key: 'a',
      widget_instance_id: 'instance-a',
      widget_key: 'weather-card',
    });

    await rejected(insertCanvasItem(
      database,
      CANVAS_A,
      'row-id',
      canvasItem({ id: 'different-json-id' }),
    ));
    await rejected(insertCanvasItem(
      database,
      CANVAS_A,
      'missing-parent',
      JSON.stringify({ id: 'missing-parent', kind: 'rect', orderKey: 'a' }),
    ));
    await rejected(insertCanvasItem(
      database,
      CANVAS_A,
      'bad-key',
      canvasItem({ id: 'bad-key', instanceId: 'instance-bad', widgetKey: 'Bad--Key' }),
    ));
    await rejected(insertCanvasItem(
      database,
      CANVAS_B,
      ELEMENT_B,
      canvasItem({ id: ELEMENT_B, instanceId: 'instance-a', widgetKey: 'other-widget' }),
    ));

    await run(
      database,
      `INSERT INTO widget_instance_states (
        canvas_id, element_id, instance_id, version, state_json
      ) VALUES (?, ?, ?, 1, ?)`,
      CANVAS_A,
      ELEMENT_A,
      'instance-a',
      '{"count":1}',
    );
    await rejected(run(
      database,
      `INSERT INTO widget_instance_states (
        canvas_id, element_id, instance_id, version, state_json
      ) VALUES (?, 'missing-element', 'missing-instance', 1, '{}')`,
      CANVAS_A,
    ));
    await insertCanvasItem(database, CANVAS_B, ELEMENT_B, canvasItem({ id: ELEMENT_B }));
    await rejected(run(
      database,
      `INSERT INTO widget_instance_states (
        canvas_id, element_id, instance_id, version, state_json
      ) VALUES (?, ?, 'instance-a', 1, '{}')`,
      CANVAS_B,
      ELEMENT_B,
    ));
    await rejected(run(
      database,
      `UPDATE widget_instance_states SET version = 0
       WHERE canvas_id = ? AND element_id = ?`,
      CANVAS_A,
      ELEMENT_A,
    ));
    await rejected(run(
      database,
      `UPDATE widget_instance_states SET state_json = 'not-json'
       WHERE canvas_id = ? AND element_id = ?`,
      CANVAS_A,
      ELEMENT_A,
    ));

    await run(database, 'DELETE FROM canvas_items WHERE canvas_id = ? AND id = ?', CANVAS_A, ELEMENT_A);
    expect(await (await database.prepare(`
      SELECT count(*) AS count FROM widget_instance_states
    `)).get()).toEqual({ count: 0 });
  });

  test('enforces media bytes, digests, MIME values, optional canvas ownership, and cascade', async () => {
    const database = await openBaseline();
    await seedCanvas(database);
    const bytes = new Uint8Array([1, 2, 3]);
    await run(
      database,
      `INSERT INTO media_files (
        id, canvas_id, source_hash, digest_sha256, mime_type, byte_size, data
      ) VALUES ('media-a', ?, 'source-a', ?, 'image/png', 3, ?)`,
      CANVAS_A,
      digest('a'),
      bytes,
    );
    await run(
      database,
      `INSERT INTO media_files (
        id, canvas_id, source_hash, digest_sha256, mime_type, byte_size, data
      ) VALUES ('media-global', NULL, 'source-global', NULL, 'text/plain', 3, ?)`,
      bytes,
    );
    const media = await (await database.prepare(`
      SELECT id, canvas_id, digest_sha256, mime_type, byte_size, data
      FROM media_files WHERE id = 'media-a'
    `)).get() as Record<string, unknown>;
    expect(media).toMatchObject({
      id: 'media-a',
      canvas_id: CANVAS_A,
      digest_sha256: digest('a'),
      mime_type: 'image/png',
      byte_size: 3,
    });
    expect(Buffer.from(media.data as Uint8Array)).toEqual(Buffer.from(bytes));

    await rejected(run(
      database,
      `INSERT INTO media_files (
        id, source_hash, mime_type, byte_size, data
      ) VALUES ('bad-size', 'bad-size', 'image/png', 4, ?)`,
      bytes,
    ));
    await rejected(run(
      database,
      `INSERT INTO media_files (
        id, source_hash, digest_sha256, mime_type, byte_size, data
      ) VALUES ('bad-digest', 'bad-digest', 'ABC', 'image/png', 3, ?)`,
      bytes,
    ));
    await rejected(run(
      database,
      `INSERT INTO media_files (
        id, source_hash, mime_type, byte_size, data
      ) VALUES ('bad-mime', 'bad-mime', 'IMAGE/PNG', 3, ?)`,
      bytes,
    ));
    await rejected(run(
      database,
      `INSERT INTO media_files (
        id, canvas_id, source_hash, mime_type, byte_size, data
      ) VALUES ('missing-canvas', 'does-not-exist', 'missing-canvas', 'image/png', 3, ?)`,
      bytes,
    ));

    await run(database, 'DELETE FROM canvases WHERE id = ?', CANVAS_A);
    expect(await (await database.prepare(`
      SELECT id FROM media_files ORDER BY id
    `)).all()).toEqual([expect.objectContaining({ id: 'media-global' })]);
  });

  test('enforces resource domains, active-operation cardinality, safe paths, digests, and composite run guards', async () => {
    const database = await openBaseline();
    await seedResource(database, RESOURCE_A, 'Resource A');
    await seedResource(database, RESOURCE_B, 'Resource B');

    await rejected(run(
      database,
      `UPDATE resource_catalog SET status = 'unknown' WHERE id = ?`,
      RESOURCE_A,
    ));
    await run(
      database,
      `INSERT INTO db_resource_drafts (id, resource_id, name, status)
       VALUES (?, ?, 'First draft', 'editing')`,
      DRAFT_A,
      RESOURCE_A,
    );
    await rejected(run(
      database,
      `INSERT INTO db_resource_drafts (id, resource_id, name, status)
       VALUES (?, ?, 'Second draft', 'applying')`,
      DRAFT_B,
      RESOURCE_A,
    ));
    await run(
      database,
      `INSERT INTO db_resource_draft_changes (
        draft_id, sequence, kind, operation_json, sql_text
      ) VALUES (?, 1, 'sql', ?, 'SELECT ?')`,
      DRAFT_A,
      '{"type":"boundSql","parameters":[1]}',
    );
    await rejected(run(
      database,
      `INSERT INTO db_resource_draft_changes (
        draft_id, sequence, kind, operation_json, sql_text
      ) VALUES (?, 2, 'sql', '{}', 'SELECT 1')`,
      DRAFT_A,
    ));

    await run(
      database,
      `INSERT INTO db_resource_apply_runs (
        id, resource_id, draft_id, status, backup_retained, created_at_sec
      ) VALUES (?, ?, ?, 'preparing', FALSE, ?)`,
      APPLY_A,
      RESOURCE_A,
      DRAFT_A,
      VALID_TIMESTAMP,
    );
    await rejected(run(
      database,
      `INSERT INTO db_resource_apply_runs (
        id, resource_id, status, backup_retained
      ) VALUES (?, ?, 'applying', FALSE)`,
      APPLY_B,
      RESOURCE_A,
    ));
    await rejected(run(
      database,
      `UPDATE db_resource_apply_runs SET backup_retained = 2 WHERE id = ?`,
      APPLY_A,
    ));
    await run(
      database,
      `UPDATE db_resource_apply_runs
       SET status = 'succeeded', backup_retained = TRUE, completed_at_sec = ?
       WHERE id = ?`,
      LATER_TIMESTAMP,
      APPLY_A,
    );

    for (const [number, relativePath] of [
      ['/absolute/data.db'],
      ['../escape/data.db'],
      ['safe/../escape.db'],
      ['C:/data.db'],
      ['safe\\data.db'],
      ['safe//data.db'],
    ].entries()) {
      await rejected(run(
        database,
        `INSERT INTO resource_placements (
          resource_id, cell_id, placement_epoch, relative_path, status
        ) VALUES (?, 'local', 1, ?, 'active')`,
        number % 2 === 0 ? RESOURCE_A : RESOURCE_B,
        relativePath[0],
      ));
    }
    await run(
      database,
      `INSERT INTO resource_placements (
        resource_id, cell_id, placement_epoch, relative_path, status
      ) VALUES (?, 'local', 1, 'resources/resource-a/data.db', 'active')`,
      RESOURCE_A,
    );
    await rejected(run(
      database,
      `INSERT INTO resource_encryption_keys (
        id, resource_id, purpose, algorithm, key_material
      ) VALUES ('short-key', ?, 'resource-data', 'aegis-256', ?)`,
      RESOURCE_A,
      new Uint8Array(31),
    ));

    await rejected(run(
      database,
      `INSERT INTO db_resource_backups (
        id, resource_id, apply_run_id, relative_path, digest_sha256,
        byte_size, state, created_at_sec, verified_at_sec, delete_after_sec
      ) VALUES ('bad-digest', ?, ?, 'resources/backups/bad.db', 'ABC', 1,
        'retained', ?, ?, ?)`,
      RESOURCE_A,
      APPLY_A,
      VALID_TIMESTAMP,
      LATER_TIMESTAMP,
      LATER_TIMESTAMP,
    ));
    await rejected(run(
      database,
      `INSERT INTO db_resource_backups (
        id, resource_id, apply_run_id, relative_path, digest_sha256,
        byte_size, state, created_at_sec, verified_at_sec, delete_after_sec
      ) VALUES ('bad-retention', ?, ?, 'resources/backups/bad-retention.db', ?, 1,
        'retained', ?, ?, NULL)`,
      RESOURCE_A,
      APPLY_A,
      digest('a'),
      VALID_TIMESTAMP,
      LATER_TIMESTAMP,
    ));
    await run(
      database,
      `INSERT INTO db_resource_apply_runs (
        id, resource_id, status, backup_retained, created_at_sec, completed_at_sec
      ) VALUES (?, ?, 'succeeded', TRUE, ?, ?)`,
      APPLY_B,
      RESOURCE_B,
      VALID_TIMESTAMP,
      LATER_TIMESTAMP,
    );
    await rejected(run(
      database,
      `INSERT INTO db_resource_backups (
        id, resource_id, apply_run_id, relative_path, digest_sha256,
        byte_size, state, created_at_sec, verified_at_sec, delete_after_sec
      ) VALUES ('cross-resource', ?, ?, 'resources/backups/cross.db', ?, 1,
        'retained', ?, ?, ?)`,
      RESOURCE_A,
      APPLY_B,
      digest('b'),
      VALID_TIMESTAMP,
      LATER_TIMESTAMP,
      LATER_TIMESTAMP,
    ));
    await run(
      database,
      `INSERT INTO db_resource_backups (
        id, resource_id, apply_run_id, relative_path, digest_sha256,
        byte_size, state, created_at_sec, verified_at_sec, delete_after_sec
      ) VALUES ('backup-a', ?, ?, 'resources/backups/a.db', ?, 1,
        'retained', ?, ?, ?)`,
      RESOURCE_A,
      APPLY_A,
      digest('c'),
      VALID_TIMESTAMP,
      LATER_TIMESTAMP,
      LATER_TIMESTAMP,
    );
  });

  test('provides minimal chat CRUD/list/archive behavior with unique paths and retained-history FK semantics', async () => {
    const database = await openBaseline();
    await seedCanvas(database);
    const chats = new ChatStoreTurso(database);

    const created = await chats.create({
      id: 'chat-a',
      canvasId: CANVAS_A,
      name: 'First chat',
      workspaceRelativePath: 'agent/workspaces/chat-a',
      historyRelativePath: 'agent/history/chat-a.jsonl',
    });
    expect(created).toMatchObject({
      id: 'chat-a',
      canvasId: CANVAS_A,
      name: 'First chat',
      status: 'active',
    });
    expect(created.createdAtSec).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(await chats.get({ id: 'chat-a' })).toEqual(created);
    expect(await chats.list({ canvasId: CANVAS_A, status: 'active' })).toEqual([created]);

    const renamed = await chats.update({ id: 'chat-a', name: 'Renamed chat' });
    expect(renamed).toMatchObject({ name: 'Renamed chat', status: 'active' });
    const archived = await chats.archive({ id: 'chat-a' });
    expect(archived).toMatchObject({ name: 'Renamed chat', status: 'archived' });
    expect(await chats.list({ status: 'active' })).toEqual([]);
    expect(await chats.list({ status: 'archived' })).toHaveLength(1);

    await expect(chats.create({
      id: 'duplicate-workspace',
      canvasId: null,
      name: 'Duplicate workspace',
      workspaceRelativePath: 'agent/workspaces/chat-a',
      historyRelativePath: 'agent/history/other.jsonl',
    })).rejects.toThrow();
    await expect(chats.create({
      id: 'duplicate-history',
      canvasId: null,
      name: 'Duplicate history',
      workspaceRelativePath: 'agent/workspaces/other',
      historyRelativePath: 'agent/history/chat-a.jsonl',
    })).rejects.toThrow();
    await expect(chats.create({
      id: 'unsafe-path',
      canvasId: null,
      name: 'Unsafe path',
      workspaceRelativePath: '../escape',
      historyRelativePath: 'agent/history/unsafe.jsonl',
    })).rejects.toThrow();
    await rejected(run(database, 'DELETE FROM canvases WHERE id = ?', CANVAS_A));
    expect(await chats.get({ id: 'chat-a' })).not.toBeNull();
    await expect(chats.list({ limit: 0 })).rejects.toThrow(RangeError);
  });
});
