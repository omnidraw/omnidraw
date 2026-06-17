import { AutomergeService } from '@vibecanvas/service-automerge/AutomergeService';
import { DbServiceBunSqlite } from '@vibecanvas/service-db/DbServiceBunSqlite/index';
import type { TCanvasDoc, TElement, TGroup } from '@vibecanvas/service-automerge/types/canvas-doc';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { txExecuteCanvasMove } from 'packages/canvas-cmds/src/cmds/tx.cmd.move';

function createRectElement(overrides?: Partial<TElement>): TElement {
  return { id: 'rect-1', x: 40, y: 80, rotation: 0, zIndex: 'a0', parentGroupId: null, bindings: [], locked: false, createdAt: 1, updatedAt: 1, data: { type: 'rect', w: 120, h: 80 }, style: { backgroundColor: '#ffffff', strokeColor: '#111111', strokeWidth: "@stroke-width/thin", opacity: 1 }, ...overrides };
}
function createGroup(overrides?: Partial<TGroup>): TGroup {
  return { id: 'group-1', parentGroupId: null, zIndex: 'a0', locked: false, createdAt: 1, ...overrides };
}

describe('move canvas command', () => {
  let dbService!: DbServiceBunSqlite;
  let automergeService!: AutomergeService;
  let databasePath!: string;

  beforeEach(async () => {
    databasePath = join(tmpdir(), `canvas-cmds-move-${crypto.randomUUID()}.sqlite`);
    dbService = new DbServiceBunSqlite({ cacheDir: tmpdir(), databasePath, dataDir: tmpdir(), silentMigrations: true });
    await dbService.start();
    automergeService = new AutomergeService(databasePath);
  });
  afterEach(async () => {
    automergeService.stop();
    await dbService.stop();
  });

  test('moves one element relatively', async () => {
    const rect = createRectElement({ id: 'rect-1', x: 40, y: 80, updatedAt: 100 });
    const handle = automergeService.repo.create<TCanvasDoc>({ id: 'canvas-1', name: 'move-one-canvas', elements: { [rect.id]: rect }, groups: {} });
    await handle.whenReady();
    const row = dbService.canvas.create({ id: 'canvas-1', automerge_url: handle.url, name: 'move-one-canvas' });

    const result = await txExecuteCanvasMove({ dbService, automergeService }, { canvasId: row.id, canvasNameQuery: null, ids: [rect.id], mode: 'relative', x: 15, y: -5 });
    expect(result).toMatchObject({ ok: true, command: 'canvas.move', mode: 'relative', input: { x: 15, y: -5 }, delta: { dx: 15, dy: -5 }, matchedCount: 1, matchedIds: ['rect-1'], changedCount: 1, changedIds: ['rect-1'] });
    expect(handle.doc()!.elements[rect.id]?.x).toBe(55);
    expect(handle.doc()!.elements[rect.id]?.y).toBe(75);
    expect(handle.doc()!.elements[rect.id]?.updatedAt).toBeGreaterThan(100);
  });

  test('moves multiple ids relatively and group subtree once', async () => {
    const rootGroup = createGroup({ id: 'group-root', zIndex: 'a0' });
    const childGroup = createGroup({ id: 'group-child', parentGroupId: rootGroup.id, zIndex: 'a1' });
    const direct = createRectElement({ id: 'rect-direct', x: 10, y: 20, parentGroupId: rootGroup.id, zIndex: 'a2' });
    const nested = createRectElement({ id: 'rect-nested', x: 50, y: 70, parentGroupId: childGroup.id, zIndex: 'a3' });
    const outside = createRectElement({ id: 'rect-outside', x: 400, y: 500, zIndex: 'a4' });
    const handle = automergeService.repo.create<TCanvasDoc>({ id: 'canvas-2', name: 'move-subtree-canvas', elements: { [direct.id]: direct, [nested.id]: nested, [outside.id]: outside }, groups: { [rootGroup.id]: rootGroup, [childGroup.id]: childGroup } });
    await handle.whenReady();
    const row = dbService.canvas.create({ id: 'canvas-2', automerge_url: handle.url, name: 'move-subtree-canvas' });

    const result = await txExecuteCanvasMove({ dbService, automergeService }, { canvasId: row.id, canvasNameQuery: null, ids: [rootGroup.id], mode: 'relative', x: 7, y: 11 });
    expect(result).toMatchObject({ ok: true, command: 'canvas.move', mode: 'relative', matchedCount: 1, matchedIds: ['group-root'], changedCount: 2, changedIds: ['rect-direct', 'rect-nested'] });
    expect(handle.doc()!.elements[direct.id]?.x).toBe(17);
    expect(handle.doc()!.elements[nested.id]?.y).toBe(81);
    expect(handle.doc()!.elements[outside.id]?.x).toBe(400);
  });

  test('moves one target absolutely and fails clearly on invalid targets', async () => {
    const rectA = createRectElement({ id: 'rect-a', x: 40, y: 80 });
    const rectB = createRectElement({ id: 'rect-b', x: 20, y: 30 });
    const handle = automergeService.repo.create<TCanvasDoc>({ id: 'canvas-3', name: 'move-errors-canvas', elements: { [rectA.id]: rectA, [rectB.id]: rectB }, groups: {} });
    await handle.whenReady();
    const row = dbService.canvas.create({ id: 'canvas-3', automerge_url: handle.url, name: 'move-errors-canvas' });

    const result = await txExecuteCanvasMove({ dbService, automergeService }, { canvasId: row.id, canvasNameQuery: null, ids: [rectA.id], mode: 'absolute', x: 300, y: 120 });
    expect(result).toMatchObject({ ok: true, command: 'canvas.move', mode: 'absolute', delta: { dx: 260, dy: 40 }, changedIds: ['rect-a'] });
    expect(handle.doc()!.elements[rectA.id]?.x).toBe(300);
    expect(handle.doc()!.elements[rectA.id]?.y).toBe(120);

    await expect(txExecuteCanvasMove({ dbService, automergeService }, { canvasId: row.id, canvasNameQuery: null, ids: ['missing-id'], mode: 'relative', x: 1, y: 1 })).rejects.toMatchObject({ ok: false, command: 'canvas.move', code: 'CANVAS_MOVE_TARGET_NOT_FOUND' });
    await expect(txExecuteCanvasMove({ dbService, automergeService }, { canvasId: row.id, canvasNameQuery: null, ids: [rectA.id, rectB.id], mode: 'absolute', x: 10, y: 20 })).rejects.toMatchObject({ ok: false, command: 'canvas.move', code: 'CANVAS_MOVE_ABSOLUTE_REQUIRES_SINGLE_TARGET' });
  });
});
