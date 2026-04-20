import { AutomergeService } from '@vibecanvas/service-automerge/AutomergeServer';
import { DbServiceBunSqlite } from '@vibecanvas/service-db/DbServiceBunSqlite/index';
import type { TCanvasDoc, TElement, TGroup } from '@vibecanvas/service-automerge/types/canvas-doc';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { txExecuteCanvasGroup } from 'packages/canvas-cmds/src/cmds/tx.cmd.group';

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

describe('group canvas command', () => {
  let dbService!: DbServiceBunSqlite;
  let automergeService!: AutomergeService;
  let databasePath!: string;

  beforeEach(async () => {
    databasePath = join(tmpdir(), `canvas-cmds-group-${crypto.randomUUID()}.sqlite`);
    dbService = new DbServiceBunSqlite({ cacheDir: tmpdir(), databasePath, dataDir: tmpdir(), silentMigrations: true });
    await dbService.start();
    automergeService = new AutomergeService(databasePath);
  });

  afterEach(async () => {
    automergeService.stop();
    await dbService.stop();
  });

  test('groups explicit top-level element ids and preserves absolute positions', async () => {
    const rectB = createRectElement({ id: 'rect-b', x: 150, y: 70, zIndex: 'a1', createdAt: 20, updatedAt: 20 });
    const rectA = createRectElement({ id: 'rect-a', x: 40, y: 30, zIndex: 'a0', createdAt: 10, updatedAt: 10 });
    const outside = createRectElement({ id: 'rect-outside', x: 600, y: 500, zIndex: 'a2' });
    const handle = automergeService.repo.create<TCanvasDoc>({
      id: 'canvas-1',
      name: 'group-top-level-canvas',
      elements: { [rectB.id]: rectB, [rectA.id]: rectA, [outside.id]: outside },
      groups: {},
    });
    await handle.whenReady();
    const row = dbService.canvas.create({ id: 'canvas-1', automerge_url: handle.url, name: 'group-top-level-canvas' });

    const result = await txExecuteCanvasGroup({ dbService, automergeService }, { canvasId: row.id, canvasNameQuery: null, ids: [rectB.id, rectA.id] });

    expect(result).toMatchObject({
      ok: true,
      command: 'canvas.group',
      matchedCount: 2,
      matchedIds: ['rect-a', 'rect-b'],
      group: {
        parentGroupId: null,
        childIds: ['rect-a', 'rect-b'],
      },
    });
    expect(typeof result.group.id).toBe('string');
    expect(result.group.id.length).toBeGreaterThan(0);

    const doc = handle.doc()!;
    expect(doc.elements[rectA.id]?.parentGroupId).toBe(result.group.id);
    expect(doc.elements[rectB.id]?.parentGroupId).toBe(result.group.id);
    expect(doc.elements[rectA.id]?.x).toBe(40);
    expect(doc.elements[rectA.id]?.y).toBe(30);
    expect(doc.elements[rectB.id]?.x).toBe(150);
    expect(doc.elements[rectB.id]?.y).toBe(70);
    expect(doc.elements[outside.id]?.parentGroupId).toBeNull();
    expect(doc.groups[result.group.id]).toMatchObject({ id: result.group.id, parentGroupId: null });
  });

  test('groups explicit ids inside one parent group and keeps nested child positions unchanged', async () => {
    const parent = createGroup({ id: 'group-parent', zIndex: 'a0', createdAt: 1 });
    const rectA = createRectElement({ id: 'rect-a', x: 20, y: 40, parentGroupId: parent.id, zIndex: 'a1' });
    const rectB = createRectElement({ id: 'rect-b', x: 80, y: 140, parentGroupId: parent.id, zIndex: 'a2' });
    const sibling = createRectElement({ id: 'rect-sibling', x: 300, y: 320, parentGroupId: parent.id, zIndex: 'a3' });
    const handle = automergeService.repo.create<TCanvasDoc>({
      id: 'canvas-2',
      name: 'group-nested-canvas',
      groups: { [parent.id]: parent },
      elements: { [rectA.id]: rectA, [rectB.id]: rectB, [sibling.id]: sibling },
    });
    await handle.whenReady();
    const row = dbService.canvas.create({ id: 'canvas-2', automerge_url: handle.url, name: 'group-nested-canvas' });

    const result = await txExecuteCanvasGroup({ dbService, automergeService }, { canvasId: row.id, canvasNameQuery: null, ids: [rectB.id, rectA.id] });

    expect(result).toMatchObject({
      ok: true,
      command: 'canvas.group',
      matchedCount: 2,
      matchedIds: ['rect-a', 'rect-b'],
      group: {
        parentGroupId: parent.id,
        childIds: ['rect-a', 'rect-b'],
      },
    });

    const doc = handle.doc()!;
    expect(doc.groups[result.group.id]?.parentGroupId).toBe(parent.id);
    expect(doc.elements[rectA.id]?.parentGroupId).toBe(result.group.id);
    expect(doc.elements[rectB.id]?.parentGroupId).toBe(result.group.id);
    expect(doc.elements[rectA.id]?.x).toBe(20);
    expect(doc.elements[rectA.id]?.y).toBe(40);
    expect(doc.elements[rectB.id]?.x).toBe(80);
    expect(doc.elements[rectB.id]?.y).toBe(140);
    expect(doc.elements[sibling.id]?.parentGroupId).toBe(parent.id);
  });

  test('fails clearly on missing targets, mixed parents, and group ids', async () => {
    const parent = createGroup({ id: 'group-parent', zIndex: 'a0' });
    const existingGroup = createGroup({ id: 'group-existing', zIndex: 'a1' });
    const topLevel = createRectElement({ id: 'rect-top', x: 10, y: 20, zIndex: 'a2' });
    const nested = createRectElement({ id: 'rect-nested', x: 30, y: 40, parentGroupId: parent.id, zIndex: 'a3' });
    const handle = automergeService.repo.create<TCanvasDoc>({
      id: 'canvas-3',
      name: 'group-invalid-canvas',
      groups: { [parent.id]: parent, [existingGroup.id]: existingGroup },
      elements: { [topLevel.id]: topLevel, [nested.id]: nested },
    });
    await handle.whenReady();
    const row = dbService.canvas.create({ id: 'canvas-3', automerge_url: handle.url, name: 'group-invalid-canvas' });

    await expect(txExecuteCanvasGroup({ dbService, automergeService }, { canvasId: row.id, canvasNameQuery: null, ids: [topLevel.id, 'missing-id'] })).rejects.toMatchObject({
      ok: false,
      command: 'canvas.group',
      code: 'CANVAS_GROUP_TARGET_NOT_FOUND',
      message: `Target ids were not found in canvas '${row.name}': missing-id.`,
      canvasId: row.id,
      canvasNameQuery: null,
    });

    await expect(txExecuteCanvasGroup({ dbService, automergeService }, { canvasId: row.id, canvasNameQuery: null, ids: [topLevel.id, nested.id] })).rejects.toMatchObject({
      ok: false,
      command: 'canvas.group',
      code: 'CANVAS_GROUP_PARENT_MISMATCH',
      message: 'All grouped ids must share the same direct parentGroupId.',
      canvasId: row.id,
      canvasNameQuery: null,
    });

    await expect(txExecuteCanvasGroup({ dbService, automergeService }, { canvasId: row.id, canvasNameQuery: null, ids: [topLevel.id, existingGroup.id] })).rejects.toMatchObject({
      ok: false,
      command: 'canvas.group',
      code: 'CANVAS_GROUP_TARGET_KIND_INVALID',
      message: `Grouping currently supports element ids only. Received group ids: ${existingGroup.id}.`,
      canvasId: row.id,
      canvasNameQuery: null,
    });
  });
});
