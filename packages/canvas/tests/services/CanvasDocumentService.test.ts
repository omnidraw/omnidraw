import type {
  IInfiniteCanvasEngine,
  TRectNode,
} from '@omnidraw/cangine';
import {
  CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
} from '@vibecanvas/canvas-contract/CONSTANTS';
import type {
  TCanvasCommand,
  TCanvasEvent,
  TCanvasItemsChangedEvent,
} from '@vibecanvas/canvas-contract';
import { describe, expect, test, vi } from 'vitest';
import {
  CanvasDocumentService,
  type TCanvasDocumentTransport,
} from '../../src/services/CanvasDocumentService';

const transform = {
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  skew: { x: 0, y: 0 },
  origin: { x: 0, y: 0 },
};

function rect(x = 0): TRectNode {
  return {
    id: 'rect-a',
    parentId: null,
    orderKey: 'A',
    kind: 'rect',
    transform: {
      ...transform,
      position: { x, y: 0 },
    },
    size: { width: 100, height: 60 },
  };
}

function runtimeNode(node: TRectNode): TRectNode {
  return {
    ...node,
    parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
  };
}

describe('CanvasDocumentService', () => {
  test('loads a snapshot, sends touched-path commands, and applies committed rows', async () => {
    const before = rect();
    const after = rect(25);
    const committed: TCanvasItemsChangedEvent = {
      type: 'items-changed',
      canvasId: 'canvas-a',
      commandId: 'command-a',
      revision: 1,
      changedItems: [{
        id: after.id,
        item: after,
        itemRevision: 2,
        createdAtMs: 1,
        updatedAtMs: 2,
      }],
      deletedItemIds: [],
    };
    const execute = vi.fn(async (_command: TCanvasCommand) => committed);
    let finishSubscription!: () => void;
    const subscriptionDone = new Promise<IteratorResult<TCanvasEvent>>((resolve) => {
      finishSubscription = () => resolve({ done: true, value: undefined });
    });
    const eventIterator: AsyncIterator<TCanvasEvent> = {
      next: () => subscriptionDone,
      return: async () => {
        finishSubscription();
        return { done: true, value: undefined };
      },
    };
    const transport: TCanvasDocumentTransport = {
      getSnapshot: vi.fn(async () => ({
        canvasId: 'canvas-a',
        revision: 0,
        items: [{
          id: before.id,
          item: before,
          itemRevision: 1,
          createdAtMs: 1,
          updatedAtMs: 1,
        }],
      })),
      execute,
      subscribe: vi.fn(() => ({
        [Symbol.asyncIterator]: () => eventIterator,
      })),
    };

    let recorderListener: ((entry: never) => void) | null = null;
    const unsubscribeRecorder = vi.fn();
    const replace = vi.fn();
    const apply = vi.fn();
    const engine = {
      recorder: {
        subscribe(listener: (entry: never) => void) {
          recorderListener = listener;
          return unsubscribeRecorder;
        },
      },
      scene: {
        replace,
        apply,
        get: (id: string) => id === after.id ? runtimeNode(after) : null,
      },
    } as unknown as IInfiniteCanvasEngine;
    const errors: unknown[] = [];
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport,
      createCommandId: () => 'command-a',
      onError: (error) => errors.push(error),
    });

    await service.start(engine);

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0]?.[0].nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
          kind: 'layer',
        }),
        expect.objectContaining({
          id: before.id,
          parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
        }),
      ]),
    );

    recorderListener!({
      meta: {},
      change: {
        source: 'editor',
        added: [],
        updated: [before.id],
        removed: [],
        reparented: [],
        reordered: [],
      },
      before: {
        [before.id]: runtimeNode(before),
      },
    } as never);

    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      commandId: 'command-a',
      canvasId: 'canvas-a',
      baseRevision: 0,
      operations: [{
        type: 'patch',
        itemId: before.id,
        patches: [{
          type: 'set',
          path: ['transform', 'position', 'x'],
          value: 25,
        }],
      }],
      preconditions: [{
        type: 'path-value',
        itemId: before.id,
        path: ['transform', 'position', 'x'],
        value: 0,
      }],
    });
    expect(apply).toHaveBeenCalledWith(
      [{
        type: 'upsert',
        node: expect.objectContaining({
          id: after.id,
          parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
        }),
      }],
      { source: 'vibecanvas:server' },
    );
    expect(service.revision).toBe(1);
    expect(errors).toEqual([]);

    await service.dispose();
    expect(unsubscribeRecorder).toHaveBeenCalledTimes(1);
  });
});
