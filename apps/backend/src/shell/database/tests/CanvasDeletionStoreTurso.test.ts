import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DbServiceTurso } from '../DbServiceTurso/DbServiceTurso';

const CANVAS_ID = 'delete-canvas';

async function count(service: DbServiceTurso, table: string): Promise<number> {
  const row = await (await service.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`)).get() as { count: unknown };
  return Number(row.count);
}

async function seedCanvasOwnedRows(service: DbServiceTurso): Promise<void> {
  const item = JSON.stringify({
    id: 'widget-item',
    kind: 'rect',
    parentId: null,
    orderKey: 'a',
    extensions: {
      'omnidraw:widget': {
        type: 'widget-instance',
        instanceId: 'delete-instance',
        widgetKey: 'delete-widget',
      },
    },
  });
  await (await service.db.prepare(
    'INSERT INTO canvas_items (canvas_id, id, item_json) VALUES (?, ?, ?)',
  )).run(CANVAS_ID, 'widget-item', item);
  await (await service.db.prepare(`
    INSERT INTO media_files (id, canvas_id, source_hash, digest_sha256, mime_type, byte_size, data)
    VALUES ('canvas-media', ?, 'canvas-source', NULL, 'image/png', 1, ?)
  `)).run(CANVAS_ID, new Uint8Array([1]));
  await (await service.db.prepare(`
    INSERT INTO media_files (id, canvas_id, source_hash, digest_sha256, mime_type, byte_size, data)
    VALUES ('global-media', NULL, 'global-source', NULL, 'image/png', 1, ?)
  `)).run(new Uint8Array([2]));
  await (await service.db.prepare(`
    INSERT INTO resource_catalog (id, kind, name, status)
    VALUES ('independent-resource', 'kv', 'Independent resource', 'ready')
  `)).run();
}

async function createChat(
  service: DbServiceTurso,
  id: string,
  status: 'active' | 'archived',
): Promise<void> {
  await service.chats.create({
    id,
    canvasId: CANVAS_ID,
    name: id,
    workspaceRelativePath: `agent/workspaces/${id}`,
    historyRelativePath: `agent/history/${id}.jsonl`,
  });
  if (status === 'archived') await service.chats.archive({ id });
}

describe('coordinated Canvas deletion store', () => {
  let service: DbServiceTurso;

  beforeEach(async () => {
    service = new DbServiceTurso({
      applicationVersion: 'test',
      databasePath: ':memory:',
      dataDir: '/tmp',
      cacheDir: '/tmp',
    });
    await service.start();
    await service.canvas.create({ id: CANVAS_ID, name: 'Delete me' });
  });

  afterEach(async () => service.stop());

  test('cascades Canvas-owned rows while independent definitions survive', async () => {
    await seedCanvasOwnedRows(service);
    const plan = await service.canvasDeletion.plan({ canvasId: CANVAS_ID });
    expect(plan).toMatchObject({ itemCount: 1, mediaCount: 1, retainedChatCount: 0 });
    const outcome = await service.canvasDeletion.commit({ deletionId: 'delete-1', plan: plan! });
    expect(outcome).toMatchObject({
      status: 'deleted',
      result: { cleanup: { itemCount: 1, mediaCount: 1, retainedChatCount: 0 } },
    });
    expect(await service.canvas.findById({ id: CANVAS_ID })).toBeNull();
    expect(await count(service, 'canvas_items')).toBe(0);
    expect(await count(service, 'media_files')).toBe(1);
    expect(await count(service, 'resource_catalog')).toBe(1);
  });

  test('detaches and archives active and archived chats without changing retained paths', async () => {
    await createChat(service, 'active-chat', 'active');
    await createChat(service, 'archived-chat', 'archived');
    const before = await service.chats.list({ canvasId: CANVAS_ID });
    const plan = await service.canvasDeletion.plan({ canvasId: CANVAS_ID });
    const outcome = await service.canvasDeletion.commit({ deletionId: 'delete-2', plan: plan! });
    expect(outcome).toMatchObject({ status: 'deleted', result: { cleanup: { retainedChatCount: 2 } } });
    const retained = await service.chats.list({ canvasId: null });
    expect(retained).toHaveLength(2);
    expect(retained.every((chat) => chat.status === 'archived')).toBe(true);
    expect(retained.map((chat) => [chat.id, chat.workspaceRelativePath, chat.historyRelativePath]).sort())
      .toEqual(before.map((chat) => [chat.id, chat.workspaceRelativePath, chat.historyRelativePath]).sort());
  });

  test('rolls back chat detachment when Canvas deletion faults', async () => {
    await createChat(service, 'rollback-chat', 'active');
    const plan = await service.canvasDeletion.plan({ canvasId: CANVAS_ID });
    await service.db.exec(`
      CREATE TRIGGER fail_canvas_delete
      BEFORE DELETE ON canvases
      BEGIN
        SELECT RAISE(ABORT, 'injected delete fault');
      END
    `);
    await expect(service.canvasDeletion.commit({ deletionId: 'delete-fault', plan: plan! }))
      .rejects.toThrow('injected delete fault');
    expect(await service.canvas.findById({ id: CANVAS_ID })).not.toBeNull();
    expect(await service.chats.get({ id: 'rollback-chat' })).toMatchObject({
      canvasId: CANVAS_ID,
      status: 'active',
    });
  });

  test('rejects stale plans and deduplicates a committed deletion id', async () => {
    const stale = await service.canvasDeletion.plan({ canvasId: CANVAS_ID });
    await service.canvas.renameById({ id: CANVAS_ID, name: 'Changed name' });
    const staleOutcome = await service.canvasDeletion.commit({ deletionId: 'delete-stale', plan: stale! });
    expect(staleOutcome).toMatchObject({ status: 'stale', actual: { canvas: { name: 'Changed name' } } });
    expect(await service.canvas.findById({ id: CANVAS_ID })).not.toBeNull();

    const current = await service.canvasDeletion.plan({ canvasId: CANVAS_ID });
    const first = await service.canvasDeletion.commit({ deletionId: 'delete-once', plan: current! });
    const retry = await service.canvasDeletion.commit({ deletionId: 'delete-once', plan: current! });
    expect(retry).toEqual(first);
  });
});
