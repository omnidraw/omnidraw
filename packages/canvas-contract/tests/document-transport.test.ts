import { describe, expect, test } from "bun:test";
import type {
  TCanvasDescriptor,
  TCanvasDocumentTransport,
  TCanvasEvent,
} from "../src";

describe("TCanvasDocumentTransport", () => {
  test("keeps the public descriptor intentionally minimal", () => {
    const descriptor = { id: "canvas-a" } satisfies TCanvasDescriptor;

    expect(descriptor).toEqual({ id: "canvas-a" });
  });

  test("allows adapters to close a pending subscription on iterator return", async () => {
    let closeCount = 0;
    let settlePending: ((result: IteratorResult<TCanvasEvent>) => void) | undefined;

    const subscription: AsyncIterableIterator<TCanvasEvent> = {
      [Symbol.asyncIterator]() {
        return this;
      },
      next() {
        return new Promise<IteratorResult<TCanvasEvent>>((resolve) => {
          settlePending = resolve;
        });
      },
      async return() {
        closeCount += 1;
        const result = { done: true, value: undefined } as const;
        settlePending?.(result);
        return result;
      },
    };
    const transport: TCanvasDocumentTransport = {
      async getSnapshot({ canvasId }) {
        return {
          schemaVersion: "1.0.0",
          canvasId,
          revision: 0,
          items: [],
        };
      },
      async query() {
        return { items: [], nextCursor: null };
      },
      async execute(command) {
        return {
          type: "items-changed",
          canvasId: command.canvasId,
          commandId: command.commandId,
          revision: command.baseRevision + 1,
          changedItems: [],
          deletedItemIds: [],
        };
      },
      subscribe() {
        return subscription;
      },
    };

    const iterator = transport.subscribe({
      canvasId: "canvas-a",
      afterRevision: 0,
    })[Symbol.asyncIterator]();
    const pending = iterator.next();
    await iterator.return?.();

    expect(closeCount).toBe(1);
    expect(await pending).toEqual({ done: true, value: undefined });
  });

  test("includes querying in the protocol-neutral transport", async () => {
    const transport: TCanvasDocumentTransport = {
      async getSnapshot({ canvasId }) {
        return { schemaVersion: "1.0.0", canvasId, revision: 0, items: [] };
      },
      async query() {
        return { items: [], nextCursor: null };
      },
      async execute(command) {
        return {
          type: "items-changed",
          canvasId: command.canvasId,
          commandId: command.commandId,
          revision: command.baseRevision + 1,
          changedItems: [],
          deletedItemIds: [],
        };
      },
      async *subscribe() {}
    };
    expect(await transport.query({ canvasId: "canvas-a", filter: { type: "all" } }))
      .toEqual({ items: [], nextCursor: null });
  });
});
