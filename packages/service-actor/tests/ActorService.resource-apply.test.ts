import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import { Database } from '@vibecanvas/service-db/DbServiceTurso/turso-native';
import { EventPublisherService } from '@vibecanvas/service-event-publisher/EventPublisherService';
import { ActorService } from '../src/ActorService';
import type { TDatabaseFactory } from '../src/resources/DbResource';

const DEFINITION_NAME = 'Structure Draft Notes Test';

function manifest() {
  return {
    slug: 'structure-draft-notes-test',
    name: DEFINITION_NAME,
    actor: {
      relFunctionPath: './actor/functions.ts',
      initialState: 'ready',
      initialData: {},
      resources: {
        notes: { kind: 'db', required: true, scope: ['read', 'write'], arbitrarySql: true },
      },
      states: { ready: { on: {} } },
    },
    widget: { relWidgetDir: './widget', tool: { label: 'Draft Notes', behavior: { type: 'action' } } },
  } as const;
}

describe('ActorService DbResource coordinated apply lifecycle', () => {
  let rootDir = '';
  let dataRoot = '';
  let functionsPath = '';
  let db: DbServiceTurso;
  let service: ActorService;
  let beforePrepare: ((databasePath: string, sql: string) => Promise<void>) | null;
  let afterRun: ((databasePath: string, sql: string, args: readonly unknown[]) => Promise<void>) | null;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'vibecanvas-actor-service-db-apply-'));
    const configPath = join(rootDir, 'config');
    dataRoot = join(rootDir, 'data');
    const widgetDir = join(configPath, 'widgets', 'draft-notes');
    await mkdir(join(widgetDir, 'actor'), { recursive: true });
    await mkdir(join(widgetDir, 'widget'), { recursive: true });
    await mkdir(dataRoot, { recursive: true });
    await writeFile(join(widgetDir, 'vibecanvas.json'), `${JSON.stringify(manifest(), null, 2)}\n`, 'utf8');
    functionsPath = join(widgetDir, 'actor', 'functions.ts');
    await writeFile(functionsPath, 'export default { fn: {}, fx: {}, tx: {} };\n', 'utf8');
    db = new DbServiceTurso({ databasePath: ':memory:', dataDir: dataRoot, cacheDir: dataRoot });
    await db.start();
    beforePrepare = null;
    afterRun = null;
    const databaseFactory: TDatabaseFactory = (databasePath, options) => {
      const database = new Database(databasePath, options);
      const prepare = database.prepare.bind(database);
      const run = database.run.bind(database);
      database.prepare = (async (...args: Parameters<typeof prepare>) => {
        await beforePrepare?.(databasePath, String(args[0]));
        return prepare(...args);
      }) as typeof database.prepare;
      database.run = (async (...args: Parameters<typeof run>) => {
        const result = await run(...args);
        await afterRun?.(databasePath, String(args[0]), args.slice(1));
        return result;
      }) as typeof database.run;
      return database;
    };
    service = new ActorService({ db, configPath, dataRoot, dbResourceDatabaseFactory: databaseFactory, eventPublisherService: new EventPublisherService() });
    await service.start({} as never);
  });

  afterEach(async () => {
    await service.stop().catch(() => undefined);
    await db.db.close().catch(() => undefined);
    await rm(rootDir, { recursive: true, force: true });
  });

  async function waitForApply(applyId: string) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const details = await service.getDbApply(applyId);
      if (['succeeded', 'failed', 'recovered'].includes(details.apply.status)) return details;
      await Bun.sleep(10);
    }
    throw new Error('apply did not finish');
  }

  test('previews impact, applies exact draft SQL, persists stopped-instance outcomes, and restores retained backup', async () => {
    await db.canvas.create({ id: 'draft-canvas', name: 'Draft Canvas', automerge_url: 'automerge:db-draft-test' });
    const resource = await service.createResource({ kind: 'db', name: 'Shared Draft Notes' });
    await service.bindResource({ definitionName: DEFINITION_NAME, slot: 'notes', resourceId: resource.id });
    const runningActor = await service.createInstance(DEFINITION_NAME, 'draft-canvas', 'running-element');
    expect(runningActor).not.toBeNull();
    const runningInstanceId = runningActor!.getId();
    await db.actor.insertInstance({
      id: 'stopped-draft-instance',
      canvas_id: 'draft-canvas',
      element_id: 'stopped-element',
      actor_definition_name: DEFINITION_NAME,
      filesystem_id: null,
      display_name: 'Stopped Draft Notes',
      status: 'stopped',
      machine_state: 'ready',
      machine_context: {},
    });

    const draft = await service.createDbDraft(resource.id, 'Add notes table');
    const change = await service.changeDbDraft(draft.draft.id, {
      kind: 'createTable',
      table: 'notes',
      columns: [
        { name: 'id', declaredType: 'INTEGER', nullable: false, primaryKeyOrder: 1 },
        { name: 'title', declaredType: 'TEXT', nullable: false },
      ],
    });
    expect(change.sql).toContain('CREATE TABLE');
    expect((await service.inspectDbResource({ resourceId: resource.id, target: 'live' }))?.objects).toEqual([]);
    expect((await service.inspectDbResource({ resourceId: resource.id, target: 'draft', draftId: draft.draft.id }))?.objects[0].name).toBe('notes');

    const preview = await service.previewDbApply(draft.draft.id);
    expect(preview.compatibilityNotice).toContain('cannot be guaranteed');
    expect(preview.impact.definitions).toEqual([{ definitionName: DEFINITION_NAME, slots: [{ slot: 'notes', scope: ['read', 'write'] }] }]);
    expect(preview.impact.instances).toEqual(expect.arrayContaining([
      expect.objectContaining({ instanceId: runningInstanceId, running: true }),
      expect.objectContaining({ instanceId: 'stopped-draft-instance', running: false }),
    ]));

    const started = await service.confirmDbApply(draft.draft.id);
    const completed = await waitForApply(started.id);
    expect(completed.apply.status).toBe('succeeded');
    expect(completed.apply.backup_retained).toBe(true);
    expect(completed.instances).toEqual(expect.arrayContaining([
      expect.objectContaining({ actor_instance_id: runningInstanceId, status: 'restarted', was_running: true }),
      expect.objectContaining({ actor_instance_id: 'stopped-draft-instance', status: 'notRunning', was_running: false }),
    ]));
    expect((await service.inspectDbResource({ resourceId: resource.id, target: 'live' }))?.objects[0].name).toBe('notes');

    const backup = await service.getDbBackup(resource.id);
    expect(backup?.applyId).toBe(started.id);
    await service.createDbRow({ resourceId: resource.id, object: 'notes', values: { id: { type: 'integer', value: '1' }, title: { type: 'text', value: 'newer write' } } });
    const restorePreview = await service.previewDbBackupRestore(resource.id, started.id);
    expect(restorePreview.warning).toContain('permanently loses');
    const restore = await service.restoreDbBackup(resource.id, started.id);
    expect((await waitForApply(restore.id)).apply.status).toBe('succeeded');
    expect((await service.inspectDbResource({ resourceId: resource.id, target: 'live' }))?.objects).toEqual([]);
  });

  test('applies a table assembled from structured and advanced draft changes', async () => {
    const resource = await service.createResource({ kind: 'db', name: 'Mixed Draft Notes' });
    const draft = await service.createDbDraft(resource.id, 'Build notes incrementally');
    await service.changeDbDraft(draft.draft.id, {
      kind: 'createTable',
      table: 'browser_final_notes',
      columns: [{ name: 'id', declaredType: 'INTEGER', nullable: false, primaryKeyOrder: 1 }],
    });
    await service.changeDbDraft(draft.draft.id, {
      kind: 'addColumn',
      table: 'browser_final_notes',
      column: { name: 'title', declaredType: 'TEXT', nullable: false },
    });
    await service.executeDbDraftSql(draft.draft.id, 'ALTER TABLE browser_final_notes ADD COLUMN amount REAL;');
    await service.executeDbDraftSql(draft.draft.id, 'ALTER TABLE browser_final_notes ADD COLUMN payload BLOB;');

    const started = await service.confirmDbApply(draft.draft.id);
    const completed = await waitForApply(started.id);
    expect(completed.apply).toMatchObject({ status: 'succeeded', backup_retained: true, last_error: null });
    expect((await service.inspectDbResource({ resourceId: resource.id, target: 'live' }))?.objects).toEqual([
      expect.objectContaining({
        name: 'browser_final_notes',
        columns: [
          expect.objectContaining({ name: 'id', declaredType: 'INTEGER', primaryKeyOrder: 1 }),
          expect.objectContaining({ name: 'title', declaredType: 'TEXT', nullable: false }),
          expect.objectContaining({ name: 'amount', declaredType: 'REAL' }),
          expect.objectContaining({ name: 'payload', declaredType: 'BLOB' }),
        ],
      }),
    ]);
  });

  test('persists bound SQLite parameters and commits them through the coordinated apply record', async () => {
    const resource = await service.createResource({ kind: 'db', name: 'Bound Parameter Notes' });
    const schemaDraft = await service.createDbDraft(resource.id, 'Create parameter notes');
    await service.changeDbDraft(schemaDraft.draft.id, {
      kind: 'createTable',
      table: 'notes',
      columns: [
        { name: 'id', declaredType: 'INTEGER', nullable: false, primaryKeyOrder: 1 },
        { name: 'title', declaredType: 'TEXT', nullable: false },
      ],
    });
    const schemaApply = await service.confirmDbApply(schemaDraft.draft.id);
    expect((await waitForApply(schemaApply.id)).apply.status).toBe('succeeded');

    const dataDraft = await service.createDbDraft(resource.id, 'Write parameter notes');
    const parameters = [{ type: 'integer', value: '7' }, { type: 'text', value: 'Bound value' }] as const;
    await service.executeDbDraftSql(dataDraft.draft.id, 'INSERT INTO notes(id, title) VALUES (?, ?)', parameters);
    expect((await service.getDbDraft(dataDraft.draft.id)).changes).toEqual([
      expect.objectContaining({
        kind: 'sql',
        sql: 'INSERT INTO notes(id, title) VALUES (?, ?)',
        operation: { type: 'boundSql', parameters },
      }),
    ]);

    const dataApply = await service.confirmDbApply(dataDraft.draft.id);
    expect((await waitForApply(dataApply.id)).apply).toMatchObject({ status: 'succeeded', draft_id: dataDraft.draft.id });
    await expect(service.executeDbLiveSql({
      resourceId: resource.id,
      sql: 'SELECT id, title FROM notes WHERE id = ?',
      parameters: [{ type: 'integer', value: '7' }],
      approved: false,
    })).resolves.toMatchObject({
      kind: 'rows',
      rows: [{ id: { type: 'integer', value: '7' }, title: { type: 'text', value: 'Bound value' } }],
    });
  });

  test('rejects multiple statements in one draft write with or without parameters', async () => {
    const resource = await service.createResource({ kind: 'db', name: 'Single Statement Notes' });
    const draft = await service.createDbDraft(resource.id, 'Reject compound writes');
    const compoundSql = 'CREATE TABLE first_note(id INTEGER); CREATE TABLE second_note(id INTEGER);';

    await expect(service.executeDbDraftSql(draft.draft.id, compoundSql)).rejects.toMatchObject({
      code: 'DB_OPERATION_PARAMETERS_INVALID',
    });
    await expect(service.executeDbDraftSql(draft.draft.id, compoundSql, [])).rejects.toMatchObject({
      code: 'DB_OPERATION_PARAMETERS_INVALID',
    });
    expect((await service.getDbDraft(draft.draft.id)).changes).toEqual([]);
  });

  test('keeps a successful database outcome separate from an actor restart failure', async () => {
    await db.canvas.create({ id: 'restart-canvas', name: 'Restart Canvas', automerge_url: 'automerge:db-restart-test' });
    const resource = await service.createResource({ kind: 'db', name: 'Restart Outcome Notes' });
    await service.bindResource({ definitionName: DEFINITION_NAME, slot: 'notes', resourceId: resource.id });
    const actor = await service.createInstance(DEFINITION_NAME, 'restart-canvas', 'restart-element');
    expect(actor).not.toBeNull();
    const actorId = actor!.getId();
    const draft = await service.createDbDraft(resource.id, 'Create notes');
    await service.changeDbDraft(draft.draft.id, {
      kind: 'createTable',
      table: 'notes',
      columns: [{ name: 'id', declaredType: 'INTEGER', nullable: false, primaryKeyOrder: 1 }],
    });
    await rm(functionsPath);
    const apply = await service.confirmDbApply(draft.draft.id);
    const completed = await waitForApply(apply.id);
    expect(completed.apply.status).toBe('succeeded');
    expect(completed.instances).toEqual([
      expect.objectContaining({ actor_instance_id: actorId, status: 'startFailed', was_running: true }),
    ]);
    expect((await service.inspectDbResource({ resourceId: resource.id, target: 'live' }))?.objects[0].name).toBe('notes');
  });

  test('recovers a committed apply outcome when post-apply bookkeeping fails', async () => {
    const resource = await service.createResource({ kind: 'db', name: 'Bookkeeping Failure Notes' });
    const draft = await service.createDbDraft(resource.id, 'Create notes before bookkeeping failure');
    await service.changeDbDraft(draft.draft.id, {
      kind: 'createTable',
      table: 'notes',
      columns: [{ name: 'id', declaredType: 'INTEGER', nullable: false, primaryKeyOrder: 1 }],
    });

    const update = db.dbResource.apply.update;
    let failRestartingUpdate = true;
    db.dbResource.apply.update = async (args) => {
      if (args.status === 'restarting' && failRestartingUpdate) {
        failRestartingUpdate = false;
        throw new Error('simulated metadata write failure');
      }
      return update(args);
    };

    const started = await service.confirmDbApply(draft.draft.id);
    const completed = await waitForApply(started.id);
    expect(completed.apply).toMatchObject({ status: 'succeeded', backup_retained: true });
    expect(await service.getDbBackup(resource.id)).toMatchObject({ applyId: started.id });
  });

  test('restarts a bound running actor after committed apply bookkeeping fails', async () => {
    await db.canvas.create({ id: 'apply-bookkeeping-canvas', name: 'Apply bookkeeping', automerge_url: 'automerge:apply-bookkeeping' });
    const resource = await service.createResource({ kind: 'db', name: 'Bound Apply Bookkeeping' });
    await service.bindResource({ definitionName: DEFINITION_NAME, slot: 'notes', resourceId: resource.id });
    const actor = await service.createInstance(DEFINITION_NAME, 'apply-bookkeeping-canvas', 'apply-bookkeeping-element');
    expect(actor).not.toBeNull();
    const actorId = actor!.getId();
    const draft = await service.createDbDraft(resource.id, 'Committed apply');

    const update = db.dbResource.apply.update;
    let failRestartingUpdate = true;
    db.dbResource.apply.update = async (args) => {
      if (args.status === 'restarting' && failRestartingUpdate) {
        failRestartingUpdate = false;
        throw new Error('simulated post-commit apply bookkeeping failure');
      }
      return update(args);
    };

    const started = await service.confirmDbApply(draft.draft.id);
    const completed = await waitForApply(started.id);
    expect(completed.apply.status).toBe('succeeded');
    expect(completed.instances).toEqual([
      expect.objectContaining({ actor_instance_id: actorId, was_running: true, status: 'restarted' }),
    ]);
    expect(await db.actor.getInstanceById(actorId)).toMatchObject({ status: 'running' });
  });

  test('restarts a bound running actor after committed restore bookkeeping fails', async () => {
    await db.canvas.create({ id: 'restore-bookkeeping-canvas', name: 'Restore bookkeeping', automerge_url: 'automerge:restore-bookkeeping' });
    const resource = await service.createResource({ kind: 'db', name: 'Bound Restore Bookkeeping' });
    await service.bindResource({ definitionName: DEFINITION_NAME, slot: 'notes', resourceId: resource.id });
    const actor = await service.createInstance(DEFINITION_NAME, 'restore-bookkeeping-canvas', 'restore-bookkeeping-element');
    expect(actor).not.toBeNull();
    const actorId = actor!.getId();
    const draft = await service.createDbDraft(resource.id, 'Retained restore source');
    const source = await service.confirmDbApply(draft.draft.id);
    expect((await waitForApply(source.id)).apply.status).toBe('succeeded');

    const updateProviderState = db.actorResource.updateProviderState;
    let failReadyUpdate = true;
    db.actorResource.updateProviderState = async (args) => {
      if (args.id === resource.id && args.status === 'ready' && failReadyUpdate) {
        failReadyUpdate = false;
        throw new Error('simulated post-restore ready bookkeeping failure');
      }
      return updateProviderState(args);
    };

    const restore = await service.restoreDbBackup(resource.id, source.id);
    const completed = await waitForApply(restore.id);
    expect(completed.apply.status).toBe('succeeded');
    expect(completed.instances).toEqual([
      expect.objectContaining({ actor_instance_id: actorId, was_running: true, status: 'restarted' }),
    ]);
    expect(await db.actor.getInstanceById(actorId)).toMatchObject({ status: 'running' });
  });

  test('keeps a bound actor stopped when post-commit apply health and backup recovery both fail', async () => {
    await db.canvas.create({ id: 'unrecoverable-apply-canvas', name: 'Unrecoverable apply', automerge_url: 'automerge:unrecoverable-apply' });
    const resource = await service.createResource({ kind: 'db', name: 'Unrecoverable Apply Notes' });
    await service.bindResource({ definitionName: DEFINITION_NAME, slot: 'notes', resourceId: resource.id });
    const actor = await service.createInstance(DEFINITION_NAME, 'unrecoverable-apply-canvas', 'unrecoverable-apply-element');
    expect(actor).not.toBeNull();
    const actorId = actor!.getId();
    const draft = await service.createDbDraft(resource.id, 'Apply that cannot recover');
    await service.changeDbDraft(draft.draft.id, {
      kind: 'createTable',
      table: 'notes',
      columns: [{ name: 'id', declaredType: 'INTEGER', nullable: false, primaryKeyOrder: 1 }],
    });

    const livePath = join(dataRoot, 'actor-resources', 'db', resource.id, 'data.db');
    let committedApplyId: string | null = null;
    let failPostCommitHealth = true;
    afterRun = async (databasePath, sql, args) => {
      if (databasePath === livePath && sql.includes('INSERT INTO `_vibecanvas_apply_markers`')) {
        committedApplyId = String(args[0]);
      }
    };
    beforePrepare = async (databasePath, sql) => {
      if (databasePath !== livePath || sql.trim() !== 'PRAGMA quick_check;' || committedApplyId === null || !failPostCommitHealth) return;
      failPostCommitHealth = false;
      await rm(join(dataRoot, 'actor-resources', 'db', resource.id, 'backups', committedApplyId), { recursive: true, force: true });
      throw new Error('simulated post-commit health and backup recovery failure');
    };

    const started = await service.confirmDbApply(draft.draft.id);
    const completed = await waitForApply(started.id);
    expect(String(committedApplyId)).toBe(started.id);
    expect(completed.apply).toMatchObject({ status: 'failed', last_error: { code: 'DB_RESOURCE_RECOVERY_FAILED' } });
    expect(completed.instances).toEqual([
      expect.objectContaining({ actor_instance_id: actorId, was_running: true, status: 'stopped' }),
    ]);
    expect(await service.getResource(resource.id)).toMatchObject({ status: 'error', last_error: { code: 'DB_RESOURCE_RECOVERY_FAILED' } });
    expect(await db.actor.getInstanceById(actorId)).toMatchObject({ status: 'blocked' });
    expect(service.listenToActorEvents(actorId, () => undefined)).toBeNull();

    const physical = new Database(livePath, { fileMustExist: true });
    await physical.connect();
    const marker = await physical.prepare('SELECT apply_id FROM `_vibecanvas_apply_markers` WHERE apply_id = ?');
    expect(await marker.get(started.id)).toEqual({ apply_id: started.id });
    marker.close();
    await physical.close();
  });

  test('keeps a bound actor stopped when restore copy verification remains unrecoverable', async () => {
    await db.canvas.create({ id: 'unrecoverable-restore-canvas', name: 'Unrecoverable restore', automerge_url: 'automerge:unrecoverable-restore' });
    const resource = await service.createResource({ kind: 'db', name: 'Unrecoverable Restore Notes' });
    await service.bindResource({ definitionName: DEFINITION_NAME, slot: 'notes', resourceId: resource.id });
    const actor = await service.createInstance(DEFINITION_NAME, 'unrecoverable-restore-canvas', 'unrecoverable-restore-element');
    expect(actor).not.toBeNull();
    const actorId = actor!.getId();
    const draft = await service.createDbDraft(resource.id, 'Retained restore source');
    const source = await service.confirmDbApply(draft.draft.id);
    expect((await waitForApply(source.id)).apply.status).toBe('succeeded');

    const livePath = join(dataRoot, 'actor-resources', 'db', resource.id, 'data.db');
    beforePrepare = async (databasePath, sql) => {
      if (databasePath === livePath && sql.trim() === 'PRAGMA quick_check;') {
        throw new Error('simulated persistent restore destination verification failure');
      }
    };

    const restore = await service.restoreDbBackup(resource.id, source.id);
    const completed = await waitForApply(restore.id);
    expect(completed.apply).toMatchObject({ status: 'failed', last_error: { code: 'DB_RESOURCE_RESTORE_FAILED' } });
    expect(completed.instances).toEqual([
      expect.objectContaining({ actor_instance_id: actorId, was_running: true, status: 'stopped' }),
    ]);
    expect(await service.getResource(resource.id)).toMatchObject({ status: 'error', last_error: { code: 'DB_RESOURCE_RESTORE_FAILED' } });
    expect(await db.actor.getInstanceById(actorId)).toMatchObject({ status: 'blocked' });
    expect(service.listenToActorEvents(actorId, () => undefined)).toBeNull();

    const physical = new Database(livePath, { fileMustExist: true });
    await physical.connect();
    const marker = await physical.prepare('SELECT apply_id FROM `_vibecanvas_apply_markers` WHERE apply_id = ?');
    expect(await marker.get(restore.id)).toBeUndefined();
    marker.close();
    await physical.close();
  });

  test('finds retained backup metadata beyond the newest history page', async () => {
    const resource = await service.createResource({ kind: 'db', name: 'Deep Backup History' });
    const draft = await service.createDbDraft(resource.id, 'Retained physical backup');
    const retained = await service.confirmDbApply(draft.draft.id);
    expect((await waitForApply(retained.id)).apply.status).toBe('succeeded');
    for (let index = 0; index < 100; index += 1) {
      const id = `newer-${index.toString().padStart(3, '0')}`;
      await db.dbResource.apply.create({ id, resourceId: resource.id });
      await db.dbResource.apply.update({ id, status: 'succeeded' });
    }
    expect(await service.getDbBackup(resource.id)).toMatchObject({ applyId: retained.id });
  });

  test('reconciles an interrupted apply before restarting its previously blocked actor', async () => {
    await db.canvas.create({ id: 'recovery-canvas', name: 'Recovery Canvas', automerge_url: 'automerge:db-recovery-test' });
    const resource = await service.createResource({ kind: 'db', name: 'Interrupted Recovery Notes' });
    await service.bindResource({ definitionName: DEFINITION_NAME, slot: 'notes', resourceId: resource.id });
    const actor = await service.createInstance(DEFINITION_NAME, 'recovery-canvas', 'recovery-element');
    expect(actor).not.toBeNull();
    const actorId = actor!.getId();

    await service.stop();
    await db.actor.updateInstanceHealth({
      id: actorId,
      status: 'blocked',
      last_error: {
        phase: 'instance-start',
        code: 'DB_RESOURCE_MIGRATING',
        message: 'Interrupted apply blocked this actor.',
        retryable: true,
        occurredAt: new Date().toISOString(),
      },
    });
    await db.actorResource.updateProviderState({ id: resource.id, status: 'migrating', lastError: null });
    const apply = await db.dbResource.apply.create({
      id: crypto.randomUUID(),
      resourceId: resource.id,
      draftId: null,
      status: 'preparing',
    });
    await db.dbResource.apply.instanceResult.upsert({
      applyId: apply.id,
      actorInstanceId: actorId,
      actorDefinitionName: DEFINITION_NAME,
      wasRunning: true,
      status: 'stopped',
      error: null,
    });

    service = new ActorService({
      db,
      configPath: join(rootDir, 'config'),
      dataRoot,
      eventPublisherService: new EventPublisherService(),
    });
    await service.start({} as never);

    expect(await service.getResource(resource.id)).toMatchObject({ status: 'ready' });
    expect((await service.getDbApply(apply.id)).apply.status).toBe('failed');
    expect((await service.getDbApply(apply.id)).instances).toEqual([
      expect.objectContaining({ actor_instance_id: actorId, status: 'restarted', was_running: true }),
    ]);
    expect(await db.actor.getInstanceById(actorId)).toMatchObject({ status: 'running', last_error: null });
    expect(service.listenToActorEvents(actorId, () => undefined)).toBeFunction();
  });

  test('detects physical draft evidence that was not durably appended to the control log after restart', async () => {
    const resource = await service.createResource({ kind: 'db', name: 'Draft Evidence Notes' });
    const draft = await service.createDbDraft(resource.id, 'Crash-window evidence');
    await service.stop();

    const physical = new Database(join(dataRoot, 'actor-resources', 'db-drafts', draft.draft.id, 'data.db'), {
      fileMustExist: true,
      // @ts-expect-error Turso runtime features are ahead of its public union.
      experimental: ['custom_types', 'triggers', 'index_method', 'multiprocess_wal'],
    });
    await physical.connect();
    const mutate = physical.transaction(async () => {
      await physical.exec('CREATE TABLE orphaned_change (id INTEGER PRIMARY KEY);');
      await physical.run(
        'INSERT INTO `_vibecanvas_draft_change_evidence` (`sequence`, `kind`, `sql`) VALUES (?, ?, ?)',
        1,
        'sql',
        'CREATE TABLE orphaned_change (id INTEGER PRIMARY KEY);',
      );
    });
    await mutate();
    await physical.close();

    service = new ActorService({
      db,
      configPath: join(rootDir, 'config'),
      dataRoot,
      eventPublisherService: new EventPublisherService(),
    });
    await service.start({} as never);
    expect(await db.dbResource.draft.get({ id: draft.draft.id })).toMatchObject({
      status: 'error',
      last_error: { code: 'DB_RESOURCE_DRAFT_INVALID' },
    });
    expect((await service.getDbDraft(draft.draft.id)).changes).toEqual([]);
  });

  test('mutually excludes drafts, applies, restores, deletion, and non-ready resources', async () => {
    const resource = await service.createResource({ kind: 'db', name: 'Admission Notes' });
    const activeBeforeDraft = await db.dbResource.apply.create({ id: 'active-before-draft', resourceId: resource.id });
    await expect(service.createDbDraft(resource.id, 'Blocked draft')).rejects.toMatchObject({ code: 'DB_RESOURCE_APPLY_IN_PROGRESS' });
    await expect(service.deleteResource(resource.id)).rejects.toMatchObject({ code: 'RESOURCE_NOT_READY' });
    await db.dbResource.apply.update({ id: activeBeforeDraft.id, status: 'failed' });

    const draft = await service.createDbDraft(resource.id, 'Apply admission');
    await expect(service.deleteResource(resource.id)).rejects.toMatchObject({ code: 'RESOURCE_NOT_READY' });
    const competing = await db.dbResource.apply.create({ id: 'competing-apply', resourceId: resource.id });
    await expect(service.confirmDbApply(draft.draft.id)).rejects.toMatchObject({ code: 'DB_RESOURCE_APPLY_IN_PROGRESS' });
    await db.dbResource.apply.update({ id: competing.id, status: 'failed' });
    const retained = await service.confirmDbApply(draft.draft.id);
    expect((await waitForApply(retained.id)).apply.status).toBe('succeeded');

    const restoreBlockingDraft = await service.createDbDraft(resource.id, 'Blocks restore');
    await expect(service.restoreDbBackup(resource.id, retained.id)).rejects.toMatchObject({ code: 'DB_RESOURCE_DRAFT_EXISTS' });
    await service.discardDbDraft(restoreBlockingDraft.draft.id);
    const activeBeforeRestore = await db.dbResource.apply.create({ id: 'active-before-restore', resourceId: resource.id });
    await expect(service.restoreDbBackup(resource.id, retained.id)).rejects.toMatchObject({ code: 'DB_RESOURCE_APPLY_IN_PROGRESS' });
    await db.dbResource.apply.update({ id: activeBeforeRestore.id, status: 'failed' });
    await db.actorResource.updateProviderState({ id: resource.id, status: 'error', lastError: { code: 'TEST', message: 'not ready' } });
    await expect(service.restoreDbBackup(resource.id, retained.id)).rejects.toMatchObject({ code: 'RESOURCE_NOT_READY' });
  });

  test('clears phantom retained-backup metadata before get or restore preview', async () => {
    const resource = await service.createResource({ kind: 'db', name: 'Phantom Backup Notes' });
    const draft = await service.createDbDraft(resource.id, 'Physical backup');
    const retained = await service.confirmDbApply(draft.draft.id);
    expect((await waitForApply(retained.id)).apply.status).toBe('succeeded');
    await rm(join(dataRoot, 'actor-resources', 'db', resource.id, 'backups', retained.id), { recursive: true, force: true });
    expect(await service.getDbBackup(resource.id)).toBeNull();
    expect(await db.dbResource.apply.get({ id: retained.id })).toMatchObject({ backup_retained: false });
    await expect(service.previewDbBackupRestore(resource.id, retained.id)).rejects.toMatchObject({ code: 'DB_RESOURCE_RESTORE_FAILED' });
  });

  test('shutdown drains accepted apply work and rejects later coordinator work', async () => {
    const resource = await service.createResource({ kind: 'db', name: 'Shutdown Apply Notes' });
    const draft = await service.createDbDraft(resource.id, 'Accepted before shutdown');
    const apply = await service.confirmDbApply(draft.draft.id);
    await service.stop();
    expect(await db.dbResource.apply.get({ id: apply.id })).toMatchObject({ status: 'succeeded' });
    await expect(service.getDbApply(apply.id)).rejects.toMatchObject({ code: 'DB_RESOURCE_UNAVAILABLE' });
    await expect(service.createDbDraft(resource.id, 'Rejected after shutdown')).rejects.toMatchObject({ code: 'DB_RESOURCE_UNAVAILABLE' });
  });
});
