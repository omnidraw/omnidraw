import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import { EventPublisherService } from '@vibecanvas/service-event-publisher/EventPublisherService';
import { ActorService } from '../src/ActorService';

const DEFINITION_NAME = 'Migration Notes Test';
const SCHEMA_ID = 'migration-notes';

function manifest(schemaVersion: number) {
  return {
    slug: 'migration-notes-test',
    name: DEFINITION_NAME,
    actor: {
      relFunctionPath: './actor/functions.ts',
      initialState: 'ready',
      initialData: {},
      resources: {
        notes: {
          kind: 'db',
          required: true,
          scope: ['read', 'write'],
          schema: { id: SCHEMA_ID, version: schemaVersion },
          operations: {
            listNotes: {
              effect: 'read',
              sql: 'SELECT id, title FROM notes ORDER BY id',
              result: 'rows',
            },
          },
        },
      },
      states: {
        ready: { on: {} },
      },
    },
    widget: {
      relWidgetDir: './widget',
      tool: {
        label: 'Migration Notes Test',
        behavior: { type: 'action' },
      },
    },
  } as const;
}

describe('ActorService DbResource migration lifecycle', () => {
  let rootDir = '';
  let configPath = '';
  let dataRoot = '';
  let manifestPath = '';
  let db: DbServiceTurso | null = null;
  let service: ActorService | null = null;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'vibecanvas-actor-service-db-resource-'));
    configPath = join(rootDir, 'config');
    dataRoot = join(rootDir, 'data');
    const widgetDir = join(configPath, 'widgets', 'migration-notes');
    manifestPath = join(widgetDir, 'vibecanvas.json');
    await mkdir(join(widgetDir, 'actor'), { recursive: true });
    await mkdir(join(widgetDir, 'widget'), { recursive: true });
    await mkdir(dataRoot, { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest(1), null, 2)}\n`, 'utf8');
    await writeFile(
      join(widgetDir, 'actor', 'functions.ts'),
      'export default { fn: {}, fx: {}, tx: {} };\n',
      'utf8',
    );

    db = new DbServiceTurso({
      databasePath: ':memory:',
      dataDir: dataRoot,
      cacheDir: dataRoot,
    });
    await db.start();
    service = new ActorService({
      db,
      configPath,
      dataRoot,
      eventPublisherService: new EventPublisherService(),
    });
    await service.start({} as never);
  });

  afterEach(async () => {
    await service?.stop().catch(() => undefined);
    await db?.db.close().catch(() => undefined);
    await rm(rootDir, { recursive: true, force: true });
  });

  test('previews every persisted instance and durably restarts only the previously running compatible instance', async () => {
    if (!db || !service) throw new Error('test services were not initialized');

    await db.canvas.create({
      id: 'migration-canvas',
      name: 'Migration Canvas',
      automerge_url: 'automerge:actor-service-resource-migration',
    });

    const initialSql = 'CREATE TABLE notes (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL) STRICT;';
    await service.createDbSchema({ id: SCHEMA_ID, name: 'Migration Notes' });
    await service.createDbMigrationDraft({
      schemaId: SCHEMA_ID,
      version: 1,
      name: 'initial',
      sql: initialSql,
    });
    await service.publishDbSchema(SCHEMA_ID);

    const secondSql = 'ALTER TABLE notes ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;';
    await service.createDbMigrationDraft({
      schemaId: SCHEMA_ID,
      version: 2,
      name: 'add-archived',
      sql: secondSql,
    });
    await service.publishDbMigration({ schemaId: SCHEMA_ID, version: 2 });

    const resource = await service.createResource({
      kind: 'db',
      name: 'Shared Migration Notes',
      db: { schemaId: SCHEMA_ID, version: 1 },
    });
    await service.bindResource({
      definitionName: DEFINITION_NAME,
      slot: 'notes',
      resourceId: resource.id,
    });

    const runningActor = await service.createInstance(
      DEFINITION_NAME,
      'migration-canvas',
      'running-element',
    );
    expect(runningActor).not.toBeNull();
    const runningInstanceId = runningActor!.getId();
    const stoppedInstanceId = 'stopped-migration-instance';
    await db.actor.insertInstance({
      id: stoppedInstanceId,
      canvas_id: 'migration-canvas',
      element_id: 'stopped-element',
      actor_definition_name: DEFINITION_NAME,
      filesystem_id: null,
      display_name: 'Stopped Migration Notes',
      status: 'stopped',
      machine_state: 'ready',
      machine_context: {},
    });

    const preview = await service.previewDbResourceMigration(resource.id, 2);
    expect(preview.affectedDefinitions).toEqual([
      {
        definitionName: DEFINITION_NAME,
        slots: ['notes'],
        expectedSchemaId: SCHEMA_ID,
        expectedVersion: 1,
        compatibleAfterMigration: false,
      },
    ]);
    expect(preview.affectedInstances).toEqual(expect.arrayContaining([
      expect.objectContaining({
        instanceId: runningInstanceId,
        running: true,
        restartWhenCompatible: true,
      }),
      expect.objectContaining({
        instanceId: stoppedInstanceId,
        running: false,
        restartWhenCompatible: false,
      }),
    ]));

    const migrated = await service.migrateDbResource(resource.id, 2);
    expect(migrated.configuration).toMatchObject({
      schema_id: SCHEMA_ID,
      applied_version: 2,
      target_version: 2,
    });
    expect(await db.actor.getInstanceById(runningInstanceId)).toMatchObject({ status: 'blocked' });
    expect(await db.actor.getInstanceById(stoppedInstanceId)).toMatchObject({ status: 'stopped' });
    const migrationBlocks = await db.dbResource.migrationBlock.listByResource({ resourceId: resource.id });
    expect(migrationBlocks).toHaveLength(2);
    expect(migrationBlocks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actor_instance_id: runningInstanceId,
        reason: 'versionMismatch',
        restart_when_compatible: true,
        expected_version: 1,
        actual_version: 2,
      }),
      expect.objectContaining({
        actor_instance_id: stoppedInstanceId,
        reason: 'versionMismatch',
        restart_when_compatible: false,
        expected_version: 1,
        actual_version: 2,
      }),
    ]));
    expect(service.listenToActorEvents(runningInstanceId, () => undefined)).toBeNull();

    await service.stop();
    service = new ActorService({
      db,
      configPath,
      dataRoot,
      eventPublisherService: new EventPublisherService(),
    });
    await service.start({} as never);
    expect(service.listenToActorEvents(runningInstanceId, () => undefined)).toBeNull();

    await writeFile(manifestPath, `${JSON.stringify(manifest(2), null, 2)}\n`, 'utf8');
    await service.reload();

    expect(await db.actor.getInstanceById(runningInstanceId)).toMatchObject({ status: 'running' });
    expect(await db.actor.getInstanceById(stoppedInstanceId)).toMatchObject({ status: 'stopped' });
    expect(await db.dbResource.migrationBlock.listByResource({ resourceId: resource.id })).toEqual([]);
    const unsubscribe = service.listenToActorEvents(runningInstanceId, () => undefined);
    expect(unsubscribe).not.toBeNull();
    unsubscribe?.();
    expect(service.listenToActorEvents(stoppedInstanceId, () => undefined)).toBeNull();
  });
});
