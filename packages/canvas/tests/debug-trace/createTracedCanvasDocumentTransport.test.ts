import type {
  TCanvasEvent,
  TCanvasItemsChangedEvent,
} from '@vibecanvas/canvas-contract';
import { describe, expect, test, vi } from 'vitest';
import {
  createTracedCanvasDocumentTransport,
} from '../../src/debug-trace/createTracedCanvasDocumentTransport';
import type {
  TReproductionTraceEventInput,
} from '../../src/debug-trace/typed';
import type {
  TCanvasDocumentTransport,
} from '../../src/services/CanvasDocumentService';

function event(commandId = 'command-a'): TCanvasItemsChangedEvent {
  return {
    type: 'items-changed',
    canvasId: 'canvas-a',
    commandId,
    revision: 2,
    changedItems: [],
    deletedItemIds: ['node-a'],
  };
}

async function* events(values: readonly TCanvasEvent[]) {
  yield* values;
}

describe('traced canvas document transport', () => {
  test('records typed boundaries and counts without request or response bodies', async () => {
    let elapsed = 10;
    const emitted: TReproductionTraceEventInput[] = [];
    const base: TCanvasDocumentTransport = {
      getSnapshot: vi.fn(async () => ({
        canvasId: 'canvas-a',
        revision: 1,
        items: [],
      })),
      execute: vi.fn(async (command) => event(command.commandId)),
      subscribe: vi.fn(() => events([event('remote-a')])),
    };
    const traced = createTracedCanvasDocumentTransport(base, {
      emit(entry) {
        emitted.push(entry);
        elapsed += 2;
      },
      elapsedMs: () => elapsed,
      isRecording: () => true,
    });

    await traced.getSnapshot({ canvasId: 'canvas-a' });
    await traced.execute({
      canvasId: 'canvas-a',
      commandId: 'command-a',
      baseRevision: 1,
      operations: [{
        type: 'insert',
        item: {
          id: 'node-a',
          parentId: null,
          orderKey: 'A',
          kind: 'text',
          transform: {
            position: { x: 0, y: 0 },
            rotation: 0,
            scale: { x: 1, y: 1 },
            skew: { x: 0, y: 0 },
            origin: { x: 0, y: 0 },
          },
          text: 'private canvas text must not enter transport trace',
          style: { fontFamily: 'sans-serif', fontSize: 16 },
        },
      }],
      preconditions: [],
    });
    for await (const _event of traced.subscribe({
      canvasId: 'canvas-a',
      afterRevision: 1,
    })) {
      // Consumption is the assertion boundary.
    }

    expect(emitted.map((entry) => entry.type)).toEqual([
      'snapshot-dispatched',
      'snapshot-received',
      'execute-dispatched',
      'execute-received',
      'events-subscribed',
      'event-received',
      'events-ended',
    ]);
    const serialized = JSON.stringify(emitted);
    expect(serialized).not.toContain('private canvas text');
    expect(serialized).toContain('"operationTypes":["insert"]');
    expect(serialized).toContain('"affectedNodeIds":["node-a"]');
  });

  test('normalizes execute failures and preserves the original rejection', async () => {
    const emitted: TReproductionTraceEventInput[] = [];
    const failure = new Error('server rejected');
    const traced = createTracedCanvasDocumentTransport({
      getSnapshot: vi.fn(),
      execute: vi.fn(async () => {
        throw failure;
      }),
      subscribe: vi.fn(),
    } as unknown as TCanvasDocumentTransport, {
      emit: (entry) => emitted.push(entry),
      elapsedMs: () => 1,
      isRecording: () => true,
    });

    await expect(traced.execute({
      canvasId: 'canvas-a',
      commandId: 'command-a',
      baseRevision: 1,
      operations: [],
      preconditions: [],
    })).rejects.toBe(failure);
    expect(emitted.at(-1)).toMatchObject({
      type: 'execute-failed',
      correlation: { commandId: 'command-a' },
      data: {
        error: { name: 'Error', message: 'server rejected' },
      },
    });
  });
});
