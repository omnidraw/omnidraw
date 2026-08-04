import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { TCanvasItemSnapshot } from '@omnidraw/canvas-contract';
import { CanvasItemStoreTurso } from '../CanvasItemStoreTurso';
import { DbServiceTurso } from '../DbServiceTurso/DbServiceTurso';
import { WidgetInstanceStateStoreTurso } from '../WidgetInstanceStateStoreTurso';

type TSceneNode = TCanvasItemSnapshot['item'];

const CANVAS_ID = 'canvas-store-test';
const ELEMENT_ID = 'widget-element';
const INSTANCE_A = 'widget-instance-a';
const INSTANCE_B = 'widget-instance-b';
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

describe('single-user canvas and widget state stores', () => {
  let service: DbServiceTurso;
  let items: CanvasItemStoreTurso;
  let states: WidgetInstanceStateStoreTurso;

  beforeEach(async () => {
    service = new DbServiceTurso({ databasePath: ':memory:', dataDir: '/tmp', cacheDir: '/tmp' });
    await service.start();
    await service.canvas.create({ id: CANVAS_ID, name: 'Store test' });
    items = new CanvasItemStoreTurso(service.db);
    states = new WidgetInstanceStateStoreTurso(service.db);
  });

  afterEach(async () => {
    await service.stop();
  });

  test('persists one authoritative item row with generated widget lookup keys', async () => {
    const committed = await items.applyMutations({
      canvasId: CANVAS_ID,
      expectedCanvasRevision: 0,
      mutations: [{ type: 'insert', item: widget(INSTANCE_A) }],
    });

    expect(committed).toMatchObject({ status: 'committed', revision: 1 });
    if (committed.status !== 'committed') throw new Error('Expected a committed item.');
    expect(committed.changedItems[0]).toMatchObject({
      id: ELEMENT_ID,
      itemRevision: 0,
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

  test('authorizes state only for the exact current widget instance and resets on replacement', async () => {
    await items.applyMutations({
      canvasId: CANVAS_ID,
      expectedCanvasRevision: 0,
      mutations: [{ type: 'insert', item: widget(INSTANCE_A) }],
    });
    const identityA = { canvasId: CANVAS_ID, elementId: ELEMENT_ID, widgetInstanceId: INSTANCE_A };
    expect(await states.getAuthorizedExactInstance({
      identity: identityA,
      initialSnapshot: { version: 1, state: { count: 0 } },
    })).toEqual({ status: 'found', snapshot: { version: 1, state: { count: 0 } } });
    expect(await states.compareAndSwapAuthorizedExactInstance({
      identity: identityA,
      initialSnapshot: { version: 1, state: { count: 0 } },
      expectedVersion: 1,
      state: { count: 1 },
    })).toEqual({ status: 'changed', snapshot: { version: 2, state: { count: 1 } } });
    expect(await states.compareAndSwapAuthorizedExactInstance({
      identity: identityA,
      initialSnapshot: { version: 1, state: { count: 0 } },
      expectedVersion: 1,
      state: { count: 2 },
    })).toEqual({ status: 'conflict', snapshot: { version: 2, state: { count: 1 } } });

    await items.applyMutations({
      canvasId: CANVAS_ID,
      expectedCanvasRevision: 1,
      mutations: [{
        type: 'replace',
        expectedItemRevision: 0,
        item: widget(INSTANCE_B),
      }],
    });
    expect(await states.getAuthorizedExactInstance({
      identity: identityA,
      initialSnapshot: { version: 1, state: null },
    })).toEqual({ status: 'unavailable' });
    expect(await states.getAuthorizedExactInstance({
      identity: { ...identityA, widgetInstanceId: INSTANCE_B },
      initialSnapshot: { version: 1, state: { fresh: true } },
    })).toEqual({ status: 'found', snapshot: { version: 1, state: { fresh: true } } });
  });

  test('composite state foreign key removes state when its canvas item is deleted', async () => {
    await items.applyMutations({
      canvasId: CANVAS_ID,
      expectedCanvasRevision: 0,
      mutations: [{ type: 'insert', item: widget(INSTANCE_A) }],
    });
    await states.getAuthorizedExactInstance({
      identity: { canvasId: CANVAS_ID, elementId: ELEMENT_ID, widgetInstanceId: INSTANCE_A },
      initialSnapshot: { version: 1, state: {} },
    });
    await items.applyMutations({
      canvasId: CANVAS_ID,
      expectedCanvasRevision: 1,
      mutations: [{ type: 'delete', itemId: ELEMENT_ID, expectedItemRevision: 0 }],
    });
    expect(await (await service.db.prepare(
      'SELECT count(*) AS count FROM widget_instance_states',
    )).get()).toEqual({ count: 0 });
  });
});
