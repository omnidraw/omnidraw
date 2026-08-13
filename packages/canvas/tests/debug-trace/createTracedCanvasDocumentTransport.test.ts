import type {
  TCanvasDocumentTransport,
  TCanvasEvent,
  TCanvasItemsChangedEvent,
} from '@omnidraw/canvas-contract';
import { describe, expect, test, vi } from 'vitest';
import {
  createTracedCanvasDocumentTransport,
} from '../../src/debug-trace/createTracedCanvasDocumentTransport';
import type {
  TReproductionTraceEventInput,
} from '../../src/debug-trace/typed';

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
        schemaVersion: '1.0.0',
        canvasId: 'canvas-a',
        revision: 1,
        items: [],
      })),
      query: vi.fn(async () => ({ items: [], nextCursor: null })),
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
    await traced.query({
      canvasId: 'canvas-a',
      filter: { type: 'kind', kind: 'text' },
      limit: 20,
    });
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
      'query-dispatched',
      'query-received',
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
    expect(serialized).toContain('"filterType":"kind"');
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

  test('forwards return while the underlying next call is pending', async () => {
    const emitted: TReproductionTraceEventInput[] = [];
    let closeCount = 0;
    let settleNext!: (result: IteratorResult<TCanvasEvent>) => void;
    const subscription: AsyncIterableIterator<TCanvasEvent> = {
      [Symbol.asyncIterator]() {
        return this;
      },
      next() {
        return new Promise((resolve) => {
          settleNext = resolve;
        });
      },
      async return() {
        closeCount += 1;
        const result = { done: true, value: undefined } as const;
        settleNext(result);
        return result;
      },
    };
    const traced = createTracedCanvasDocumentTransport({
      getSnapshot: vi.fn(),
      execute: vi.fn(),
      subscribe: () => subscription,
    } as unknown as TCanvasDocumentTransport, {
      emit: (entry) => emitted.push(entry),
      elapsedMs: () => 1,
      isRecording: () => true,
    });
    const iterator = traced.subscribe({
      canvasId: 'canvas-a',
      afterRevision: 1,
    })[Symbol.asyncIterator]();
    const pending = iterator.next();
    await iterator.return?.();

    expect(closeCount).toBe(1);
    expect(await pending).toEqual({ done: true, value: undefined });
    expect(emitted.map((entry) => entry.type)).toEqual([
      'events-subscribed',
      'events-ended',
    ]);
  });
});
