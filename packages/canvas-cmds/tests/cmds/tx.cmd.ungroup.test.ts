import { AutomergeService } from '@vibecanvas/service-automerge/AutomergeServer';
import { DbServiceBunSqlite } from '@vibecanvas/service-db/DbServiceBunSqlite/index';
import type { TCanvasDoc, TElement, TGroup } from '@vibecanvas/service-automerge/types/canvas-doc';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { txExecuteCanvasUngroup } from 'packages/canvas-cmds/src/cmds/tx.cmd.ungroup';

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

describe('ungroup canvas command', () => {
  let dbService!: DbServiceBunSqlite;
  let automergeService!: AutomergeService;
  let databasePath!: string;

  beforeEach(async () => {
    databasePath = join(tmpdir(), `canvas-cmds-ungroup-${crypto.randomUUID()}.sqlite`);
    dbService = new DbServiceBunSqlite({ cacheDir: tmpdir(), databasePath, dataDir: tmpdir(), silentMigrations: true });
    await dbService.start();
    automergeService = new AutomergeService(databasePath);
  });

  afterEach(async () => {
    automergeService.stop();
    await dbService.stop();
  });

  test('ungroups one explicit group id and preserves absolute child positions', async () => {
    const parent = createGroup({ id: 'group-parent', zIndex: 'a0' });
    const group = createGroup({ id: 'group-target', parentGroupId: parent.id, zIndex: 'a1' });
    const rectA = createRectElement({ id: 'rect-a', x: 40, y: 60, parentGroupId: group.id, zIndex: 'a2', updatedAt: 10 });
    const rectB = createRectElement({ id: 'rect-b', x: 140, y: 160, parentGroupId: group.id, zIndex: 'a3', updatedAt: 20 });
    const sibling = createRectElement({ id: 'rect-sibling', x: 400, y: 500, parentGroupId: parent.id, zIndex: 'a4' });
    const handle = automergeService.repo.create<TCanvasDoc>({
      id: 'canvas-1',
      name: 'ungroup-one-canvas',
      groups: { [parent.id]: parent, [group.id]: group },
      elements: { [rectA.id]: rectA, [rectB.id]: rectB, [sibling.id]: sibling },
    });
    await handle.whenReady();
    const row = dbService.canvas.create({ id: 'canvas-1', automerge_url: handle.url, name: 'ungroup-one-canvas' });

    const result = await txExecuteCanvasUngroup({ dbService, automergeService }, { canvasId: row.id, canvasNameQuery: null, ids: [group.id] });

    expect(result).toMatchObject({
      ok: true,
      command: 'canvas.ungroup',
      matchedCount: 1,
      matchedIds: ['group-target'],
      removedGroupCount: 1,
      removedGroupIds: ['group-target'],
      releasedChildCount: 2,
      releasedChildIds: ['rect-a', 'rect-b'],
    });

    const doc = handle.doc()!;
    expect(doc.groups[group.id]).toBeUndefined();
    expect(doc.elements[rectA.id]?.parentGroupId).toBe(parent.id);
    expect(doc.elements[rectB.id]?.parentGroupId).toBe(parent.id);
    expect(doc.elements[rectA.id]?.x).toBe(40);
    expect(doc.elements[rectA.id]?.y).toBe(60);
    expect(doc.elements[rectB.id]?.x).toBe(140);
    expect(doc.elements[rectB.id]?.y).toBe(160);
    expect(doc.elements[sibling.id]?.parentGroupId).toBe(parent.id);
  });

  test('ungroups multiple explicit group ids and releases direct child elements to each parent', async () => {
    const parentA = createGroup({ id: 'group-parent-a', zIndex: 'a0' });
    const parentB = createGroup({ id: 'group-parent-b', zIndex: 'a1' });
    const groupB = createGroup({ id: 'group-b', parentGroupId: parentB.id, zIndex: 'a3' });
    const groupA = createGroup({ id: 'group-a', parentGroupId: parentA.id, zIndex: 'a2' });
    const rectA = createRectElement({ id: 'rect-a', x: 10, y: 20, parentGroupId: groupA.id, zIndex: 'a4' });
    const rectB = createRectElement({ id: 'rect-b', x: 30, y: 40, parentGroupId: groupB.id, zIndex: 'a5' });
    const handle = automergeService.repo.create<TCanvasDoc>({
      id: 'canvas-2',
      name: 'ungroup-many-canvas',
      groups: { [parentA.id]: parentA, [parentB.id]: parentB, [groupA.id]: groupA, [groupB.id]: groupB },
      elements: { [rectA.id]: rectA, [rectB.id]: rectB },
    });
    await handle.whenReady();
    const row = dbService.canvas.create({ id: 'canvas-2', automerge_url: handle.url, name: 'ungroup-many-canvas' });

    const result = await txExecuteCanvasUngroup({ dbService, automergeService }, { canvasId: row.id, canvasNameQuery: null, ids: [groupB.id, groupA.id] });

    expect(result).toMatchObject({
      ok: true,
      command: 'canvas.ungroup',
      matchedCount: 2,
      matchedIds: ['group-a', 'group-b'],
      removedGroupCount: 2,
      removedGroupIds: ['group-a', 'group-b'],
      releasedChildCount: 2,
      releasedChildIds: ['rect-a', 'rect-b'],
    });

    const doc = handle.doc()!;
    expect(doc.groups[groupA.id]).toBeUndefined();
    expect(doc.groups[groupB.id]).toBeUndefined();
    expect(doc.elements[rectA.id]?.parentGroupId).toBe(parentA.id);
    expect(doc.elements[rectB.id]?.parentGroupId).toBe(parentB.id);
    expect(doc.elements[rectA.id]?.x).toBe(10);
    expect(doc.elements[rectB.id]?.y).toBe(40);
  });

  test('ungrouping nested selected groups releases children to the nearest surviving ancestor', async () => {
    const root = createGroup({ id: 'root-group', zIndex: 'a0' });
    const parent = createGroup({ id: 'a-parent-group', parentGroupId: root.id, zIndex: 'a1' });
    const child = createGroup({ id: 'b-child-group', parentGroupId: parent.id, zIndex: 'a2' });
    const rect = createRectElement({ id: 'rect-nested', x: 25, y: 35, parentGroupId: child.id, zIndex: 'a3' });
    const handle = automergeService.repo.create<TCanvasDoc>({
      id: 'canvas-3',
      name: 'ungroup-nested-selection-canvas',
      groups: { [root.id]: root, [parent.id]: parent, [child.id]: child },
      elements: { [rect.id]: rect },
    });
    await handle.whenReady();
    const row = dbService.canvas.create({ id: 'canvas-3', automerge_url: handle.url, name: 'ungroup-nested-selection-canvas' });

    const result = await txExecuteCanvasUngroup({ dbService, automergeService }, { canvasId: row.id, canvasNameQuery: null, ids: [parent.id, child.id] });

    expect(result).toMatchObject({
      ok: true,
      command: 'canvas.ungroup',
      matchedCount: 2,
      matchedIds: ['a-parent-group', 'b-child-group'],
      removedGroupIds: ['a-parent-group', 'b-child-group'],
      releasedChildIds: ['rect-nested'],
    });

    const doc = handle.doc()!;
    expect(doc.groups[parent.id]).toBeUndefined();
    expect(doc.groups[child.id]).toBeUndefined();
    expect(doc.groups[root.id]).toBeDefined();
    expect(doc.elements[rect.id]?.parentGroupId).toBe(root.id);
    expect(doc.elements[rect.id]?.x).toBe(25);
    expect(doc.elements[rect.id]?.y).toBe(35);
  });

  test('fails clearly on missing targets and non-group ids', async () => {
    const parent = createGroup({ id: 'group-parent', zIndex: 'a0' });
    const group = createGroup({ id: 'group-target', parentGroupId: parent.id, zIndex: 'a1' });
    const rect = createRectElement({ id: 'rect-a', parentGroupId: group.id, zIndex: 'a2' });
    const topLevel = createRectElement({ id: 'rect-top', zIndex: 'a3' });
    const handle = automergeService.repo.create<TCanvasDoc>({
      id: 'canvas-4',
      name: 'ungroup-invalid-canvas',
      groups: { [parent.id]: parent, [group.id]: group },
      elements: { [rect.id]: rect, [topLevel.id]: topLevel },
    });
    await handle.whenReady();
    const row = dbService.canvas.create({ id: 'canvas-4', automerge_url: handle.url, name: 'ungroup-invalid-canvas' });

    await expect(txExecuteCanvasUngroup({ dbService, automergeService }, { canvasId: row.id, canvasNameQuery: null, ids: ['missing-id'] })).rejects.toMatchObject({
      ok: false,
      command: 'canvas.ungroup',
      code: 'CANVAS_UNGROUP_TARGET_NOT_FOUND',
      message: `Target ids were not found in canvas '${row.name}': missing-id.`,
      canvasId: row.id,
      canvasNameQuery: null,
    });

    await expect(txExecuteCanvasUngroup({ dbService, automergeService }, { canvasId: row.id, canvasNameQuery: null, ids: [topLevel.id] })).rejects.toMatchObject({
      ok: false,
      command: 'canvas.ungroup',
      code: 'CANVAS_UNGROUP_TARGET_KIND_INVALID',
      message: `Ungroup currently supports group ids only. Received element ids: ${topLevel.id}.`,
      canvasId: row.id,
      canvasNameQuery: null,
    });
  });
});
