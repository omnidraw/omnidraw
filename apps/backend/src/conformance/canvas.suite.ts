import type {
  TCanvasCommand,
  TCanvasEvent,
  TCanvasItemPage,
  TCanvasItemsChangedEvent,
  TCanvasSnapshot,
} from '@omnidraw/canvas-contract';
import { CANVAS_SCENE_SCHEMA_VERSION } from '@omnidraw/canvas-contract';
import { Effect, Fiber, Option, Stream } from 'effect';
import { fxCanvasEvents } from '../core/canvas/fx.events';
import { fxGetCanvasSnapshot } from '../core/canvas/fx.get-snapshot';
import { fxQueryCanvasItems } from '../core/canvas/fx.query-items';
import { txExecuteCanvasCommand } from '../core/canvas/tx.execute-command';
import type { CanvasAuthority } from '../core/canvas/service.canvas-authority';

const TIMESTAMP = '1970-01-01 00:00:00';

export function canvasAuthorityConformanceFixture(canvasId = 'canvas-conformance'): TCanvasSnapshot {
  return Object.freeze({
    schemaVersion: CANVAS_SCENE_SCHEMA_VERSION,
    canvasId,
    revision: 0,
    items: Object.freeze([]),
  });
}

export type TCanvasAuthorityConformanceResult = Readonly<{
  first: TCanvasItemsChangedEvent;
  duplicate: TCanvasItemsChangedEvent;
  commandMatrix: readonly TCanvasItemsChangedEvent[];
  streamed: TCanvasItemsChangedEvent;
  replayed: TCanvasItemsChangedEvent;
  resync: Extract<TCanvasEvent, { type: 'resync-required' }>;
  snapshot: TCanvasSnapshot;
  page: TCanvasItemPage;
}>;

