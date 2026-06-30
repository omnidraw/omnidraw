import { createStartedAutomergeService, stopStartedAutomergeService, type TStartedAutomergeService } from './fixture.automerge';
import { DbServiceBunSqlite } from '@vibecanvas/service-db/DbServiceBunSqlite/index';
import type { TCanvasDoc, TElement, TGroup } from '@vibecanvas/service-automerge/types/canvas-doc.types';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { txExecuteCanvasReorder } from '@vibecanvas/canvas-cmds/cmds/tx.cmd.reorder';

function createRectElement(overrides?: Partial<TElement>): TElement {
  return { id: 'rect-1', x: 0, y: 0, rotation: 0, zIndex: 'a0', parentGroupId: null, bindings: [], locked: false, createdAt: 1, updatedAt: 1, data: { type: 'rect', w: 120, h: 80 }, style: { backgroundColor: '#ffffff', strokeColor: '#111111', strokeWidth: "@stroke-width/thin", opacity: 1 }, ...overrides };
}
function createGroup(overrides?: Partial<TGroup>): TGroup {
  return { id: 'group-1', parentGroupId: null, zIndex: 'a0', locked: false, createdAt: 1, ...overrides };
}
function orderedZIndex(index: number): string { return `z${String(index).padStart(8, '0')}`; }

