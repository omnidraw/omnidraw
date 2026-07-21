import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import { Database } from '@vibecanvas/service-db/DbServiceTurso/turso-native';
import type { TResourceIdleSweepScheduler } from '@vibecanvas/resource-runtime/local';
import type { TDbResourceDraftChange } from '@vibecanvas/service-db/model';
import type { TVibecanvasJson } from '../src/core/types';
import { ActorResourceManager } from '../src/resources/ActorResourceManager';
import { DbResource, type TDatabaseFactory } from '../src/resources/DbResource';
import { createTestCrypto, testUuid } from './test-uuid';
import { bindTestTenantDb, type TActorTestDb } from './tenant.fixture';

const definitionName = 'Notes Widget';

function manualIdleClock() {
  let nowMs = 0;
  let scheduled: Readonly<{
    callback: () => void | Promise<void>;
    dueAtMs: number;
  }> | null = null;
  const scheduleIdleSweep: TResourceIdleSweepScheduler = (callback, delayMs) => {
    const next = { callback, dueAtMs: nowMs + delayMs };
    scheduled = next;
    return () => {
      if (scheduled === next) scheduled = null;
    };
  };
  return {
    nowMs: () => nowMs,
    scheduleIdleSweep,
    async advance(milliseconds: number) {
      nowMs += milliseconds;
      while (scheduled && scheduled.dueAtMs <= nowMs) {
        const current = scheduled;
        scheduled = null;
        await current.callback();
      }
    },
  };
}

function manifest(): TVibecanvasJson & { manifest_path: string } {
  return {
    slug: 'notes-widget',
    name: definitionName,
    manifest_path: 'widgets/notes/vibecanvas.json',
    actor: {
      relFunctionPath: './actor/functions.ts',
      initialState: 'ready',
      initialData: {},
      resources: {
        notes: {
          kind: 'db',
          required: true,
          scope: ['read', 'write'],
          arbitrarySql: true,
          operations: {
            createNote: {
              effect: 'write',
              sql: 'INSERT INTO notes (id, title) VALUES (:id, :title)',
              parameters: { id: { type: 'string' }, title: { type: 'string' } },
              result: 'execute',
            },
            listNotes: { effect: 'read', sql: 'SELECT id, title FROM notes ORDER BY id', result: 'rows' },
            mutatingReadRows: { effect: 'read', sql: "INSERT INTO notes (id, title) VALUES ('read-rows', 'forbidden') RETURNING id", result: 'rows' },
            mutatingReadExecute: { effect: 'read', sql: "INSERT INTO notes (id, title) VALUES ('read-execute', 'forbidden')", result: 'execute' },
          },
        },
      },
      states: { ready: { on: {} } },
    },
    widget: { relWidgetDir: './widget', tool: { label: 'Notes', behavior: { type: 'action' } } },
  };
}

