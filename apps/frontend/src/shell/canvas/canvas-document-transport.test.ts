import { describe, expect, test } from 'bun:test';
import type { TCanvasEvent } from '@omnidraw/canvas-contract';
import { createCanvasDocumentTransport } from './canvas-document-transport-adapter';

describe('OSS canvas document transport', () => {
  test('returns the underlying RPC event iterator during cancellation', async () => {
    let closeCount = 0;
    let settleNext: ((result: IteratorResult<TCanvasEvent>) => void) | null = null;
    const events: AsyncIterableIterator<TCanvasEvent> = {
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
        settleNext?.(result);
        return result;
      },
    };
    const transport = createCanvasDocumentTransport({
      async snapshot({ canvasId }) {
        return [null, { schemaVersion: '1.0.0', canvasId, revision: 0, items: [] }];
      },
      async query({ canvasId }) {
        return [null, { canvasId, revision: 0, items: [], nextCursor: null }];
      },
      async execute(command) {
        return [null, {
          type: 'items-changed',
          canvasId: command.canvasId,
          commandId: command.commandId,
          revision: command.baseRevision + 1,
          changedItems: [],
          deletedItemIds: [],
        }];
      },
      async events() {
        return [null, events];
      },
    });
    const iterator = transport.subscribe({
      canvasId: 'canvas-a',
      afterRevision: 0,
    })[Symbol.asyncIterator]();
    const pending = iterator.next();
    await Promise.resolve();
    await iterator.return?.();

    expect(closeCount).toBe(1);
    expect(await pending).toEqual({ done: true, value: undefined });
  });

  test('settles cancellation before a deferred RPC stream finishes opening', async () => {
    let closeCount = 0;
    let openStream!: (
      result: readonly [null, AsyncIterable<TCanvasEvent>],
    ) => void;
    const streamOpening = new Promise<
      readonly [null, AsyncIterable<TCanvasEvent>]
    >((resolve) => {
      openStream = resolve;
    });
    const events: AsyncIterableIterator<TCanvasEvent> = {
      [Symbol.asyncIterator]() {
        return this;
      },
      next: () => new Promise(() => undefined),
      async return() {
        closeCount += 1;
        return { done: true, value: undefined };
      },
    };
    const transport = createCanvasDocumentTransport({
      async snapshot({ canvasId }) {
        return [null, { schemaVersion: '1.0.0', canvasId, revision: 0, items: [] }];
      },
      async query({ canvasId }) {
        return [null, { canvasId, revision: 0, items: [], nextCursor: null }];
      },
      async execute(command) {
        return [null, {
          type: 'items-changed',
          canvasId: command.canvasId,
          commandId: command.commandId,
          revision: command.baseRevision + 1,
          changedItems: [],
          deletedItemIds: [],
        }];
      },
      events: () => streamOpening,
    });
    const iterator = transport.subscribe({
      canvasId: 'canvas-a',
      afterRevision: 0,
    })[Symbol.asyncIterator]();
    const pending = iterator.next();
    let returnSettled = false;
    const closing = iterator.return?.().then(() => {
      returnSettled = true;
    });
    await Promise.resolve();

    expect(returnSettled).toBe(true);
    expect(await pending).toEqual({ done: true, value: undefined });

    openStream([null, events]);
    await closing;
    await Promise.resolve();
    await Promise.resolve();
    expect(closeCount).toBe(1);
  });

  test('waits for an opened RPC stream to finish closing', async () => {
    let releaseClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const events: AsyncIterableIterator<TCanvasEvent> = {
      [Symbol.asyncIterator]() {
        return this;
      },
      next: () => new Promise(() => undefined),
      async return() {
        await closeGate;
        return { done: true, value: undefined };
      },
    };
    const transport = createCanvasDocumentTransport({
      async snapshot({ canvasId }) {
        return [null, { schemaVersion: '1.0.0', canvasId, revision: 0, items: [] }];
      },
      async query({ canvasId }) {
        return [null, { canvasId, revision: 0, items: [], nextCursor: null }];
      },
      async execute(command) {
        return [null, {
          type: 'items-changed',
          canvasId: command.canvasId,
          commandId: command.commandId,
          revision: command.baseRevision + 1,
          changedItems: [],
          deletedItemIds: [],
        }];
      },
      async events() {
        return [null, events];
      },
    });
    const iterator = transport.subscribe({
      canvasId: 'canvas-a',
      afterRevision: 0,
    })[Symbol.asyncIterator]();
    const pending = iterator.next();
    await Promise.resolve();
    let returnSettled = false;
    const closing = iterator.return?.().then(() => {
      returnSettled = true;
    });
    await Promise.resolve();

    expect(returnSettled).toBe(false);
    expect(await pending).toEqual({ done: true, value: undefined });

    releaseClose();
    await closing;
    expect(returnSettled).toBe(true);
  });
});