describe('reorder canvas command', () => {
  let dbService!: DbServiceBunSqlite;
  let automergeService!: TStartedAutomergeService;
  let databasePath!: string;

  beforeEach(async () => {
    databasePath = join(tmpdir(), `canvas-cmds-reorder-${crypto.randomUUID()}.sqlite`);
    dbService = new DbServiceBunSqlite({ cacheDir: tmpdir(), databasePath, dataDir: tmpdir(), silentMigrations: true });
    await dbService.start();
    automergeService = await createStartedAutomergeService();
  });
  afterEach(async () => {
    await stopStartedAutomergeService(automergeService);
    await dbService.stop();
  });

  test('brings a middle element to the front and rewrites zIndices deterministically', async () => {
    const rectA = createRectElement({ id: 'rect-a', zIndex: 'a0' });
    const rectB = createRectElement({ id: 'rect-b', zIndex: 'a1' });
    const rectC = createRectElement({ id: 'rect-c', zIndex: 'a2' });
    const handle = automergeService.repo.create<TCanvasDoc>({ id: 'canvas-1', name: 'reorder-front-canvas', elements: { [rectA.id]: rectA, [rectB.id]: rectB, [rectC.id]: rectC }, groups: {} });
    await handle.whenReady();
    const row = dbService.canvas.create({ id: 'canvas-1', automerge_url: handle.url, name: 'reorder-front-canvas' });

    const result = await txExecuteCanvasReorder({ dbService, automergeService }, { canvasId: row.id, canvasNameQuery: null, ids: ['rect-a'], action: 'front' });
    expect(result.beforeOrder.map((entry) => entry.id)).toEqual(['rect-a', 'rect-b', 'rect-c']);
    expect(result.afterOrder.map((entry) => entry.id)).toEqual(['rect-b', 'rect-c', 'rect-a']);
    expect(result.afterOrder.map((entry) => entry.zIndex)).toEqual([orderedZIndex(0), orderedZIndex(1), orderedZIndex(2)]);
    expect(result.changedIds).toEqual(['rect-a', 'rect-b', 'rect-c']);
  });

  test('supports back, forward, backward and multi-select front', async () => {
    const createCanvas = async (id: string) => {
      const rectA = createRectElement({ id: 'rect-a', zIndex: 'a0' });
      const rectB = createRectElement({ id: 'rect-b', zIndex: 'a1' });
      const rectC = createRectElement({ id: 'rect-c', zIndex: 'a2' });
      const rectD = createRectElement({ id: 'rect-d', zIndex: 'a3' });
      const handle = automergeService.repo.create<TCanvasDoc>({ id, name: id, elements: { [rectA.id]: rectA, [rectB.id]: rectB, [rectC.id]: rectC, [rectD.id]: rectD }, groups: {} });
      await handle.whenReady();
      const row = dbService.canvas.create({ id, automerge_url: handle.url, name: id });
      return row;
    };

    const backRow = await createCanvas('canvas-2-back');
    expect((await txExecuteCanvasReorder({ dbService, automergeService }, { canvasId: backRow.id, canvasNameQuery: null, ids: ['rect-d'], action: 'back' })).afterOrder.map((entry) => entry.id)).toEqual(['rect-d', 'rect-a', 'rect-b', 'rect-c']);

    const forwardRow = await createCanvas('canvas-2-forward');
    expect((await txExecuteCanvasReorder({ dbService, automergeService }, { canvasId: forwardRow.id, canvasNameQuery: null, ids: ['rect-a'], action: 'forward' })).afterOrder.map((entry) => entry.id)).toEqual(['rect-b', 'rect-a', 'rect-c', 'rect-d']);

    const backwardRow = await createCanvas('canvas-2-backward');
    expect((await txExecuteCanvasReorder({ dbService, automergeService }, { canvasId: backwardRow.id, canvasNameQuery: null, ids: ['rect-c'], action: 'backward' })).afterOrder.map((entry) => entry.id)).toEqual(['rect-a', 'rect-c', 'rect-b', 'rect-d']);

    const frontRow = await createCanvas('canvas-2-front');
    expect((await txExecuteCanvasReorder({ dbService, automergeService }, { canvasId: frontRow.id, canvasNameQuery: null, ids: ['rect-a', 'rect-c'], action: 'front' })).afterOrder.map((entry) => entry.id)).toEqual(['rect-b', 'rect-d', 'rect-a', 'rect-c']);
  });

  test('fails clearly on no-op, parent mismatch, invalid action, missing target, missing ids', async () => {
    const group = createGroup({ id: 'group-parent' });
    const inside = createRectElement({ id: 'rect-inside', parentGroupId: group.id, zIndex: 'a0' });
    const outside = createRectElement({ id: 'rect-outside', zIndex: 'a1' });
    const handle = automergeService.repo.create<TCanvasDoc>({ id: 'canvas-3', name: 'reorder-errors-canvas', groups: { [group.id]: group }, elements: { [inside.id]: inside, [outside.id]: outside } });
    await handle.whenReady();
    const row = dbService.canvas.create({ id: 'canvas-3', automerge_url: handle.url, name: 'reorder-errors-canvas' });

    await expect(txExecuteCanvasReorder({ dbService, automergeService }, { canvasId: row.id, canvasNameQuery: null, ids: ['rect-outside'], action: 'front' })).rejects.toMatchObject({ ok: false, command: 'canvas.reorder', code: 'CANVAS_REORDER_NO_OP' });
    await expect(txExecuteCanvasReorder({ dbService, automergeService }, { canvasId: row.id, canvasNameQuery: null, ids: ['rect-inside', 'rect-outside'], action: 'front' })).rejects.toMatchObject({ ok: false, command: 'canvas.reorder', code: 'CANVAS_REORDER_PARENT_MISMATCH' });
    await expect(txExecuteCanvasReorder({ dbService, automergeService }, { canvasId: row.id, canvasNameQuery: null, ids: ['does-not-exist'], action: 'front' })).rejects.toMatchObject({ ok: false, command: 'canvas.reorder', code: 'CANVAS_REORDER_TARGET_NOT_FOUND' });
    await expect(txExecuteCanvasReorder({ dbService, automergeService }, { canvasId: row.id, canvasNameQuery: null, ids: [], action: 'front' })).rejects.toMatchObject({ ok: false, command: 'canvas.reorder', code: 'CANVAS_REORDER_ID_REQUIRED' });
  });
});
