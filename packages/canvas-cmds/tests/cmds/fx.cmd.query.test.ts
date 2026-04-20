import { AutomergeService } from '@vibecanvas/service-automerge/AutomergeServer';
import { DbServiceBunSqlite } from '@vibecanvas/service-db/DbServiceBunSqlite/index';
import type { TCanvasDoc, TElement, TGroup } from 'packages/imperative-shell/src/automerge/index';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fxExecuteCanvasQuery, type TSceneSelectorEnvelope } from 'packages/canvas-cmds/src/cmds/fx.cmd.query';

function createRectElement(overrides?: Partial<TElement>): TElement {
  return {
    id: 'rect-1',
    x: 120,
    y: 240,
    rotation: 0,
    zIndex: 'a1',
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: 1712345678000,
    updatedAt: 1712345678999,
    data: {
      type: 'rect',
      w: 320,
      h: 180,
    },
    style: {
      backgroundColor: '#ffffff',
      strokeColor: '#111111',
      strokeWidth: "@stroke-width/thin",
      opacity: 1,
    },
    ...overrides,
  };
}

function createGroup(overrides?: Partial<TGroup>): TGroup {
  return {
    id: 'group-root',
    parentGroupId: null,
    zIndex: 'a0',
    locked: false,
    createdAt: 1712000000000,
    ...overrides,
  };
}

describe('query canvas command', () => {
  let dbService!: DbServiceBunSqlite;
  let automergeService!: AutomergeService;
  let databasePath!: string;

  beforeEach(async () => {
    databasePath = join(tmpdir(), `canvas-cmds-query-${crypto.randomUUID()}.sqlite`);
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

  test('matches exact ids and defaults to summary mode', async () => {
    const group = createGroup();
    const rect = createRectElement({ parentGroupId: group.id });
    const handle = automergeService.repo.create<TCanvasDoc>({
      id: 'canvas-1',
      name: 'Query Canvas',
      elements: { [rect.id]: rect },
      groups: { [group.id]: group },
    });
    await handle.whenReady();

    const row = dbService.canvas.create({
      id: 'canvas-1',
      automerge_url: handle.url,
      name: 'Query Canvas',
    });

    const selector: TSceneSelectorEnvelope = {
      source: 'flags',
      canvasId: row.id,
      canvasNameQuery: null,
      filters: {
        ids: [group.id, rect.id],
        kinds: [],
        types: [],
        style: {},
        group: null,
        subtree: null,
        bounds: null,
        boundsMode: 'intersects',
      },
    };

    const result = await fxExecuteCanvasQuery({ dbService, automergeService }, { selector });

    expect(result).toMatchObject({
      ok: true,
      command: 'canvas.query',
      mode: 'summary',
      selector,
      canvas: {
        id: row.id,
        name: row.name,
        automergeUrl: row.automerge_url,
      },
      count: 2,
      matches: [
        {
          metadata: {
            kind: 'group',
            id: group.id,
            type: null,
            parentGroupId: null,
            zIndex: 'a0',
            bounds: { x: 120, y: 240, w: 320, h: 180 },
          },
          payload: {
            kind: 'group',
            id: group.id,
            data: null,
            style: null,
            directChildElementIds: [rect.id],
            directChildGroupIds: [],
            directChildElementCount: 1,
            directChildGroupCount: 0,
          },
        },
        {
          metadata: {
            kind: 'element',
            id: rect.id,
            type: 'rect',
            parentGroupId: group.id,
            zIndex: 'a1',
            bounds: { x: 120, y: 240, w: 320, h: 180 },
          },
          payload: {
            kind: 'element',
            id: rect.id,
            type: 'rect',
            parentGroupId: group.id,
            position: { x: 120, y: 240 },
            createdAt: 1712345678000,
            updatedAt: 1712345678999,
            data: { type: 'rect', w: 320, h: 180 },
            style: { backgroundColor: '#ffffff', strokeColor: '#111111', strokeWidth: "@stroke-width/thin", opacity: 1 },
          },
        },
      ],
    });
  });

  test('filters by type and exact style and can omit data/style', async () => {
    const red = createRectElement({
      id: 'rect-red',
      zIndex: 'a0',
      style: { backgroundColor: '#ff0000', strokeColor: '#aa0000', strokeWidth: "2", opacity: 0.8 },
    });
    const blue = createRectElement({
      id: 'rect-blue',
      zIndex: 'a1',
      style: { backgroundColor: '#0000ff', strokeColor: '#0000aa', strokeWidth: "2", opacity: 0.8 },
    });

    const handle = automergeService.repo.create<TCanvasDoc>({
      id: 'canvas-2',
      name: 'Style Canvas',
      elements: { [red.id]: red, [blue.id]: blue },
      groups: {},
    });
    await handle.whenReady();

    const row = dbService.canvas.create({
      id: 'canvas-2',
      automerge_url: handle.url,
      name: 'Style Canvas',
    });

    const result = await fxExecuteCanvasQuery(
      { dbService, automergeService },
      {
        selector: {
          source: 'query',
          canvasId: row.id,
          canvasNameQuery: null,
          filters: {
            ids: [],
            kinds: [],
            types: ['rect'],
            style: { backgroundColor: '#ff0000' },
            group: null,
            subtree: null,
            bounds: null,
            boundsMode: 'intersects',
          },
        },
        omitData: true,
        omitStyle: true,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      command: 'canvas.query',
      mode: 'summary',
      count: 1,
      matches: [
        {
          metadata: { kind: 'element', id: 'rect-red', type: 'rect' },
          payload: { kind: 'element', id: 'rect-red', type: 'rect' },
        },
      ],
    });
    expect(result.matches[0]?.payload).not.toHaveProperty('data');
    expect(result.matches[0]?.payload).not.toHaveProperty('style');
  });

  test('treats blank canvasNameQuery as missing selector', async () => {
    await expect(
      fxExecuteCanvasQuery({ dbService, automergeService }, {
        selector: {
          source: 'query',
          canvasId: null,
          canvasNameQuery: '   ',
          filters: {
            ids: [],
            kinds: [],
            types: [],
            style: {},
            group: null,
            subtree: null,
            bounds: null,
            boundsMode: 'intersects',
          },
        },
      }),
    ).rejects.toMatchObject({
      ok: false,
      command: 'canvas.query',
      code: 'CANVAS_SELECTOR_REQUIRED',
      canvasId: null,
      canvasNameQuery: null,
    });
  });
});
