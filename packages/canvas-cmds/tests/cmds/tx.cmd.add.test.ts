import { AutomergeService } from '@vibecanvas/service-automerge/AutomergeServer';
import { DbServiceBunSqlite } from '@vibecanvas/service-db/DbServiceBunSqlite/index';
import type { TCanvasDoc, TGroup } from '@vibecanvas/service-automerge/types/canvas-doc';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { txExecuteCanvasAdd } from 'packages/canvas-cmds/src/cmds/tx.cmd.add';

function createGroup(overrides?: Partial<TGroup>): TGroup {
  return { id: 'group-1', parentGroupId: null, zIndex: 'a0', locked: false, createdAt: 1, ...overrides };
}

describe('add canvas command', () => {
  let dbService!: DbServiceBunSqlite;
  let automergeService!: AutomergeService;
  let databasePath!: string;

  beforeEach(async () => {
    databasePath = join(tmpdir(), `canvas-cmds-add-${crypto.randomUUID()}.sqlite`);
    dbService = new DbServiceBunSqlite({ cacheDir: tmpdir(), databasePath, dataDir: tmpdir(), silentMigrations: true });
    await dbService.start();
    automergeService = new AutomergeService(databasePath);
  });
  afterEach(async () => {
    automergeService.stop();
    await dbService.stop();
  });

  test('adds multiple primitive elements with deterministic zIndex progression', async () => {
    const parent = createGroup({ id: 'group-parent', zIndex: 'z00000000' });
    const handle = automergeService.repo.create<TCanvasDoc>({ id: 'canvas-1', name: 'add-canvas', elements: {}, groups: { [parent.id]: parent } });
    await handle.whenReady();
    const row = dbService.canvas.create({ id: 'canvas-1', automerge_url: handle.url, name: 'add-canvas' });

    const result = await txExecuteCanvasAdd({ dbService, automergeService, crypto }, {
      canvasId: row.id,
      canvasNameQuery: null,
      elements: [
        { type: 'rect', x: 10, y: 20, parentGroupId: parent.id },
        { id: 'text-1', type: 'text', x: 30, y: 40, data: { text: 'patched', originalText: 'patched' } },
        { type: 'arrow', x: 50, y: 60 },
      ],
    });

    expect(result).toMatchObject({ ok: true, command: 'canvas.add', addedCount: 3, addedIds: expect.arrayContaining(['text-1']) });
    expect(result.elements.map((entry) => entry.zIndex)).toEqual(['z00000001', 'z00000002', 'z00000003']);

    const doc = handle.doc()!;
    expect(Object.keys(doc.elements)).toHaveLength(3);
    expect(doc.elements['text-1']?.data.type).toBe('text');
    if (doc.elements['text-1']?.data.type !== 'text') throw new Error('expected text');
    expect(doc.elements['text-1'].data.text).toBe('patched');
  });

  test('fills defaults for minimal payloads', async () => {
    const handle = automergeService.repo.create<TCanvasDoc>({ id: 'canvas-3', name: 'add-defaults-canvas', elements: {}, groups: {} });
    await handle.whenReady();
    const row = dbService.canvas.create({ id: 'canvas-3', automerge_url: handle.url, name: 'add-defaults-canvas' });

    const result = await txExecuteCanvasAdd({ dbService, automergeService, crypto }, {
      canvasId: row.id,
      canvasNameQuery: null,
      elements: [
        { type: 'rect' },
        { type: 'text' },
      ],
    });

    expect(result).toMatchObject({ ok: true, command: 'canvas.add', addedCount: 2 });

    const doc = handle.doc()!;
    const rectId = result.elements.find((element) => element.type === 'rect')?.id;
    const textId = result.elements.find((element) => element.type === 'text')?.id;
    const rect = rectId ? doc.elements[rectId] : undefined;
    const text = textId ? doc.elements[textId] : undefined;
    expect(rect?.x).toBe(0);
    expect(rect?.y).toBe(0);
    expect(rect?.rotation).toBe(0);
    expect(rect?.locked).toBe(false);
    expect(rect?.style.backgroundColor).toBe('#ffffff');
    expect(rect?.style.strokeColor).toBe('#111111');
    expect(rect?.style.strokeWidth).toBe('@stroke-width/thin');
    expect(rect?.style.opacity).toBe(1);
    expect(rect?.data.type).toBe('rect');
    if (rect?.data.type !== 'rect') throw new Error('expected rect');
    expect(rect.data.w).toBe(120);
    expect(rect.data.h).toBe(80);
    expect(text?.data.type).toBe('text');
    if (text?.data.type !== 'text') throw new Error('expected text');
    expect(text.data.text).toBe('hello');
    expect(text.data.originalText).toBe('hello');
    expect(text.data.w).toBe(120);
    expect(text.data.h).toBe(40);
    expect(text.data.fontFamily).toBe('Inter');
    expect(text.style.fontSize).toBe('@text/s');
    expect(text.style.textAlign).toBe('left');
    expect(text.style.verticalAlign).toBe('top');
    expect(text.data.autoResize).toBe(false);
  });

  test('fails on parent group not found and id conflict', async () => {
    const existing = createGroup({ id: 'group-existing' });
    const handle = automergeService.repo.create<TCanvasDoc>({ id: 'canvas-2', name: 'add-errors-canvas', elements: { 'rect-1': { id: 'rect-1', x: 0, y: 0, rotation: 0, zIndex: 'z00000000', parentGroupId: null, bindings: [], locked: false, createdAt: 1, updatedAt: 1, data: { type: 'rect', w: 120, h: 80 }, style: { backgroundColor: '#ffffff', strokeColor: '#111111', strokeWidth: "@stroke-width/thin", opacity: 1 } } }, groups: { [existing.id]: existing } });
    await handle.whenReady();
    const row = dbService.canvas.create({ id: 'canvas-2', automerge_url: handle.url, name: 'add-errors-canvas' });

    await expect(txExecuteCanvasAdd({ dbService, automergeService, crypto }, { canvasId: row.id, canvasNameQuery: null, elements: [{ type: 'rect', parentGroupId: 'missing-group' }] })).rejects.toMatchObject({ ok: false, command: 'canvas.add', code: 'CANVAS_ADD_PARENT_GROUP_NOT_FOUND' });
    await expect(txExecuteCanvasAdd({ dbService, automergeService, crypto }, { canvasId: row.id, canvasNameQuery: null, elements: [{ id: 'rect-1', type: 'rect' }] })).rejects.toMatchObject({ ok: false, command: 'canvas.add', code: 'CANVAS_ADD_ID_CONFLICT' });
    await expect(txExecuteCanvasAdd({ dbService, automergeService, crypto }, { canvasId: row.id, canvasNameQuery: null, elements: [{} as any] })).rejects.toMatchObject({ ok: false, command: 'canvas.add', code: 'CANVAS_ADD_TYPE_REQUIRED' });
  });
});