export function runCanvasAuthorityConformance(
  args: Readonly<{ canvasId: string }>,
): Effect.Effect<TCanvasAuthorityConformanceResult, unknown, CanvasAuthority> {
  return Effect.gen(function*() {
    const before = yield* fxGetCanvasSnapshot({ canvasId: args.canvasId });
    if (before.revision !== 0 || before.items.length !== 0) {
      return yield* Effect.die('Canvas conformance requires an empty revision-zero fixture.');
    }

    const stream = yield* fxCanvasEvents({ canvasId: args.canvasId, afterRevision: 0 });
    const eventFiber = yield* Stream.runHead(stream).pipe(
      Effect.forkChild({ startImmediately: true }),
    );
    yield* Effect.yieldNow;

    const command: TCanvasCommand = {
      commandId: 'command-conformance-insert',
      canvasId: args.canvasId,
      baseRevision: 0,
      preconditions: [{ type: 'item-absent', itemId: 'rect-1' }],
      operations: [{
        type: 'insert',
        item: {
          id: 'rect-1',
          kind: 'rect',
          parentId: null,
          orderKey: 'a0',
          transform: {
            position: { x: 10, y: 20 },
            rotation: 0,
            scale: { x: 1, y: 1 },
            skew: { x: 0, y: 0 },
            origin: { x: 0, y: 0 },
          },
          size: { width: 100, height: 80 },
        },
      }],
    };
    const first = yield* txExecuteCanvasCommand(command);
    const streamedOption = yield* Fiber.join(eventFiber);
    const streamed = Option.getOrThrow(streamedOption);
    const duplicate = yield* txExecuteCanvasCommand(command);
    const commandMatrix: TCanvasItemsChangedEvent[] = [];
    commandMatrix.push(yield* txExecuteCanvasCommand({
      commandId: 'command-conformance-patch',
      canvasId: args.canvasId,
      baseRevision: 1,
      preconditions: [{ type: 'item-revision', itemId: 'rect-1', itemRevision: 1 }],
      operations: [{
        type: 'patch',
        itemId: 'rect-1',
        patches: [{ type: 'set', path: ['transform', 'position', 'x'], value: 30 }],
      }],
    }));
    commandMatrix.push(yield* txExecuteCanvasCommand({
      commandId: 'command-conformance-reorder',
      canvasId: args.canvasId,
      baseRevision: 2,
      preconditions: [{ type: 'item-revision', itemId: 'rect-1', itemRevision: 2 }],
      operations: [{ type: 'reorder', itemId: 'rect-1', orderKey: 'z0' }],
    }));
    commandMatrix.push(yield* txExecuteCanvasCommand({
      commandId: 'command-conformance-insert-parent',
      canvasId: args.canvasId,
      baseRevision: 3,
      preconditions: [{ type: 'item-absent', itemId: 'group-1' }],
      operations: [{
        type: 'insert',
        item: {
          id: 'group-1',
          kind: 'group',
          parentId: null,
          orderKey: 'a0',
          transform: {
            position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 },
            skew: { x: 0, y: 0 }, origin: { x: 0, y: 0 },
          },
        },
      }],
    }));
    commandMatrix.push(yield* txExecuteCanvasCommand({
      commandId: 'command-conformance-reparent-in',
      canvasId: args.canvasId,
      baseRevision: 4,
      preconditions: [{ type: 'item-revision', itemId: 'rect-1', itemRevision: 3 }],
      operations: [{ type: 'reparent', itemId: 'rect-1', parentId: 'group-1', orderKey: 'b0' }],
    }));
    commandMatrix.push(yield* txExecuteCanvasCommand({
      commandId: 'command-conformance-reparent-out',
      canvasId: args.canvasId,
      baseRevision: 5,
      preconditions: [{ type: 'item-revision', itemId: 'rect-1', itemRevision: 4 }],
      operations: [{ type: 'reparent', itemId: 'rect-1', parentId: null, orderKey: 'z1' }],
    }));
    commandMatrix.push(yield* txExecuteCanvasCommand({
      commandId: 'command-conformance-replace',
      canvasId: args.canvasId,
      baseRevision: 6,
      preconditions: [{ type: 'item-revision', itemId: 'rect-1', itemRevision: 5 }],
      operations: [{
        type: 'replace',
        item: {
          id: 'rect-1',
          kind: 'rect',
          parentId: null,
          orderKey: 'z1',
          transform: {
            position: { x: 30, y: 20 }, rotation: 0, scale: { x: 1, y: 1 },
            skew: { x: 0, y: 0 }, origin: { x: 0, y: 0 },
          },
          size: { width: 120, height: 90 },
        },
      }],
    }));
    commandMatrix.push(yield* txExecuteCanvasCommand({
      commandId: 'command-conformance-delete-parent',
      canvasId: args.canvasId,
      baseRevision: 7,
      preconditions: [{ type: 'item-revision', itemId: 'group-1', itemRevision: 1 }],
      operations: [{ type: 'delete', itemId: 'group-1' }],
    }));
    const snapshot = yield* fxGetCanvasSnapshot({ canvasId: args.canvasId });
    const replayStream = yield* fxCanvasEvents({ canvasId: args.canvasId, afterRevision: 0 });
    const replayedOption = yield* Stream.runHead(replayStream);
    const replayed = Option.getOrThrow(replayedOption);
    const resyncStream = yield* fxCanvasEvents({
      canvasId: args.canvasId,
      afterRevision: snapshot.revision + 10,
    });
    const resyncOption = yield* Stream.runHead(resyncStream);
    const resync = Option.getOrThrow(resyncOption);
    const page = yield* fxQueryCanvasItems({
      canvasId: args.canvasId,
      filter: { type: 'all' },
      limit: 10,
    });

    if (
      first.revision !== 1
      || duplicate.revision !== 1
      || streamed.type !== 'items-changed'
      || streamed.commandId !== command.commandId
      || replayed.type !== 'items-changed'
      || replayed.commandId !== command.commandId
      || resync.type !== 'resync-required'
      || resync.revision !== snapshot.revision
      || commandMatrix.length !== 7
      || commandMatrix.some((event, index) => event.revision !== index + 2)
      || snapshot.revision !== 8
      || snapshot.items.length !== 1
      || snapshot.items[0]?.itemRevision !== 6
      || snapshot.items[0]?.item.kind !== 'rect'
      || snapshot.items[0]?.item.size.width !== 120
      || page.items.length !== 1
      || page.items[0]?.itemRevision !== 6
    ) return yield* Effect.die('Canvas authority violated conformance semantics.');

    return {
      first,
      duplicate,
      commandMatrix,
      streamed,
      replayed,
      resync,
      snapshot,
      page,
    };
  });
}

export { TIMESTAMP as CANVAS_CONFORMANCE_TIMESTAMP };
