import { AutomergeService } from '@vibecanvas/service-automerge/AutomergeService';
import { DbServiceBunSqlite } from '@vibecanvas/service-db/DbServiceBunSqlite/index';
import type { TCanvasDoc, TElement, TGroup } from '@vibecanvas/service-automerge/types/canvas-doc';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { txExecuteCanvasPatch } from 'packages/canvas-cmds/src/cmds/tx.cmd.patch';

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
    updatedAt: 100,
    data: { type: 'rect', w: 120, h: 80 },
    style: { backgroundColor: '#ffffff', strokeColor: '#111111', strokeWidth: "@stroke-width/thin", opacity: 1, fontSize: '@text/s', textAlign: 'left', verticalAlign: 'top' },
    ...overrides,
  };
}

function createTextElement(overrides?: Partial<TElement>): TElement {
  return {
    id: 'text-1',
    x: 10,
    y: 20,
    rotation: 0,
    zIndex: 'a0',
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 10,
    data: {
      type: 'text',
      w: 100,
      h: 40,
      text: 'hello',
      originalText: 'hello',
      fontFamily: 'Inter',
      link: null,
      containerId: null,
      autoResize: false,
    },
    style: { backgroundColor: '#ffffff', strokeColor: '#111111', strokeWidth: "@stroke-width/thin", opacity: 1, fontSize: '@text/s', textAlign: 'left', verticalAlign: 'top' },
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

describe('patch canvas command', () => {
  let dbService!: DbServiceBunSqlite;
  let automergeService!: AutomergeService;
  let databasePath!: string;

  beforeEach(async () => {
    databasePath = join(tmpdir(), `canvas-cmds-patch-${crypto.randomUUID()}.sqlite`);
    dbService = new DbServiceBunSqlite({
      cacheDir: tmpdir(),
      databasePath,
      dataDir: tmpdir(),
      silentMigrations: true,
    });
    await dbService.start();
    automergeService = new AutomergeService(databasePath);
  });

  afterEach(async () => {
    automergeService.stop();
    await dbService.stop();
  });

  test('patches one explicit element id and reports stable changed ids', async () => {
    const rect = createRectElement({ id: 'rect-1' });
    const other = createRectElement({ id: 'rect-2', x: 400, y: 500 });
    const handle = automergeService.repo.create<TCanvasDoc>({
      id: 'canvas-1',
      name: 'Patch Canvas',
      elements: { [rect.id]: rect, [other.id]: other },
      groups: {},
    });
    await handle.whenReady();

    const row = dbService.canvas.create({
      id: 'canvas-1',
      automerge_url: handle.url,
      name: 'Patch Canvas',
    });

    const result = await txExecuteCanvasPatch(
      { dbService, automergeService },
      {
        canvasId: row.id,
        canvasNameQuery: null,
        ids: [rect.id],
        patch: { element: { x: 55, style: { backgroundColor: '#ff0000' } } },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      command: 'canvas.patch',
      matchedCount: 1,
      matchedIds: ['rect-1'],
      changedCount: 1,
      changedIds: ['rect-1'],
      patch: {
        element: {
          x: 55,
          style: { backgroundColor: '#ff0000' },
        },
      },
    });

    const doc = handle.doc()!;
    expect(doc.elements['rect-1']?.x).toBe(55);
    expect(doc.elements['rect-1']?.style.backgroundColor).toBe('#ff0000');
    expect(doc.elements['rect-1']?.updatedAt).toBeGreaterThan(100);
    expect(doc.elements['rect-2']?.x).toBe(400);
  });

  test('patches one text element data shallowly', async () => {
    const text = createTextElement({ id: 'text-1' });
    const rect = createRectElement({ id: 'rect-1', updatedAt: 20 });
    const handle = automergeService.repo.create<TCanvasDoc>({
      id: 'canvas-2',
      name: 'Patch Text Canvas',
      elements: { [text.id]: text, [rect.id]: rect },
      groups: {},
    });
    await handle.whenReady();

    const row = dbService.canvas.create({
      id: 'canvas-2',
      automerge_url: handle.url,
      name: 'Patch Text Canvas',
    });

    const result = await txExecuteCanvasPatch(
      { dbService, automergeService },
      {
        canvasId: row.id,
        canvasNameQuery: null,
        ids: [text.id],
        patch: {
          element: {
            data: {
              text: 'patched',
              originalText: 'patched',
            },
          },
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      command: 'canvas.patch',
      matchedCount: 1,
      matchedIds: ['text-1'],
      changedCount: 1,
      changedIds: ['text-1'],
    });

    const doc = handle.doc()!;
    expect(doc.elements['text-1']?.data.type).toBe('text');
    if (doc.elements['text-1']?.data.type !== 'text') throw new Error('expected text');
    expect(doc.elements['text-1'].data.text).toBe('patched');
    expect(doc.elements['text-1'].data.originalText).toBe('patched');
    expect(doc.elements['rect-1']?.data.type).toBe('rect');
  });

  test('patches one group', async () => {
    const group = createGroup({ id: 'group-1', locked: false });
    const handle = automergeService.repo.create<TCanvasDoc>({
      id: 'canvas-3',
      name: 'Patch Group Canvas',
      elements: {},
      groups: { [group.id]: group },
    });
    await handle.whenReady();

    const row = dbService.canvas.create({
      id: 'canvas-3',
      automerge_url: handle.url,
      name: 'Patch Group Canvas',
    });

    const result = await txExecuteCanvasPatch(
      { dbService, automergeService },
      {
        canvasId: row.id,
        canvasNameQuery: null,
        ids: [group.id],
        patch: { group: { locked: true } },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      command: 'canvas.patch',
      matchedCount: 1,
      matchedIds: ['group-1'],
      changedCount: 1,
      changedIds: ['group-1'],
      patch: { group: { locked: true } },
    });

    expect(handle.doc()!.groups['group-1']?.locked).toBe(true);
  });

  test('reports zero changed ids for a no-op patch', async () => {
    const rect = createRectElement({ id: 'rect-1', locked: false, updatedAt: 123 });
    const handle = automergeService.repo.create<TCanvasDoc>({
      id: 'canvas-4',
      name: 'Patch Noop Canvas',
      elements: { [rect.id]: rect },
      groups: {},
    });
    await handle.whenReady();

    const row = dbService.canvas.create({
      id: 'canvas-4',
      automerge_url: handle.url,
      name: 'Patch Noop Canvas',
    });

    const result = await txExecuteCanvasPatch(
      { dbService, automergeService },
      {
        canvasId: row.id,
        canvasNameQuery: null,
        ids: [rect.id],
        patch: { element: { locked: false } },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      command: 'canvas.patch',
      matchedCount: 1,
      matchedIds: ['rect-1'],
      changedCount: 0,
      changedIds: [],
    });

    expect(handle.doc()!.elements['rect-1']?.updatedAt).toBe(123);
  });

  test('fails on invalid field/type combinations', async () => {
    const rect = createRectElement({ id: 'rect-1' });
    const handle = automergeService.repo.create<TCanvasDoc>({
      id: 'canvas-5',
      name: 'Patch Invalid Canvas',
      elements: { [rect.id]: rect },
      groups: {},
    });
    await handle.whenReady();

    const row = dbService.canvas.create({
      id: 'canvas-5',
      automerge_url: handle.url,
      name: 'Patch Invalid Canvas',
    });

    await expect(
      txExecuteCanvasPatch(
        { dbService, automergeService },
        {
          canvasId: row.id,
          canvasNameQuery: null,
          ids: [rect.id],
          patch: { element: { data: { text: 'wrong' } } },
        },
      ),
    ).rejects.toMatchObject({
      ok: false,
      command: 'canvas.patch',
      code: 'CANVAS_PATCH_PAYLOAD_INVALID',
      message: "Patch field 'element.data.text' is invalid for element 'rect-1' of type 'rect'.",
    });
  });
});
