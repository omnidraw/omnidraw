import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import { ActorResourceManager } from '../src/resources/ActorResourceManager';
import { DbResource } from '../src/resources/DbResource';
import type { TVibecanvasJson } from '../src/core/types';

const definitionName = 'Notes Widget';

function checksum(sql: string) {
  return `sha256:${createHash('sha256').update(sql, 'utf8').digest('hex')}`;
}

function manifest(version: number): TVibecanvasJson & { manifest_path: string } {
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
          schema: { id: 'notes', version },
          arbitrarySql: true,
          operations: {
            createNote: {
              effect: 'write',
              sql: 'INSERT INTO notes (id, title) VALUES (:id, :title)',
              parameters: {
                id: { type: 'string' },
                title: { type: 'string' },
              },
              result: 'execute',
            },
            listNotes: {
              effect: 'read',
              sql: 'SELECT id, title FROM notes ORDER BY id',
              result: 'rows',
            },
          },
        },
      },
      states: { ready: { on: {} } },
    },
    widget: {
      relWidgetDir: './widget',
      tool: { label: 'Notes', behavior: { type: 'action' } },
    },
  };
}

describe('DbResource', () => {
  let db: DbServiceTurso;
  let provider: DbResource;
  let manager: ActorResourceManager;
  let dataRoot: string;
  let currentManifest: ReturnType<typeof manifest>;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'vibecanvas-db-resource-'));
    db = new DbServiceTurso({ databasePath: ':memory:', dataDir: dataRoot, cacheDir: dataRoot });
    await db.start();
    currentManifest = manifest(1);
    await db.actor.insertDefinition({
      name: definitionName,
      slug: currentManifest.slug,
      url: null,
      description: null,
      manifest_path: currentManifest.manifest_path,
    });
    provider = new DbResource({ db, dataRoot });
    manager = new ActorResourceManager({
      db,
      crypto,
      getDefinition: (name) => name === definitionName ? currentManifest : null,
      providers: [provider],
    });
  });

  afterEach(async () => {
    await manager.close();
    await db.db.close();
    await rm(dataRoot, { recursive: true, force: true });
  });

  async function publishInitialSchema() {
    const sql = 'CREATE TABLE notes (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL) STRICT;';
    await db.dbResource.schema.create({ id: 'notes', name: 'Notes' });
    await db.dbResource.migration.createDraft({ schemaId: 'notes', version: 1, name: 'initial', sql, checksum: checksum(sql) });
    await db.dbResource.schema.publish({ id: 'notes' });
  }

  async function publishSecondMigration() {
    const sql = 'ALTER TABLE notes ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;';
    await db.dbResource.migration.createDraft({
      schemaId: 'notes',
      version: 2,
      name: 'add-archived',
      sql,
      checksum: checksum(sql),
    });
    await db.dbResource.migration.publish({ schemaId: 'notes', version: 2 });
  }

  async function createAndBindNotesResource() {
    const resource = await manager.createResource({
      kind: 'db',
      name: 'Shared Notes',
      db: { schemaId: 'notes', version: 1 },
    });
    await manager.bindResource({ definitionName, slot: 'notes', resourceId: resource.id });
    return resource;
  }

  test('provisions a host-derived database and dispatches named and arbitrary operations', async () => {
    await publishInitialSchema();
    const resource = await manager.createResource({ kind: 'db', name: 'Shared Notes', db: { schemaId: 'notes', version: 1 } });
    await access(join(dataRoot, 'actor-resources', 'db', resource.id, 'data.db'));
    await expect(db.dbResource.configuration.get({ resourceId: resource.id })).resolves.toMatchObject({
      schema_id: 'notes', applied_version: 1, target_version: 1,
    });
    await manager.bindResource({ definitionName, slot: 'notes', resourceId: resource.id });

    const created = await manager.call({
      actorId: 'actor-a', definitionName, runId: 1, functionClass: 'tx', slot: 'notes', kind: 'db', operation: 'invoke',
      args: { operation: 'createNote', parameters: { id: 'a', title: 'Alpha' } },
    });
    expect(created).toMatchObject({ rowsAffected: 1 });
    expect(await manager.call({
      actorId: 'actor-b', definitionName, runId: 2, functionClass: 'fx', slot: 'notes', kind: 'db', operation: 'invoke',
      args: { operation: 'listNotes', parameters: {} },
    })).toEqual([{ id: 'a', title: 'Alpha' }]);
    expect(await manager.call({
      actorId: 'actor-b', definitionName, runId: 3, functionClass: 'fx', slot: 'notes', kind: 'db', operation: 'query',
      args: { sql: 'SELECT COUNT(*) AS total FROM notes', parameters: {} },
    })).toEqual([{ total: 1n }]);

    await expect(manager.call({
      actorId: 'actor-b', definitionName, runId: 4, functionClass: 'fx', slot: 'notes', kind: 'db', operation: 'execute',
      args: { sql: 'DELETE FROM notes', parameters: {} },
    })).rejects.toMatchObject({ code: 'RESOURCE_WRITE_NOT_ALLOWED' });
    await expect(manager.call({
      actorId: 'actor-b', definitionName, runId: 5, functionClass: 'fx', slot: 'notes', kind: 'db', operation: 'query',
      args: { sql: 'DELETE FROM notes', parameters: {} },
    })).rejects.toMatchObject({ code: 'DB_READ_NOT_ALLOWED' });
    await expect(manager.call({
      actorId: 'actor-a', definitionName, runId: 6, functionClass: 'tx', slot: 'notes', kind: 'db', operation: 'invoke',
      args: { operation: 'createNote', parameters: { id: 'b', title: 'Beta', extra: true } },
    })).rejects.toMatchObject({ code: 'DB_OPERATION_PARAMETERS_INVALID' });
  });

  test('migrates forward, blocks old manifest versions, and restores a verified backup on failure', async () => {
    await publishInitialSchema();
    const resource = await manager.createResource({ kind: 'db', name: 'Shared Notes', db: { schemaId: 'notes', version: 1 } });
    await manager.bindResource({ definitionName, slot: 'notes', resourceId: resource.id });
    await manager.call({
      actorId: 'actor-a', definitionName, runId: 1, functionClass: 'tx', slot: 'notes', kind: 'db', operation: 'invoke',
      args: { operation: 'createNote', parameters: { id: 'a', title: 'Alpha' } },
    });

    const addArchived = 'ALTER TABLE notes ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;';
    await db.dbResource.migration.createDraft({
      schemaId: 'notes', version: 2, name: 'add-archived', sql: addArchived, checksum: checksum(addArchived),
    });
    await db.dbResource.migration.publish({ schemaId: 'notes', version: 2 });
    expect((await provider.migrate(resource.id, 2)).applied_version).toBe(2);
    await expect(manager.call({
      actorId: 'actor-a', definitionName, runId: 2, functionClass: 'fx', slot: 'notes', kind: 'db', operation: 'invoke',
      args: { operation: 'listNotes', parameters: {} },
    })).rejects.toMatchObject({ code: 'DB_RESOURCE_VERSION_MISMATCH' });

    currentManifest = manifest(2);
    expect(await manager.call({
      actorId: 'actor-a', definitionName, runId: 3, functionClass: 'fx', slot: 'notes', kind: 'db', operation: 'invoke',
      args: { operation: 'listNotes', parameters: {} },
    })).toEqual([{ id: 'a', title: 'Alpha' }]);

    const invalidSql = 'ALTER TABLE missing_table ADD COLUMN broken TEXT;';
    await db.dbResource.migration.createDraft({
      schemaId: 'notes', version: 3, name: 'broken', sql: invalidSql, checksum: checksum(invalidSql),
    });
    await db.dbResource.migration.publish({ schemaId: 'notes', version: 3 });
    await expect(provider.migrate(resource.id, 3)).rejects.toMatchObject({ code: 'DB_RESOURCE_MIGRATION_FAILED' });
    expect(await db.dbResource.configuration.get({ resourceId: resource.id })).toMatchObject({
      applied_version: 2,
      target_version: 2,
    });
    await expect(access(join(dataRoot, 'actor-resources', 'db', resource.id, 'data.db'))).resolves.toBeNull();
    expect(await manager.call({
      actorId: 'actor-a', definitionName, runId: 4, functionClass: 'fx', slot: 'notes', kind: 'db', operation: 'invoke',
      args: { operation: 'listNotes', parameters: {} },
    })).toEqual([{ id: 'a', title: 'Alpha' }]);
  });

  test('supports a published schema at version zero', async () => {
    await db.dbResource.schema.create({ id: 'empty', name: 'Empty' });
    await db.dbResource.schema.publish({ id: 'empty' });
    currentManifest = {
      ...manifest(1),
      actor: {
        ...manifest(1).actor,
        resources: {
          notes: { kind: 'db', required: true, scope: ['read'], schema: { id: 'empty', version: 0 } },
        },
      },
    };
    const resource = await manager.createResource({ kind: 'db', name: 'Empty DB', db: { schemaId: 'empty', version: 0 } });
    expect(await db.dbResource.configuration.get({ resourceId: resource.id })).toMatchObject({
      schema_id: 'empty', applied_version: 0, target_version: 0,
    });
  });

  test('excludes a concurrent migration and retains its backup until commit', async () => {
    await publishInitialSchema();
    const resource = await createAndBindNotesResource();
    await publishSecondMigration();

    const migration = provider.migrate(resource.id, 2);
    const competingMigration = provider.migrate(resource.id, 2);

    await expect(competingMigration).rejects.toMatchObject({ code: 'DB_RESOURCE_MIGRATING' });
    await expect(migration).resolves.toMatchObject({ applied_version: 2, target_version: 2 });

    const backupPath = join(dataRoot, 'actor-resources', 'db', resource.id, 'data.db.pre-migration');
    await expect(access(backupPath)).resolves.toBeNull();
    await provider.commitMigration(resource.id);
    await expect(access(backupPath)).rejects.toBeDefined();
  });

  test('reports preflight physical-history drift as unrecoverable and reconciles the catalog to error', async () => {
    await publishInitialSchema();
    const resource = await createAndBindNotesResource();
    await publishSecondMigration();

    await manager.call({
      actorId: 'actor-a',
      definitionName,
      runId: 1,
      functionClass: 'tx',
      slot: 'notes',
      kind: 'db',
      operation: 'execute',
      args: {
        sql: 'UPDATE _vibecanvas_migrations SET checksum = :checksum WHERE version = 1',
        parameters: { checksum: 'sha256:changed-outside-the-host-migrator' },
      },
    });

    await expect(provider.migrate(resource.id, 2)).rejects.toMatchObject({
      code: 'DB_RESOURCE_RECOVERY_FAILED',
    });

    await db.actorResource.updateProviderState({ id: resource.id, status: 'migrating' });
    await manager.reconcileStartup();
    expect(await db.actorResource.get({ id: resource.id })).toMatchObject({
      status: 'error',
      last_error: { code: 'DB_RESOURCE_RECOVERY_FAILED' },
    });
  });

  test('rejects host-path SQL for arbitrary and named operations before creating a file', async () => {
    await publishInitialSchema();
    const resource = await createAndBindNotesResource();
    const arbitraryPath = join(dataRoot, 'arbitrary-export.db');
    const namedPath = join(dataRoot, 'named-export.db');

    await expect(manager.call({
      actorId: 'actor-a',
      definitionName,
      runId: 1,
      functionClass: 'tx',
      slot: 'notes',
      kind: 'db',
      operation: 'execute',
      args: { sql: `VACUUM INTO '${arbitraryPath}'`, parameters: {} },
    })).rejects.toMatchObject({ code: 'DB_ARBITRARY_SQL_NOT_ALLOWED' });

    const requirement = currentManifest.actor.resources?.notes;
    if (requirement?.kind !== 'db' || !requirement.operations) throw new Error('Expected notes DbResource requirement');
    requirement.operations.exportToHost = {
      effect: 'write',
      sql: `VACUUM INTO '${namedPath}'`,
      result: 'execute',
    };
    await expect(manager.call({
      actorId: 'actor-a',
      definitionName,
      runId: 2,
      functionClass: 'tx',
      slot: 'notes',
      kind: 'db',
      operation: 'invoke',
      args: { operation: 'exportToHost', parameters: {} },
    })).rejects.toMatchObject({ code: 'DB_ARBITRARY_SQL_NOT_ALLOWED' });

    await expect(access(arbitraryPath)).rejects.toBeDefined();
    await expect(access(namedPath)).rejects.toBeDefined();
    expect(await manager.call({
      actorId: 'actor-a',
      definitionName,
      runId: 3,
      functionClass: 'fx',
      slot: 'notes',
      kind: 'db',
      operation: 'invoke',
      args: { operation: 'listNotes', parameters: {} },
    })).toEqual([]);
  });

  test('restores a retained successful-migration backup when finalization fails', async () => {
    await publishInitialSchema();
    const resource = await createAndBindNotesResource();
    const originalConfiguration = await db.dbResource.configuration.get({ resourceId: resource.id });
    if (!originalConfiguration) throw new Error('Expected DbResource configuration');
    await manager.call({
      actorId: 'actor-a',
      definitionName,
      runId: 1,
      functionClass: 'tx',
      slot: 'notes',
      kind: 'db',
      operation: 'invoke',
      args: { operation: 'createNote', parameters: { id: 'before', title: 'Before migration' } },
    });
    await publishSecondMigration();

    await provider.migrate(resource.id, 2);
    const backupPath = join(dataRoot, 'actor-resources', 'db', resource.id, 'data.db.pre-migration');
    await expect(access(backupPath)).resolves.toBeNull();

    await expect(provider.restoreMigration(resource.id, originalConfiguration)).resolves.toMatchObject({
      applied_version: 1,
      target_version: 1,
    });
    await expect(access(backupPath)).rejects.toBeDefined();
    expect(await manager.call({
      actorId: 'actor-a',
      definitionName,
      runId: 2,
      functionClass: 'fx',
      slot: 'notes',
      kind: 'db',
      operation: 'invoke',
      args: { operation: 'listNotes', parameters: {} },
    })).toEqual([{ id: 'before', title: 'Before migration' }]);
  });
});
