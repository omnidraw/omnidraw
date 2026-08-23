import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { TCanvasItemSnapshot } from '@omnidraw/canvas-contract';
import { CanvasItemStoreTurso } from '../CanvasItemStoreTurso';
import { DbServiceTurso } from '../DbServiceTurso/DbServiceTurso';

type TSceneNode = TCanvasItemSnapshot['item'];

const CANVAS_ID = 'canvas-store-test';
const ELEMENT_ID = 'widget-element';
const INSTANCE_A = 'widget-instance-a';
const TIMESTAMP_SEC = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const transform = {
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  skew: { x: 0, y: 0 },
  origin: { x: 0, y: 0 },
};

function widget(instanceId: string): TSceneNode {
  return {
    id: ELEMENT_ID,
    parentId: null,
    orderKey: 'a',
    kind: 'widget-frame',
    transform,
    size: { width: 320, height: 240 },
    extensions: {
      'omnidraw:widget': {
        schemaVersion: 1,
        type: 'widget-instance',
        instanceId,
        widgetKey: 'counter',
      },
    },
  };
}

function group(id: string): TSceneNode {
  return {
    id,
    parentId: null,
    orderKey: 'a',
    kind: 'group',
    transform,
  };
}

function rectangle(id: string, parentId: string | null): TSceneNode {
  return {
    id,
    parentId,
    orderKey: 'a',
    kind: 'rect',
    transform,
    size: { width: 100, height: 80 },
  };
}

describe('single-user canvas item store', () => {
  let service: DbServiceTurso;
  let items: CanvasItemStoreTurso;

  beforeEach(async () => {
    service = new DbServiceTurso({ applicationVersion: 'test', databasePath: ':memory:', dataDir: '/tmp', cacheDir: '/tmp' });
    await service.start();
    await service.canvas.create({ id: CANVAS_ID, name: 'Store test' });
    items = new CanvasItemStoreTurso(service.db);
  });

  afterEach(async () => {
    await service.stop();
  });

  test('persists one authoritative item row with generated widget lookup keys', async () => {
    const committed = await items.applyMutations({
      commandId: 'insert-a',
      canvasId: CANVAS_ID,
      expectedCanvasRevision: 0,
      mutations: [{ type: 'insert', item: widget(INSTANCE_A) }],
    });

    expect(committed).toMatchObject({ status: 'committed', revision: 1 });
    if (committed.status !== 'committed') throw new Error('Expected a committed item.');
    expect(committed.changedItems[0]).toMatchObject({
      id: ELEMENT_ID,
      itemRevision: 1,
      createdAtSec: expect.stringMatching(TIMESTAMP_SEC),
      updatedAtSec: expect.stringMatching(TIMESTAMP_SEC),
    });
    expect(await items.findByWidgetInstance({ instanceId: INSTANCE_A })).toMatchObject({
      canvasId: CANVAS_ID,
      item: { id: ELEMENT_ID },
    });
    expect(await items.queryItems({
      canvasId: CANVAS_ID,
      filter: { type: 'widget-key', widgetKey: 'counter' },
    })).toMatchObject({ items: [{ id: ELEMENT_ID }], nextCursor: null });
    expect(await items.getSnapshot({ canvasId: CANVAS_ID })).toMatchObject({
      canvasId: CANVAS_ID,
      revision: 1,
      items: [{ id: ELEMENT_ID }],
    });
  });

  test('deduplicates a committed command durably across store instances', async () => {
    const request = {
      commandId: 'lost-ack-command',
      canvasId: CANVAS_ID,
      expectedCanvasRevision: 0,
      mutations: [{ type: 'insert', item: widget(INSTANCE_A) }],
    } as const;
    const first = await items.applyMutations(request);
    const restarted = new CanvasItemStoreTurso(service.db);
    const retry = await restarted.applyMutations(request);
    expect(first).toMatchObject({ status: 'committed', revision: 1 });
    expect(retry).toEqual({ ...first, duplicate: true });
    expect(await restarted.getRevision({ canvasId: CANVAS_ID })).toBe(1);
    expect((await restarted.getSnapshot({ canvasId: CANVAS_ID }))?.items).toHaveLength(1);
  });

  test('decodes parented item rows after validating the assembled hierarchy', async () => {
    const groupItem = group('group-a');
    const child = rectangle('rectangle-a', 'group-a');
    const committed = await items.applyMutations({
      commandId: 'insert-hierarchy',
      canvasId: CANVAS_ID,
      expectedCanvasRevision: 0,
      mutations: [
        { type: 'insert', item: groupItem },
        { type: 'insert', item: child },
      ],
    });

    expect(committed).toMatchObject({
      status: 'committed',
      revision: 1,
      changedItems: [
        { id: 'group-a' },
        { id: 'rectangle-a', item: { parentId: 'group-a' } },
      ],
    });
    expect(await items.getSnapshot({ canvasId: CANVAS_ID })).toMatchObject({
      revision: 1,
      items: [
        { id: 'group-a' },
        { id: 'rectangle-a', item: { parentId: 'group-a' } },
      ],
    });
  });
});
