import { createStartedAutomergeService, stopStartedAutomergeService, type TStartedAutomergeService } from './fixture.automerge';
import type { TCanvasDoc, TElement, TGroup } from '@vibecanvas/service-automerge/types/canvas-doc.types';
import { DbServiceBunSqlite } from '@vibecanvas/service-db/DbServiceBunSqlite/index';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { txExecuteCanvasDelete } from '../../src/cmds/tx.cmd.delete';

function createRectElement(overrides?: Partial<TElement>): TElement {
  return {
    id: 'rect-1',
    x: 40,
    y: 80,
    rotation: 0,
    zIndex: 'a0',
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    data: { type: 'rect', w: 120, h: 80 },
    style: { backgroundColor: '#ffffff', strokeColor: '#111111', strokeWidth: "@stroke-width/thin", opacity: 1 },
    ...overrides,
  };
}

function createGroup(overrides?: Partial<TGroup>): TGroup {
  return {
    id: 'group-1',
    parentGroupId: null,
    zIndex: 'a0',
    locked: false,
    createdAt: 1,
    ...overrides,
  };
}

describe('delete canvas command', () => {
  let dbService!: DbServiceBunSqlite;
  let automergeService!: TStartedAutomergeService;
  let databasePath!: string;

  beforeEach(async () => {
    databasePath = join(tmpdir(), `canvas-cmds-delete-${crypto.randomUUID()}.sqlite`);
    dbService = new DbServiceBunSqlite({ cacheDir: tmpdir(), databasePath, dataDir: tmpdir(), silentMigrations: true });
    await dbService.start();
    automergeService = await createStartedAutomergeService();
  });

  afterEach(async () => {
    await stopStartedAutomergeService(automergeService);
    await dbService.stop();
  });

  test('deletes one element by id and leaves siblings intact', async () => {
    const keep = createRectElement({ id: 'rect-keep', x: 10, y: 20 });
    const target = createRectElement({ id: 'rect-target', x: 40, y: 80 });
    const handle = automergeService.repo.create<TCanvasDoc>({ id: 'canvas-1', name: 'delete-element-canvas', elements: { [keep.id]: keep, [target.id]: target }, groups: {} });
    await handle.whenReady();
    const row = dbService.canvas.create({ id: 'canvas-1', automerge_url: handle.url, name: 'delete-element-canvas' });

    const result = await txExecuteCanvasDelete({ dbService, automergeService }, { canvasId: row.id, canvasNameQuery: null, ids: [target.id] });

    expect(result).toMatchObject({
      ok: true,
      command: 'canvas.delete',
      matchedCount: 1,
      matchedIds: ['rect-target'],
      deletedElementIds: ['rect-target'],
      deletedGroupIds: [],
    });

    const doc = handle.doc()!;
    expect(doc.elements[target.id]).toBeUndefined();
    expect(doc.elements[keep.id]).toBeDefined();
  });

  test('deleting a group cascades to every descendant element and nested group', async () => {
    const rootGroup = createGroup({ id: 'group-root', zIndex: 'a0' });
    const childGroup = createGroup({ id: 'group-child', parentGroupId: rootGroup.id, zIndex: 'a1' });
    const direct = createRectElement({ id: 'rect-direct', parentGroupId: rootGroup.id, zIndex: 'a2' });
    const nested = createRectElement({ id: 'rect-nested', parentGroupId: childGroup.id, zIndex: 'a3' });
    const outside = createRectElement({ id: 'rect-outside', zIndex: 'a4' });
    const handle = automergeService.repo.create<TCanvasDoc>({
      id: 'canvas-2',
      name: 'delete-cascade-canvas',
      groups: { [rootGroup.id]: rootGroup, [childGroup.id]: childGroup },
      elements: { [direct.id]: direct, [nested.id]: nested, [outside.id]: outside },
    });
    await handle.whenReady();
    const row = dbService.canvas.create({ id: 'canvas-2', automerge_url: handle.url, name: 'delete-cascade-canvas' });

    const result = await txExecuteCanvasDelete({ dbService, automergeService }, { canvasId: row.id, canvasNameQuery: null, ids: [rootGroup.id] });

    expect(result).toMatchObject({
      ok: true,
      command: 'canvas.delete',
      matchedCount: 1,
      matchedIds: ['group-root'],
      deletedElementIds: ['rect-direct', 'rect-nested'],
      deletedGroupIds: ['group-child', 'group-root'],
    });

    const doc = handle.doc()!;
    expect(doc.groups[rootGroup.id]).toBeUndefined();
    expect(doc.groups[childGroup.id]).toBeUndefined();
    expect(doc.elements[direct.id]).toBeUndefined();
    expect(doc.elements[nested.id]).toBeUndefined();
    expect(doc.elements[outside.id]).toBeDefined();
  });

  test('deletes a mix of element and group ids in a single call with sorted output', async () => {
    const group = createGroup({ id: 'group-mixed', zIndex: 'a0' });
    const child = createRectElement({ id: 'rect-child', parentGroupId: group.id, zIndex: 'a1' });
    const loose = createRectElement({ id: 'rect-loose', zIndex: 'a2' });
    const keep = createRectElement({ id: 'rect-keep', zIndex: 'a3' });
    const handle = automergeService.repo.create<TCanvasDoc>({
      id: 'canvas-3',
      name: 'delete-mixed-canvas',
      groups: { [group.id]: group },
      elements: { [child.id]: child, [loose.id]: loose, [keep.id]: keep },
    });
    await handle.whenReady();
    const row = dbService.canvas.create({ id: 'canvas-3', automerge_url: handle.url, name: 'delete-mixed-canvas' });

    const result = await txExecuteCanvasDelete({ dbService, automergeService }, { canvasId: row.id, canvasNameQuery: null, ids: [loose.id, group.id] });

    expect(result).toMatchObject({
      ok: true,
      command: 'canvas.delete',
      matchedCount: 2,
      matchedIds: ['group-mixed', 'rect-loose'],
      deletedElementIds: ['rect-child', 'rect-loose'],
      deletedGroupIds: ['group-mixed'],
    });

    const doc = handle.doc()!;
    expect(doc.groups[group.id]).toBeUndefined();
    expect(doc.elements[child.id]).toBeUndefined();
    expect(doc.elements[loose.id]).toBeUndefined();
    expect(doc.elements[keep.id]).toBeDefined();
  });

  test('fails with CANVAS_DELETE_TARGET_NOT_FOUND when an id does not exist and leaves the doc untouched', async () => {
    const rect = createRectElement({ id: 'rect-only' });
    const handle = automergeService.repo.create<TCanvasDoc>({ id: 'canvas-5', name: 'delete-missing-canvas', elements: { [rect.id]: rect }, groups: {} });
    await handle.whenReady();
    const row = dbService.canvas.create({ id: 'canvas-5', automerge_url: handle.url, name: 'delete-missing-canvas' });

    await expect(txExecuteCanvasDelete({ dbService, automergeService }, { canvasId: row.id, canvasNameQuery: null, ids: ['missing-id'] })).rejects.toMatchObject({
      ok: false,
      command: 'canvas.delete',
      code: 'CANVAS_DELETE_TARGET_NOT_FOUND',
      canvasId: row.id,
      canvasNameQuery: null,
    });

    const doc = handle.doc()!;
    expect(doc.elements[rect.id]).toBeDefined();
  });

  test('fails with CANVAS_SELECTOR_REQUIRED when no canvas selector is provided', async () => {
    await expect(txExecuteCanvasDelete({ dbService, automergeService }, { canvasId: null, canvasNameQuery: null, ids: ['anything'] })).rejects.toMatchObject({
      ok: false,
      command: 'canvas.delete',
      code: 'CANVAS_SELECTOR_REQUIRED',
    });
  });

  test('fails with CANVAS_DELETE_ID_REQUIRED when no ids are provided', async () => {
    const handle = automergeService.repo.create<TCanvasDoc>({ id: 'canvas-6', name: 'delete-no-ids', elements: {}, groups: {} });
    await handle.whenReady();
    const row = dbService.canvas.create({ id: 'canvas-6', automerge_url: handle.url, name: 'delete-no-ids' });

    await expect(txExecuteCanvasDelete({ dbService, automergeService }, { canvasId: row.id, canvasNameQuery: null, ids: [] })).rejects.toMatchObject({
      ok: false,
      command: 'canvas.delete',
      code: 'CANVAS_DELETE_ID_REQUIRED',
      canvasId: row.id,
    });
  });
});