describe('DbResource schema-agnostic provider', () => {
  let dbService: DbServiceTurso;
  let db: TActorTestDb;
  let provider: DbResource;
  let manager: ActorResourceManager;
  let dataRoot: string;
  let testCrypto: Pick<Crypto, 'randomUUID'>;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'vibecanvas-db-resource-'));
    dbService = new DbServiceTurso({ databasePath: ':memory:', dataDir: dataRoot, cacheDir: dataRoot });
    await dbService.start();
    db = bindTestTenantDb(dbService);
    testCrypto = createTestCrypto('db-resource');
    const definition = manifest();
    await db.actor.insertDefinition({ name: definitionName, slug: definition.slug, url: null, description: null, manifest_path: definition.manifest_path });
    provider = new DbResource({ db, dataRoot });
    manager = new ActorResourceManager({ db, crypto: testCrypto, getDefinition: (name) => name === definitionName ? definition : null, providers: [provider] });
  });

  afterEach(async () => {
    await manager.close();
    await db.db.close();
    await rm(dataRoot, { recursive: true, force: true });
  });

  async function createBoundResource() {
    const resource = await manager.createResource({ kind: 'db', name: 'Shared Notes' });
    await manager.bindResource({ definitionName, slot: 'notes', resourceId: resource.id });
    return resource;
  }

  function call(resourceOperation: string, args: unknown, functionClass: 'fx' | 'tx' = 'tx') {
    return manager.call({
      actorId: 'actor-a',
      definitionName,
      runId: 1,
      functionClass,
      slot: 'notes',
      kind: 'db',
      operation: resourceOperation,
      args,
    });
  }

  test('creates an empty physical database and preserves named and arbitrary SQLite-compatible calls', async () => {
    const resource = await createBoundResource();
    await access(join(dataRoot, resource.id, 'data.db'));
    await call('execute', { sql: 'CREATE TABLE notes (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL) STRICT' });
    await expect(call('invoke', { operation: 'createNote', parameters: { id: 'a', title: 'Alpha' } }))
      .resolves.toMatchObject({ rowsAffected: 1 });
    await expect(call('invoke', { operation: 'listNotes', parameters: {} }, 'fx'))
      .resolves.toEqual([{ id: 'a', title: 'Alpha' }]);
    await expect(call('query', { sql: 'SELECT COUNT(*) AS total FROM notes', parameters: {} }, 'fx'))
      .resolves.toEqual([{ total: 1n }]);
    await expect(call('execute', { operations: [
      { sql: "INSERT INTO notes (id, title) VALUES ('b', 'Before rollback')" },
      { sql: "INSERT INTO notes (id, title) VALUES ('a', 'Duplicate')" },
    ] })).rejects.toMatchObject({ code: 'DB_EXECUTE_FAILED' });
    await expect(call('query', { sql: 'SELECT id FROM notes ORDER BY id', parameters: {} }, 'fx'))
      .resolves.toEqual([{ id: 'a' }]);
    await expect(call('query', { sql: "INSERT INTO notes (id, title) VALUES ('query-read', 'forbidden') RETURNING id", parameters: {} }, 'fx'))
      .rejects.toMatchObject({ code: 'DB_QUERY_FAILED' });
    await expect(call('invoke', { operation: 'mutatingReadRows', parameters: {} }, 'fx'))
      .rejects.toMatchObject({ code: 'DB_QUERY_FAILED' });
    await expect(call('invoke', { operation: 'mutatingReadExecute', parameters: {} }, 'fx'))
      .rejects.toMatchObject({ code: 'DB_QUERY_FAILED' });
    await expect(call('query', { sql: 'SELECT COUNT(*) AS total FROM notes', parameters: {} }, 'fx'))
      .resolves.toEqual([{ total: 1n }]);
    await expect(call('execute', { sql: 'ATTACH DATABASE :path AS stolen', parameters: { path: '/tmp/stolen.db' } }))
      .rejects.toMatchObject({ code: 'DB_ARBITRARY_SQL_NOT_ALLOWED' });
  });

  test('runs bounded SQL against live, returns result sets, and never mutates without approval', async () => {
    const resource = await createBoundResource();
    await expect(provider.executeLiveSql({
      resourceId: resource.id,
      sql: 'CREATE TABLE live_notes (id INTEGER PRIMARY KEY, title TEXT NOT NULL, payload BLOB)',
      approved: true,
    })).resolves.toEqual({ kind: 'execute', rowsAffected: 0, lastInsertRowId: null });

    await expect(provider.executeLiveSql({
      resourceId: resource.id,
      sql: 'INSERT INTO live_notes (title) VALUES (:title)',
      parameters: { title: { type: 'text', value: 'must not persist' } },
      approved: false,
    })).rejects.toMatchObject({ code: 'DB_LIVE_SQL_APPROVAL_REQUIRED' });
    await expect(provider.executeLiveSql({
      resourceId: resource.id,
      sql: 'INSERT INTO live_notes (title) VALUES (:title) RETURNING id, title',
      parameters: { title: { type: 'text', value: 'also must not persist' } },
      approved: false,
    })).rejects.toMatchObject({ code: 'DB_LIVE_SQL_APPROVAL_REQUIRED' });
    await expect(provider.executeLiveSql({
      resourceId: resource.id,
      sql: "WITH values_to_add(title) AS (VALUES ('cte must not persist')) INSERT INTO live_notes (title) SELECT title FROM values_to_add",
      approved: false,
    })).rejects.toMatchObject({ code: 'DB_LIVE_SQL_APPROVAL_REQUIRED' });

    await expect(provider.executeLiveSql({
      resourceId: resource.id,
      sql: 'SELECT COUNT(*) AS total FROM live_notes',
      approved: false,
    })).resolves.toEqual({
      kind: 'rows',
      columns: ['total'],
      rows: [{ total: { type: 'integer', value: '0' } }],
      rowCount: 1,
      rowsAffected: 0,
      truncated: false,
    });

    await expect(provider.executeLiveSql({
      resourceId: resource.id,
      sql: 'INSERT INTO live_notes (title, payload) VALUES (:title, :payload) RETURNING id, title',
      parameters: {
        title: { type: 'text', value: 'approved' },
        payload: { type: 'blob', base64: 'AQID' },
      },
      approved: true,
    })).resolves.toMatchObject({
      kind: 'rows',
      rows: [{ id: { type: 'integer', value: '1' }, title: { type: 'text', value: 'approved' } }],
      rowsAffected: 1,
    });
    await expect(provider.executeLiveSql({
      resourceId: resource.id,
      sql: 'SELECT id, title, payload FROM live_notes',
      approved: false,
    })).resolves.toMatchObject({
      kind: 'rows',
      columns: ['id', 'title', 'payload'],
      rows: [{
        id: { type: 'integer', value: '1' },
        title: { type: 'text', value: 'approved' },
        payload: { type: 'blobPreview', byteLength: 3, previewBase64: 'AQID', truncated: false },
      }],
      rowCount: 1,
      rowsAffected: 0,
      truncated: false,
    });
    await expect(provider.executeLiveSql({ resourceId: resource.id, sql: 'SELECT 1; SELECT 2', approved: false }))
      .rejects.toMatchObject({ code: 'DB_OPERATION_PARAMETERS_INVALID' });
    await expect(provider.executeLiveSql({ resourceId: resource.id, sql: 'SELECT FROM', approved: false }))
      .rejects.toMatchObject({ code: 'DB_QUERY_FAILED' });
    await expect(provider.executeLiveSql({ resourceId: resource.id, sql: 'SELECT * FROM missing_table', approved: false }))
      .rejects.toMatchObject({ code: 'DB_QUERY_FAILED' });
  });

  test('previews large BLOBs without loading them into row pages and bounds explicit hydration', async () => {
    const resource = await createBoundResource();
    await call('execute', { sql: 'CREATE TABLE files (id INTEGER PRIMARY KEY, name TEXT NOT NULL, payload BLOB)' });
    await call('execute', { sql: 'CREATE TABLE blob_keys (id BLOB PRIMARY KEY NOT NULL, name TEXT NOT NULL)' });
    await call('execute', { sql: "INSERT INTO files (id, name, payload) VALUES (1, 'large', zeroblob(2097152))" });
    await call('execute', { sql: "INSERT INTO files (id, name, payload) VALUES (2, 'small', x'010203')" });
    await call('execute', { sql: "INSERT INTO blob_keys (id, name) VALUES (zeroblob(2097152), 'large key')" });

    const page = await provider.listRows({ resourceId: resource.id, object: 'files', limit: 10 });
    expect(JSON.stringify(page).length).toBeLessThan(20_000);
    expect(page.rows[0].values.payload).toEqual({
      type: 'blobPreview',
      byteLength: 2_097_152,
      previewBase64: Buffer.alloc(64).toString('base64'),
      truncated: true,
    });
    expect(page.rows[1].values.payload).toEqual({ type: 'blobPreview', byteLength: 3, previewBase64: 'AQID', truncated: false });
    await expect(provider.getRow({ resourceId: resource.id, object: 'files', identity: page.rows[0].identity! }))
      .rejects.toMatchObject({ code: 'DB_RESOURCE_ROW_TOO_LARGE' });
    const projected = await provider.getRow({ resourceId: resource.id, object: 'files', identity: page.rows[0].identity!, columns: ['id', 'name'] });
    expect(projected).toMatchObject({ values: { id: { type: 'integer', value: '1' }, name: { type: 'text', value: 'large' } } });
    expect(projected.values).not.toHaveProperty('payload');
    await expect(provider.updateRow({
      resourceId: resource.id,
      object: 'files',
      identity: projected.identity!,
      values: { name: { type: 'text', value: 'renamed' } },
      expectedOriginal: { name: projected.values.name },
    })).resolves.toEqual({ rowsAffected: 1 });
    const hydrated = await provider.getRow({ resourceId: resource.id, object: 'files', identity: page.rows[1].identity! });
    expect(hydrated).toMatchObject({ values: { payload: { type: 'blob', base64: 'AQID' } } });
    await expect(provider.deleteRow({
      resourceId: resource.id,
      object: 'files',
      identity: hydrated.identity!,
      expectedOriginal: hydrated.values,
    })).resolves.toEqual({ rowsAffected: 1 });
    await expect(provider.executeLiveSql({ resourceId: resource.id, sql: 'SELECT payload FROM files WHERE id = 1', approved: false }))
      .rejects.toMatchObject({ code: 'DB_RESULT_LIMIT_EXCEEDED' });
    await expect(provider.executeLiveSql({ resourceId: resource.id, sql: 'SELECT id, name, length(payload) AS bytes FROM files ORDER BY id', approved: false }))
      .resolves.toMatchObject({
        kind: 'rows',
        rows: [
          { id: { type: 'integer', value: '1' }, name: { type: 'text', value: 'renamed' }, bytes: { type: 'integer', value: '2097152' } },
        ],
      });
    const blobKeyPage = await provider.listRows({ resourceId: resource.id, object: 'blob_keys' });
    expect(blobKeyPage).toMatchObject({
      object: { identity: { kind: 'rowid' }, editable: true },
      rows: [{ identity: { kind: 'rowid' }, values: { id: { type: 'blobPreview', byteLength: 2_097_152, truncated: true } } }],
    });
  });

  test('cursor-paginates many live rows without offsets or oversized pages', async () => {
    const resource = await createBoundResource();
    await call('execute', { sql: 'CREATE TABLE many_rows (id INTEGER PRIMARY KEY, title TEXT NOT NULL)' });
    for (let start = 1; start <= 1000; start += 100) {
      await provider.bulkRows({
        resourceId: resource.id,
        object: 'many_rows',
        operations: Array.from({ length: 100 }, (_, offset) => {
          const id = start + offset;
          return {
            kind: 'create' as const,
            values: {
              id: { type: 'integer' as const, value: String(id) },
              title: { type: 'text' as const, value: `row-${String(id).padStart(4, '0')}` },
            },
          };
        }),
      });
    }

    const ids: string[] = [];
    let cursor = null;
    do {
      const page = await provider.listRows({ resourceId: resource.id, object: 'many_rows', cursor, limit: 137 });
      expect(page.rows.length).toBeLessThanOrEqual(137);
      ids.push(...page.rows.map((row) => row.values.id.type === 'integer' ? row.values.id.value : 'invalid'));
      cursor = page.nextCursor;
      if (!page.hasMore) break;
      expect(cursor).not.toBeNull();
    } while (cursor);
    expect(ids).toHaveLength(1000);
    expect(new Set(ids).size).toBe(1000);
    expect(ids[0]).toBe('1');
    expect(ids.at(-1)).toBe('1000');

    const sqlPage = await provider.executeLiveSql({
      resourceId: resource.id,
      sql: 'SELECT id, title FROM many_rows ORDER BY id',
      approved: false,
    });
    expect(sqlPage).toMatchObject({ kind: 'rows', rowCount: 1000, truncated: true, rowsAffected: 0 });
    expect(sqlPage.kind === 'rows' ? sqlPage.rows : []).toHaveLength(200);
  });

  test('inspects user objects and provides lossless cursor CRUD with optimistic conflicts', async () => {
    const resource = await createBoundResource();
    await call('execute', { operations: [
      { sql: 'CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT NOT NULL, payload BLOB)' },
      { sql: 'CREATE INDEX notes_title ON notes (title)' },
      { sql: 'INSERT INTO notes (id, title, payload) VALUES (:id, :title, :payload)', parameters: { id: 9n, title: 'Alpha', payload: new Uint8Array([1, 2, 3]) } },
    ] });

    const inspection = await provider.inspect(resource.id, 'live');
    expect(inspection.objects.map((object) => object.name)).toEqual(['notes']);
    expect(inspection.objects[0]).toMatchObject({ editable: true, identity: { kind: 'primaryKey', columns: ['id'] } });
    expect(inspection.objects[0].indexes.map((index) => index.name)).toContain('notes_title');

    const page = await provider.listRows({ resourceId: resource.id, object: 'notes', limit: 1 });
    expect(page.rows[0].values).toEqual({
      id: { type: 'integer', value: '9' },
      title: { type: 'text', value: 'Alpha' },
      payload: { type: 'blobPreview', byteLength: 3, previewBase64: 'AQID', truncated: false },
    });
    const identity = page.rows[0].identity!;
    await provider.updateRow({
      resourceId: resource.id,
      object: 'notes',
      identity,
      values: { title: { type: 'text', value: 'Beta' } },
      expectedOriginal: { title: { type: 'text', value: 'Alpha' } },
    });
    await expect(provider.updateRow({
      resourceId: resource.id,
      object: 'notes',
      identity,
      values: { title: { type: 'text', value: 'Gamma' } },
      expectedOriginal: { title: { type: 'text', value: 'Alpha' } },
    })).rejects.toMatchObject({ code: 'DB_RESOURCE_ROW_CONFLICT' });
    expect((await provider.listRows({ resourceId: resource.id, object: 'notes' })).rows[0].values.title)
      .toEqual({ type: 'text', value: 'Beta' });

    await provider.bulkRows({
      resourceId: resource.id,
      object: 'notes',
      operations: [
        { kind: 'create', values: { id: { type: 'integer', value: '10' }, title: { type: 'text', value: 'Ten' } } },
        { kind: 'create', values: { id: { type: 'integer', value: '11' }, title: { type: 'text', value: 'Eleven' } } },
      ],
    });
    await expect(provider.bulkRows({
      resourceId: resource.id,
      object: 'notes',
      operations: [
        {
          kind: 'delete',
          identity: { kind: 'primaryKey', values: { id: { type: 'integer', value: '10' } } },
          expectedOriginal: {
            id: { type: 'integer', value: '10' },
            title: { type: 'text', value: 'Ten' },
            payload: { type: 'null' },
          },
        },
        {
          kind: 'delete',
          identity: { kind: 'primaryKey', values: { id: { type: 'integer', value: '11' } } },
          expectedOriginal: {
            id: { type: 'integer', value: '11' },
            title: { type: 'text', value: 'stale' },
            payload: { type: 'null' },
          },
        },
      ],
    })).rejects.toMatchObject({ code: 'DB_RESOURCE_ROW_CONFLICT' });
    expect((await provider.listRows({ resourceId: resource.id, object: 'notes', limit: 10 })).rows.map((row) => row.values.id))
      .toEqual([
        { type: 'integer', value: '9' },
        { type: 'integer', value: '10' },
        { type: 'integer', value: '11' },
      ]);
  });

  test('uses rowid for nullable non-integer primary keys and reports non-pageable overflow explicitly', async () => {
    const resource = await createBoundResource();
    await call('execute', { operations: [
      { sql: 'CREATE TABLE nullable_keys (id TEXT PRIMARY KEY, title TEXT NOT NULL)' },
      { sql: "INSERT INTO nullable_keys (id, title) VALUES (NULL, 'First')" },
      { sql: "INSERT INTO nullable_keys (id, title) VALUES (NULL, 'Second')" },
      { sql: 'CREATE VIEW nullable_keys_view AS SELECT id, title FROM nullable_keys' },
    ] });

    const inspection = await provider.inspect(resource.id, 'live');
    expect(inspection.objects.find((object) => object.name === 'nullable_keys'))
      .toMatchObject({ editable: true, identity: { kind: 'rowid' } });

    const first = await provider.listRows({ resourceId: resource.id, object: 'nullable_keys', limit: 1 });
    expect(first).toMatchObject({ hasMore: true, nextCursor: { kind: 'rowid' } });
    expect(first.rows[0].values.title).toEqual({ type: 'text', value: 'First' });
    await expect(provider.getRow({ resourceId: resource.id, object: 'nullable_keys', identity: first.rows[0].identity! }))
      .resolves.toMatchObject({ identity: first.rows[0].identity, values: { title: { type: 'text', value: 'First' } } });
    const second = await provider.listRows({ resourceId: resource.id, object: 'nullable_keys', cursor: first.nextCursor, limit: 1 });
    expect(second.rows[0].values.title).toEqual({ type: 'text', value: 'Second' });

    const view = await provider.listRows({ resourceId: resource.id, object: 'nullable_keys_view', limit: 1 });
    expect(view).toMatchObject({ hasMore: true, nextCursor: null });
    await expect(provider.listRows({
      resourceId: resource.id,
      object: 'nullable_keys_view',
      cursor: { kind: 'rowid', value: { type: 'integer', value: '1' } },
      limit: 1,
    })).rejects.toMatchObject({ code: 'DB_RESOURCE_ROW_IDENTITY_REQUIRED' });
  });

  test('requires optimistic originals for every updated column and the complete deleted row', async () => {
    const resource = await createBoundResource();
    await call('execute', { operations: [
      { sql: 'CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT NOT NULL, detail TEXT)' },
      { sql: "INSERT INTO notes VALUES (1, 'Alpha', 'A')" },
    ] });
    const row = (await provider.listRows({ resourceId: resource.id, object: 'notes' })).rows[0];
    await expect(provider.updateRow({
      resourceId: resource.id,
      object: 'notes',
      identity: row.identity!,
      values: { title: { type: 'text', value: 'Beta' } },
      expectedOriginal: { detail: { type: 'text', value: 'A' } },
    })).rejects.toMatchObject({ code: 'DB_OPERATION_PARAMETERS_INVALID' });
    await expect(provider.deleteRow({
      resourceId: resource.id,
      object: 'notes',
      identity: row.identity!,
      expectedOriginal: { title: { type: 'text', value: 'Alpha' } },
    })).rejects.toMatchObject({ code: 'DB_OPERATION_PARAMETERS_INVALID' });
    expect((await provider.listRows({ resourceId: resource.id, object: 'notes' })).rows[0].values.title)
      .toEqual({ type: 'text', value: 'Alpha' });
  });

  test('keeps structure changes isolated in a physical draft and retains a restorable pre-apply backup', async () => {
    const resource = await createBoundResource();
    await call('execute', { sql: 'CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT NOT NULL)' });
    await provider.createRow({ resourceId: resource.id, object: 'notes', values: { id: { type: 'integer', value: '1' }, title: { type: 'text', value: 'before' } } });

    await provider.createDraft(resource.id, testUuid('draft-a'));
    const sql = await provider.applyDraftChange(testUuid('draft-a'), {
      kind: 'addColumn',
      table: 'notes',
      column: { name: 'archived', declaredType: 'INTEGER', nullable: false, defaultSql: '0' },
    });
    expect((await provider.inspect(resource.id, 'live')).objects[0].columns.map((column) => column.name)).not.toContain('archived');
    expect((await provider.inspect(resource.id, 'draft', testUuid('draft-a'))).objects[0].columns.map((column) => column.name)).toContain('archived');
    expect(await provider.listDraftChangeEvidence(testUuid('draft-a'))).toEqual([{ sequence: 1, kind: 'structure', sql: sql.sql }]);

    const changes: TDbResourceDraftChange[] = [{
      draft_id: testUuid('draft-a'), sequence: 1, kind: 'structure', operation: { kind: 'addColumn' }, sql: sql.sql, created_at: new Date().toISOString(),
    }];
    await expect(provider.applyDraft({ resourceId: resource.id, draftId: testUuid('draft-a'), applyId: testUuid('apply-a'), changes }))
      .resolves.toMatchObject({ outcome: 'succeeded', backupRetained: true });
    expect((await provider.inspect(resource.id, 'live')).objects[0].columns.map((column) => column.name)).toContain('archived');
    await expect(provider.reconcileApply(resource.id, testUuid('apply-a')))
      .resolves.toEqual({ outcome: 'committed', retainedBackupApplyId: testUuid('apply-a') });

    await expect(provider.reconcileApply(resource.id, testUuid('restore-after-crash'), { restoreSourceApplyId: testUuid('apply-a') }))
      .resolves.toEqual({ outcome: 'recovered', retainedBackupApplyId: testUuid('apply-a') });
    expect(await provider.hasApplyMarker(resource.id, testUuid('restore-after-crash'))).toBe(true);

    await provider.updateRow({
      resourceId: resource.id,
      object: 'notes',
      identity: { kind: 'primaryKey', values: { id: { type: 'integer', value: '1' } } },
      values: { title: { type: 'text', value: 'after' } },
      expectedOriginal: { title: { type: 'text', value: 'before' } },
    });
    await provider.restoreBackup(resource.id, testUuid('apply-a'), testUuid('restore-a'));
    const restored = await provider.listRows({ resourceId: resource.id, object: 'notes' });
    expect(restored.rows[0].values.title).toEqual({ type: 'text', value: 'before' });
    expect(restored.object.columns.map((column) => column.name)).not.toContain('archived');
  });

  test('accepts a verified backup with pre-existing foreign-key violations as the apply baseline', async () => {
    const resource = await createBoundResource();
    await call('execute', { sql: 'PRAGMA foreign_keys = OFF' });
    await call('execute', { sql: 'CREATE TABLE parents (id INTEGER PRIMARY KEY)' });
    await call('execute', { sql: 'CREATE TABLE children (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents(id))' });
    await call('execute', { sql: 'INSERT INTO children (id, parent_id) VALUES (1, 999)' });
    expect(await provider.inspectForeignKeyViolations(resource.id)).toHaveLength(1);
    await expect(provider.reconcile(resource)).resolves.toEqual({ status: 'ready' });

    await provider.createDraft(resource.id, testUuid('draft-with-fk-baseline'));
    const sql = await provider.applyDraftChange(testUuid('draft-with-fk-baseline'), {
      kind: 'addColumn',
      table: 'children',
      column: { name: 'label', declaredType: 'TEXT' },
    });
    const changes: TDbResourceDraftChange[] = [{
      draft_id: testUuid('draft-with-fk-baseline'),
      sequence: 1,
      kind: 'structure',
      operation: { kind: 'addColumn' },
      sql: sql.sql,
      created_at: new Date().toISOString(),
    }];

    await expect(provider.applyDraft({
      resourceId: resource.id,
      draftId: testUuid('draft-with-fk-baseline'),
      applyId: testUuid('apply-with-fk-baseline'),
      changes,
    })).resolves.toMatchObject({ outcome: 'succeeded', backupRetained: true });
    expect(await provider.hasVerifiedBackup(resource.id, testUuid('apply-with-fk-baseline'))).toBe(true);
  });

  test('detects a newly introduced foreign-key violation and restores the verified pre-apply database', async () => {
    const resource = await createBoundResource();
    await call('execute', { operations: [
      { sql: 'CREATE TABLE parents (id INTEGER PRIMARY KEY)' },
      { sql: 'CREATE TABLE children (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents(id))' },
    ] });
    const changes: TDbResourceDraftChange[] = [{
      draft_id: testUuid('draft-new-fk'),
      sequence: 1,
      kind: 'sql',
      operation: null,
      sql: '-- __vibecanvas_rebuild\nINSERT INTO children (id, parent_id) VALUES (1, 999);',
      created_at: new Date().toISOString(),
    }];
    await expect(provider.applyDraft({
      resourceId: resource.id,
      draftId: testUuid('draft-new-fk'),
      applyId: testUuid('apply-new-fk'),
      changes,
    })).resolves.toMatchObject({ outcome: 'recovered', backupRetained: true });
    expect(await provider.inspectForeignKeyViolations(resource.id)).toEqual([]);
    await expect(call('query', { sql: 'SELECT * FROM children', parameters: {} }, 'fx')).resolves.toEqual([]);
  });

  test('represents missing-parent and omitted-parent-key violations without disabling self-baselining', async () => {
    const resource = await createBoundResource();
    await call('execute', { sql: 'PRAGMA foreign_keys = OFF' });
    await call('execute', { operations: [
      { sql: 'CREATE TABLE parents (id INTEGER PRIMARY KEY)' },
      { sql: 'CREATE TABLE omitted_parent_key (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents)' },
      { sql: 'CREATE TABLE missing_parent (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES absent_parents(id))' },
      { sql: 'INSERT INTO omitted_parent_key (id, parent_id) VALUES (1, 41)' },
      { sql: 'INSERT INTO missing_parent (id, parent_id) VALUES (1, 42)' },
      { sql: 'INSERT INTO missing_parent (id, parent_id) VALUES (2, NULL)' },
    ] });
    expect(await provider.inspectForeignKeyViolations(resource.id)).toHaveLength(2);
    await expect(provider.reconcile(resource)).resolves.toEqual({ status: 'ready' });
  });

  test('fails closed when an explicit foreign key targets non-unique parent columns', async () => {
    const resource = await createBoundResource();
    await call('execute', { sql: 'PRAGMA foreign_keys = OFF' });
    await call('execute', { operations: [
      { sql: 'CREATE TABLE non_unique_parent (code TEXT)' },
      { sql: 'CREATE TABLE invalid_child (id INTEGER PRIMARY KEY, code TEXT REFERENCES non_unique_parent(code))' },
      { sql: "INSERT INTO invalid_child (id, code) VALUES (1, 'missing')" },
    ] });
    await expect(provider.inspectForeignKeyViolations(resource.id)).rejects.toMatchObject({ code: 'DB_RESOURCE_RECOVERY_FAILED' });
    await expect(provider.reconcile(resource)).resolves.toMatchObject({ status: 'error' });
  });

  test('fails closed when a UNIQUE parent index uses a mismatched collation', async () => {
    const resource = await createBoundResource();
    await call('execute', { sql: 'PRAGMA foreign_keys = OFF' });
    await call('execute', { operations: [
      { sql: 'CREATE TABLE collated_parent (code TEXT COLLATE NOCASE)' },
      { sql: 'CREATE UNIQUE INDEX collated_parent_code ON collated_parent(code COLLATE BINARY)' },
      { sql: 'CREATE TABLE collated_child (id INTEGER PRIMARY KEY, code TEXT REFERENCES collated_parent(code))' },
    ] });
    await expect(provider.inspectForeignKeyViolations(resource.id)).rejects.toMatchObject({ code: 'DB_RESOURCE_RECOVERY_FAILED' });
  });

  test('does not overwrite newer healthy live state from an unrelated retained backup during precommit reconciliation', async () => {
    const resource = await createBoundResource();
    await expect(provider.applyDraft({ resourceId: resource.id, draftId: testUuid('draft-old'), applyId: testUuid('apply-old'), changes: [] }))
      .resolves.toMatchObject({ outcome: 'succeeded', backupRetained: true });
    await call('execute', { sql: 'PRAGMA foreign_keys = OFF' });
    await call('execute', { operations: [
      { sql: 'CREATE TABLE parents (id INTEGER PRIMARY KEY)' },
      { sql: 'CREATE TABLE children (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents(id))' },
      { sql: 'INSERT INTO children (id, parent_id) VALUES (1, 999)' },
    ] });
    expect(await provider.inspectForeignKeyViolations(resource.id)).toHaveLength(1);
    await expect(provider.reconcileApply(resource.id, testUuid('apply-interrupted'), { fallbackBackupApplyId: testUuid('apply-old') }))
      .resolves.toEqual({ outcome: 'uncommitted', retainedBackupApplyId: testUuid('apply-old') });
    expect(await provider.inspectForeignKeyViolations(resource.id)).toHaveLength(1);
    await expect(call('query', { sql: 'SELECT id, parent_id FROM children', parameters: {} }, 'fx'))
      .resolves.toEqual([{ id: 1n, parent_id: 999n }]);
  });

  test('treats views and unsafe identities as read-only', async () => {
    const resource = await createBoundResource();
    await call('execute', { operations: [
      { sql: 'CREATE TABLE values_only (value TEXT)' },
      { sql: 'CREATE VIEW values_view AS SELECT value FROM values_only' },
    ] });
    const view = (await provider.inspect(resource.id, 'live')).objects.find((object) => object.name === 'values_view');
    expect(view).toMatchObject({ editable: false, identity: null });
    await expect(provider.createRow({ resourceId: resource.id, object: 'values_view', values: { value: { type: 'text', value: 'x' } } }))
      .rejects.toMatchObject({ code: 'DB_RESOURCE_TABLE_READ_ONLY' });
  });

  test('supports the complete structured table, column, index, and foreign-key draft surface', async () => {
    const resource = await createBoundResource();
    await provider.createDraft(resource.id, testUuid('draft-structure'));
    await provider.applyDraftChange(testUuid('draft-structure'), {
      kind: 'createTable', table: 'parents', columns: [{ name: 'id', declaredType: 'INTEGER', nullable: false, primaryKeyOrder: 1 }],
    });
    await provider.applyDraftChange(testUuid('draft-structure'), {
      kind: 'createTable', table: 'children', columns: [
        { name: 'id', declaredType: 'INTEGER', nullable: false, primaryKeyOrder: 1 },
        { name: 'parent_id', declaredType: 'INTEGER' },
        { name: 'label', declaredType: 'TEXT' },
      ],
    });
    await provider.applyDraftChange(testUuid('draft-structure'), { kind: 'createIndex', table: 'children', name: 'children_parent', columns: ['parent_id'] });
    await provider.applyDraftChange(testUuid('draft-structure'), {
      kind: 'createForeignKey', table: 'children', columns: ['parent_id'], referencedTable: 'parents', referencedColumns: ['id'], onDelete: 'CASCADE',
    });
    let children = (await provider.inspect(resource.id, 'draft', testUuid('draft-structure'))).objects.find((object) => object.name === 'children')!;
    expect(children.foreignKeys).toHaveLength(1);
    await provider.applyDraftChange(testUuid('draft-structure'), {
      kind: 'alterColumn', table: 'children', column: 'label', definition: { name: 'label', declaredType: 'TEXT', nullable: false, defaultSql: "''" },
    });
    await provider.applyDraftChange(testUuid('draft-structure'), { kind: 'renameColumn', table: 'children', column: 'label', newName: 'title' });
    children = (await provider.inspect(resource.id, 'draft', testUuid('draft-structure'))).objects.find((object) => object.name === 'children')!;
    await provider.applyDraftChange(testUuid('draft-structure'), { kind: 'dropForeignKey', table: 'children', id: children.foreignKeys[0].id });
    await provider.applyDraftChange(testUuid('draft-structure'), { kind: 'dropIndex', name: 'children_parent' });
    await provider.applyDraftChange(testUuid('draft-structure'), { kind: 'dropColumn', table: 'children', column: 'title' });
    await provider.applyDraftChange(testUuid('draft-structure'), { kind: 'renameTable', table: 'children', newName: 'items' });
    expect((await provider.inspect(resource.id, 'draft', testUuid('draft-structure'))).objects.map((object) => object.name)).toEqual(['items', 'parents']);
    await provider.applyDraftChange(testUuid('draft-structure'), { kind: 'dropTable', table: 'items' });
    expect((await provider.inspect(resource.id, 'draft', testUuid('draft-structure'))).objects.map((object) => object.name)).toEqual(['parents']);
  });

  test('creates structured tables as STRICT by default', async () => {
    const resource = await createBoundResource();
    await provider.createDraft(resource.id, testUuid('draft-default-strict'));
    const change = await provider.applyDraftChange(testUuid('draft-default-strict'), {
      kind: 'createTable',
      table: 'strict_by_default',
      columns: [
        { name: 'id', declaredType: 'INTEGER', nullable: false, primaryKeyOrder: 1 },
        { name: 'payload', declaredType: 'ANY' },
      ],
    });

    expect(change.sql).toMatch(/\) STRICT;$/);
    expect((await provider.inspect(resource.id, 'draft', testUuid('draft-default-strict'))).objects[0]?.createSql).toMatch(/\bSTRICT\s*$/i);
  });

  test('creates STRICT WITHOUT ROWID tables with valid combined table options', async () => {
    const resource = await createBoundResource();
    await provider.createDraft(resource.id, testUuid('draft-strict-without-rowid'));
    const change = await provider.applyDraftChange(testUuid('draft-strict-without-rowid'), {
      kind: 'createTable',
      table: 'strict_keys',
      columns: [
        { name: 'namespace', declaredType: 'TEXT', nullable: false, primaryKeyOrder: 1 },
        { name: 'key', declaredType: 'TEXT', nullable: false, primaryKeyOrder: 2 },
        { name: 'value', declaredType: 'BLOB', nullable: false },
      ],
      strict: true,
      withoutRowid: true,
    });

    expect(change.sql).toMatch(/\) STRICT, WITHOUT ROWID;$/);
    expect((await provider.inspect(resource.id, 'draft', testUuid('draft-strict-without-rowid'))).objects[0]?.createSql)
      .toMatch(/\bSTRICT\s*,\s*WITHOUT\s+ROWID\s*$/i);

    await expect(provider.applyDraft({
      resourceId: resource.id,
      draftId: testUuid('draft-strict-without-rowid'),
      applyId: testUuid('apply-strict-without-rowid'),
      changes: [{
        draft_id: testUuid('draft-strict-without-rowid'),
        sequence: change.sequence,
        kind: 'structure',
        operation: null,
        sql: change.sql,
        created_at: new Date().toISOString(),
      }],
    })).resolves.toMatchObject({ outcome: 'succeeded' });
    expect((await provider.inspect(resource.id, 'live')).objects[0]?.createSql)
      .toMatch(/\bSTRICT\s*,\s*WITHOUT\s+ROWID\s*$/i);

    await provider.createDraft(resource.id, testUuid('draft-rebuild-strict-without-rowid'));
    const rebuild = await provider.applyDraftChange(testUuid('draft-rebuild-strict-without-rowid'), {
      kind: 'alterColumn',
      table: 'strict_keys',
      column: 'value',
      definition: { name: 'value', defaultSql: "x''" },
    });
    expect(rebuild.sql).toContain('STRICT, WITHOUT ROWID;');
    expect((await provider.inspect(resource.id, 'draft', testUuid('draft-rebuild-strict-without-rowid'))).objects[0]?.createSql)
      .toMatch(/\bSTRICT\s*,\s*WITHOUT\s+ROWID\s*$/i);
  });

  test('rejects unsupported declared types clearly for STRICT structured tables', async () => {
    const resource = await createBoundResource();
    await provider.createDraft(resource.id, testUuid('draft-invalid-strict-type'));

    await expect(provider.applyDraftChange(testUuid('draft-invalid-strict-type'), {
      kind: 'createTable',
      table: 'invalid_strict_notes',
      columns: [{ name: 'title', declaredType: 'VARCHAR(255)' }],
    })).rejects.toMatchObject({
      code: 'DB_RESOURCE_SCHEMA_OPERATION_INVALID',
      message: expect.stringContaining('STRICT table column "title" must use INT, INTEGER, REAL, TEXT, BLOB, or ANY'),
    });

    const flexible = await provider.applyDraftChange(testUuid('draft-invalid-strict-type'), {
      kind: 'createTable',
      table: 'flexible_notes',
      columns: [{ name: 'title', declaredType: 'VARCHAR(255)' }],
      strict: false,
    });
    expect(flexible.sql).not.toMatch(/\bSTRICT\b/i);
  });

  test('preserves STRICT rebuild options and rejects structure it cannot reproduce losslessly', async () => {
    const resource = await createBoundResource();
    await call('execute', { operations: [
      { sql: 'CREATE TABLE strict_notes (id INTEGER PRIMARY KEY, title TEXT NOT NULL) STRICT' },
      { sql: 'CREATE TABLE collated_notes (id INTEGER PRIMARY KEY, title TEXT COLLATE NOCASE)' },
    ] });
    await provider.createDraft(resource.id, testUuid('draft-lossless'));
    const sql = await provider.applyDraftChange(testUuid('draft-lossless'), {
      kind: 'alterColumn', table: 'strict_notes', column: 'title', definition: { name: 'title', defaultSql: "''" },
    });
    expect(sql.sql).toContain(' STRICT;');
    expect((await provider.inspect(resource.id, 'draft', testUuid('draft-lossless'))).objects.find((object) => object.name === 'strict_notes')?.createSql)
      .toMatch(/\bSTRICT\b/i);
    await expect(provider.applyDraftChange(testUuid('draft-lossless'), {
      kind: 'alterColumn', table: 'collated_notes', column: 'title', definition: { name: 'title', nullable: false },
    })).rejects.toMatchObject({ code: 'DB_RESOURCE_SCHEMA_OPERATION_INVALID' });
  });

  test('keeps an existing non-STRICT table non-STRICT when a structured edit rebuilds it', async () => {
    const resource = await createBoundResource();
    await call('execute', {
      sql: 'CREATE TABLE flexible_notes (id INTEGER PRIMARY KEY, "strict" VARCHAR(255), title VARCHAR(255))',
    });
    await provider.createDraft(resource.id, testUuid('draft-flexible-rebuild'));
    const change = await provider.applyDraftChange(testUuid('draft-flexible-rebuild'), {
      kind: 'alterColumn',
      table: 'flexible_notes',
      column: 'title',
      definition: { name: 'title', nullable: false, defaultSql: "''" },
    });
    const createSql = (await provider.inspect(resource.id, 'draft', testUuid('draft-flexible-rebuild'))).objects[0]?.createSql ?? '';

    expect(change.sql).not.toMatch(/CREATE TABLE[^;]+\)\s+STRICT;/i);
    expect(createSql).not.toMatch(/\)\s*(?:WITHOUT\s+ROWID\s*,\s*)?STRICT\s*$/i);
    expect(createSql).toContain('VARCHAR');
  });

  test('reconciles ready legacy physical resources without removing user tables or rows', async () => {
    const resource = await createBoundResource();
    await call('execute', { operations: [
      { sql: 'CREATE TABLE `_vibecanvas_migrations` (schema_id TEXT, version INTEGER)' },
      { sql: 'CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT NOT NULL)' },
      { sql: 'INSERT INTO notes (id, title) VALUES (1, :title)', parameters: { title: 'preserved' } },
    ] });
    await manager.close();
    provider = new DbResource({ db, dataRoot });
    const definition = manifest();
    manager = new ActorResourceManager({ db, crypto: testCrypto, getDefinition: (name) => name === definitionName ? definition : null, providers: [provider] });
    await manager.reconcileStartup();
    await expect(call('query', { sql: "SELECT name FROM sqlite_schema WHERE name = '_vibecanvas_migrations'", parameters: {} }, 'fx')).resolves.toEqual([]);
    await expect(call('query', { sql: 'SELECT id, title FROM notes', parameters: {} }, 'fx')).resolves.toEqual([{ id: 1n, title: 'preserved' }]);
  });

  test('keeps the global open-handle count bounded across many inactive databases', async () => {
    const bounded = new DbResource({
      db,
      dataRoot: join(dataRoot, 'bounded'),
      maxOpenHandles: 2,
    });
    try {
      for (let index = 0; index < 12; index += 1) {
        const resource = { id: `resource-${index}`, kind: 'db' as const };
        await bounded.provision(resource, {});
        await bounded.dispatch({
          resource,
          requirement: {
            kind: 'db',
            required: true,
            scope: ['write'],
            arbitrarySql: true,
          },
          canRead: false,
          canWrite: true,
        }, 'execute', { sql: 'CREATE TABLE bounded_probe (id INTEGER PRIMARY KEY)' });
        expect(bounded.openHandleCount).toBeLessThanOrEqual(2);
      }
      expect(bounded.openHandleCount).toBe(2);
    } finally {
      await bounded.close();
    }
  });

  test('bounds concurrent temporary management connections with cached handles', async () => {
    const resource = { id: 'management-bounded', kind: 'db' as const };
    await provider.provision(resource, {});

    let activeConnections = 0;
    let peakConnections = 0;
    let readonlyConnections = 0;
    let releaseReads!: () => void;
    let resolveFirstTwo!: () => void;
    const readsReleased = new Promise<void>((resolve) => { releaseReads = resolve; });
    const firstTwoConnected = new Promise<void>((resolve) => { resolveFirstTwo = resolve; });
    const databaseFactory: TDatabaseFactory = (databasePath, options) => {
      const database = new Database(databasePath, options);
      const connect = database.connect.bind(database);
      const close = database.close.bind(database);
      let connected = false;
      database.connect = async () => {
        await connect();
        connected = true;
        activeConnections += 1;
        peakConnections = Math.max(peakConnections, activeConnections);
        if (options?.readonly) {
          readonlyConnections += 1;
          if (readonlyConnections === 2) resolveFirstTwo();
          await readsReleased;
        }
      };
      database.close = async () => {
        try {
          await close();
        } finally {
          if (connected) {
            connected = false;
            activeConnections -= 1;
          }
        }
      };
      return database;
    };
    const bounded = new DbResource({
      db,
      dataRoot,
      databaseFactory,
      maxOpenHandles: 2,
    });
    await bounded.dispatch({
      resource,
      requirement: {
        kind: 'db',
        required: true,
        scope: ['write'],
        arbitrarySql: true,
      },
      canRead: false,
      canWrite: true,
    }, 'execute', { sql: 'CREATE TABLE management_probe (id INTEGER PRIMARY KEY)' });
    expect(bounded.openHandleCount).toBe(1);
    const reads = Array.from({ length: 8 }, () => bounded.inspect(resource.id, 'live'));

    try {
      await firstTwoConnected;
      expect(activeConnections).toBe(2);
      expect(peakConnections).toBe(2);
      expect(bounded.openHandleCount).toBe(2);

      releaseReads();
      await expect(Promise.all(reads)).resolves.toHaveLength(8);
      expect(peakConnections).toBe(2);
      expect(activeConnections).toBe(0);
      expect(bounded.openHandleCount).toBe(0);
    } finally {
      releaseReads();
      await Promise.allSettled(reads);
      await bounded.close();
    }
  });

  test('admits a tracked readonly call after evicting its idle cached handle', async () => {
    const resource = { id: 'single-slot-read', kind: 'db' as const };
    const bounded = new DbResource({
      db,
      dataRoot: join(dataRoot, 'single-slot-read'),
      maxOpenHandles: 1,
    });
    const context = {
      resource,
      requirement: {
        kind: 'db' as const,
        required: true,
        scope: ['read', 'write'] as const,
        arbitrarySql: true,
      },
      canRead: true,
      canWrite: true,
    };

    try {
      await bounded.provision(resource, {});
      await bounded.dispatch(context, 'execute', {
        sql: 'CREATE TABLE single_slot_probe (id INTEGER PRIMARY KEY)',
      });
      await bounded.dispatch(context, 'execute', {
        sql: 'INSERT INTO single_slot_probe (id) VALUES (1)',
      });
      expect(bounded.openHandleCount).toBe(1);

      await expect(bounded.dispatch(context, 'query', {
        sql: 'SELECT id FROM single_slot_probe',
      })).resolves.toEqual([{ id: 1n }]);
      expect(bounded.openHandleCount).toBe(0);
    } finally {
      await bounded.close();
    }
  });

  test('surfaces and counts a temporary management connection close failure', async () => {
    const resource = { id: 'temporary-close-failure', kind: 'db' as const };
    await provider.provision(resource, {});

    let failClose = true;
    let createdConnections = 0;
    const databaseFactory: TDatabaseFactory = (databasePath, options) => {
      createdConnections += 1;
      const database = new Database(databasePath, options);
      const close = database.close.bind(database);
      database.close = async () => {
        if (failClose) throw new Error('injected temporary close failure');
        await close();
      };
      return database;
    };
    const bounded = new DbResource({
      db,
      dataRoot,
      databaseFactory,
      maxOpenHandles: 1,
    });

    try {
      await expect(bounded.inspect(resource.id, 'live'))
        .rejects.toThrow('injected temporary close failure');
      expect(bounded.openHandleCount).toBe(1);
      expect(createdConnections).toBe(1);

      await expect(bounded.inspect(resource.id, 'live')).rejects.toBeInstanceOf(AggregateError);
      expect(bounded.openHandleCount).toBe(1);
      expect(createdConnections).toBe(1);

      failClose = false;
      await expect(bounded.inspect(resource.id, 'live')).resolves.toBeDefined();
      expect(createdConnections).toBe(2);
      expect(bounded.openHandleCount).toBe(0);
    } finally {
      failClose = false;
      await bounded.close();
    }
  });

  test('closes an expired idle database handle without another resource call', async () => {
    const clock = manualIdleClock();
    const idle = new DbResource({
      db,
      dataRoot: join(dataRoot, 'idle'),
      idleHandleTimeoutMs: 100,
      nowMs: clock.nowMs,
      scheduleIdleSweep: clock.scheduleIdleSweep,
    });
    const resource = { id: 'idle-resource', kind: 'db' as const };
    try {
      await idle.provision(resource, {});
      await idle.dispatch({
        resource,
        requirement: {
          kind: 'db',
          required: true,
          scope: ['write'],
          arbitrarySql: true,
        },
        canRead: false,
        canWrite: true,
      }, 'execute', { sql: 'CREATE TABLE idle_probe (id INTEGER PRIMARY KEY)' });

      expect(idle.openHandleCount).toBe(1);
      await clock.advance(99);
      expect(idle.openHandleCount).toBe(1);
      await clock.advance(1);
      expect(idle.openHandleCount).toBe(0);
    } finally {
      await idle.close();
    }
  });

  test('accounts for a failed close before admitting another database handle', async () => {
    let failFirstClose = false;
    const databaseFactory: TDatabaseFactory = (databasePath, options) => {
      const database = new Database(databasePath, options);
      const close = database.close.bind(database);
      database.close = async () => {
        if (failFirstClose && databasePath.includes('/first/')) {
          throw new Error('injected close failure');
        }
        await close();
      };
      return database;
    };
    const bounded = new DbResource({
      db,
      dataRoot: join(dataRoot, 'close-failure'),
      databaseFactory,
      maxOpenHandles: 1,
    });
    const first = { id: 'first', kind: 'db' as const };
    const second = { id: 'second', kind: 'db' as const };
    const dispatch = (resource: typeof first) => bounded.dispatch({
      resource,
      requirement: {
        kind: 'db',
        required: true,
        scope: ['write'],
        arbitrarySql: true,
      },
      canRead: false,
      canWrite: true,
    }, 'execute', { sql: 'CREATE TABLE capacity_probe (id INTEGER PRIMARY KEY)' });

    try {
      await bounded.provision(first, {});
      await bounded.provision(second, {});
      await dispatch(first);
      failFirstClose = true;
      await expect(dispatch(second)).rejects.toBeInstanceOf(Error);
      expect(bounded.openHandleCount).toBe(1);

      failFirstClose = false;
      await expect(dispatch(second)).resolves.toBeDefined();
      expect(bounded.openHandleCount).toBe(1);
    } finally {
      failFirstClose = false;
      await bounded.close();
    }
  });
});
