import { afterEach, describe, expect, test } from 'bun:test';
import { DbServiceTurso } from '../../../src/DbServiceTurso/DbServiceTurso';
import { bindTestTenant } from '../tenant.fixture';

const ID = {
  canvas: '00000000-0000-4000-8000-000000000101',
  file: '00000000-0000-4000-8000-000000000102',
  actorOne: '00000000-0000-4000-8000-000000000104',
  actorTwo: '00000000-0000-4000-8000-000000000105',
  connection: '00000000-0000-4000-8000-000000000106',
  dbResource: '00000000-0000-4000-8000-000000000107',
  secretResource: '00000000-0000-4000-8000-000000000108',
  draft: '00000000-0000-4000-8000-000000000109',
  apply: '00000000-0000-4000-8000-00000000010a',
  key: '00000000-0000-4000-8000-00000000010b',
} as const;

describe('DbServiceTurso managed baseline compatibility', () => {
  const databases: DbServiceTurso[] = [];

  afterEach(async () => {
    while (databases.length > 0) await databases.pop()?.db.close();
  });

  test('round-trips legacy public models through organization-scoped baseline tables', async () => {
    const service = new DbServiceTurso({
      databasePath: ':memory:',
      dataDir: import.meta.dir,
      cacheDir: import.meta.dir,
      silentMigrations: true,
    });
    databases.push(service);
    await service.start();
    const db = bindTestTenant(service);

    await db.canvas.create({ id: ID.canvas, name: 'Managed', automerge_url: 'automerge:managed' });
    const file = await db.file.create({
      id: ID.file,
      hash: 'legacy-etag',
      mime_type: 'image/png',
      data: new Uint8Array([1, 2, 3]),
    });
    expect(file).toMatchObject({ id: ID.file, hash: 'legacy-etag' });
    expect(file.created_at).toBeString();

    await db.actor.insertDefinition({
      name: 'ManagedActor',
      slug: 'managed-actor',
      url: null,
      description: null,
      manifest_path: 'widgets/managed-actor/vibecanvas.json',
    });
    for (const [id, element] of [[ID.actorOne, 'one'], [ID.actorTwo, 'two']] as const) {
      await db.actor.insertInstance({
        id,
        canvas_id: ID.canvas,
        element_id: element,
        actor_definition_name: 'ManagedActor',
        display_name: element,
        status: 'created',
        machine_state: 'idle',
        machine_context: { element },
      });
    }
    await db.actor.updateInstanceHealth({
      id: ID.actorOne,
      status: 'error',
      last_error: {
        phase: 'instance-start',
        code: 'TEST',
        message: 'test',
        retryable: true,
      },
    });
    const actor = await db.actor.getInstanceById(ID.actorOne);
    expect(actor).toMatchObject({ id: ID.actorOne, machine_context: { element: 'one' } });
    expect(actor?.last_error?.code).toBe('TEST');

    const connection = await db.actor.insertConnection({
      id: ID.connection,
      canvas_id: ID.canvas,
      source_actor_instance_id: ID.actorOne,
      target_actor_instance_id: ID.actorTwo,
      enabled: true,
      label: null,
      msg_name_whitelist: JSON.stringify(['ping']),
      style: { color: 'blue' },
    });
    expect(connection).toMatchObject({ enabled: true, style: { color: 'blue' } });

    await db.actorResource.create({ id: ID.dbResource, kind: 'db', name: 'Managed DB', status: 'ready' });
    await db.actorResource.create({ id: ID.secretResource, kind: 'secretStore', name: 'Managed secret', status: 'ready' });
    const binding = await db.actorResource.upsertBinding({
      definitionName: 'ManagedActor',
      slotName: 'database',
      resourceId: ID.dbResource,
      allowRead: true,
      allowWrite: true,
    });
    expect(binding).toMatchObject({ actor_definition_name: 'ManagedActor', resource_id: ID.dbResource });

    await db.dbResource.draft.create({ id: ID.draft, resourceId: ID.dbResource, name: 'Draft' });
    const change = await db.dbResource.draft.change.append({
      draftId: ID.draft,
      sequence: 1,
      kind: 'structure',
      operation: { create: 'notes' },
      sql: 'CREATE TABLE notes (id TEXT)',
    });
    expect(change).toMatchObject({ operation: { create: 'notes' }, sql: 'CREATE TABLE notes (id TEXT)' });
    const boundChange = await db.dbResource.draft.change.append({
      draftId: ID.draft,
      sequence: 2,
      kind: 'sql',
      operation: { type: 'boundSql', parameters: [1, 'two', null] },
      sql: 'INSERT INTO notes (id) VALUES (?)',
    });
    expect(boundChange.operation).toEqual({ type: 'boundSql', parameters: [1, 'two', null] });
    const admitted = await db.dbResource.apply.createFromDraft({
      id: ID.apply,
      resourceId: ID.dbResource,
      draftId: ID.draft,
    });
    expect(admitted.apply.status).toBe('preparing');
    await db.dbResource.apply.instanceResult.upsert({
      applyId: ID.apply,
      actorInstanceId: ID.actorOne,
      actorDefinitionName: 'ManagedActor',
      wasRunning: false,
      status: 'notRunning',
    });
    const finished = await db.dbResource.apply.finishWithDraft({
      id: ID.apply,
      draftId: ID.draft,
      status: 'succeeded',
      expectedStatus: 'preparing',
      draftStatus: 'applied',
      backupRetained: false,
    });
    expect(finished.apply.completed_at).toBeString();
    expect(finished.draft.applied_at).toBeString();

    const key = await db.actorResourceEncryptionKey.getOrCreate({
      resourceId: ID.secretResource,
      keyId: ID.key,
      purpose: 'actor-resource-secret-store',
      algorithm: 'aegis256',
      keyHex: '11'.repeat(32),
    });
    expect(key).toMatchObject({
      id: ID.key,
      purpose: 'actor-resource-secret-store',
      algorithm: 'aegis256',
      key_hex: '11'.repeat(32),
    });
  });
});
