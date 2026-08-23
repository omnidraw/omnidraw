import type {
  TCanvasEvent,
  TCanvasItemPage,
  TCanvasItemQuery,
  TCanvasItemQueryCursor,
  TCanvasItemSnapshot,
  TCanvasItemsChangedEvent,
  TCanvasSnapshot,
} from '@omnidraw/canvas-contract';
import { Effect, Layer, PubSub, Ref, Stream } from 'effect';
import { CanvasAuthorityError } from '../../core/canvas/errors';
import { fnReduceCanvasCommand } from '../../core/canvas/fn.reduce-command';
import { CanvasAuthority } from '../../core/canvas/service.canvas-authority';
import { SimulationWorld } from '../service.simulation-world';

type TSimCanvasState = Readonly<{
  snapshots: ReadonlyMap<string, TCanvasSnapshot>;
  receipts: ReadonlyMap<string, TCanvasItemsChangedEvent>;
  history: ReadonlyMap<string, readonly TCanvasItemsChangedEvent[]>;
}>;

function receiptKey(canvasId: string, commandId: string): string {
  return `${canvasId}\u0000${commandId}`;
}

function cursorFor(query: TCanvasItemQuery, item: TCanvasItemSnapshot): TCanvasItemQueryCursor {
  if (query.filter.type === 'widget-instance') {
    return { type: 'widget-identity', instanceId: query.filter.instanceId, id: item.id };
  }
  if (query.filter.type === 'parent') {
    return { type: 'parent-order', orderKey: item.item.orderKey, id: item.id };
  }
  return { type: 'id', id: item.id };
}

function afterCursor(items: readonly TCanvasItemSnapshot[], cursor: TCanvasItemQueryCursor | undefined): readonly TCanvasItemSnapshot[] {
  if (cursor === undefined) return items;
  const index = items.findIndex((item) => item.id === cursor.id);
  return index < 0 ? items : items.slice(index + 1);
}

function querySnapshot(snapshot: TCanvasSnapshot, query: TCanvasItemQuery): TCanvasItemPage {
  let items = snapshot.items.filter((item) => {
    const filter = query.filter;
    if (filter.type === 'all') return true;
    if (filter.type === 'ids') return filter.ids.includes(item.id);
    if (filter.type === 'kind') return item.item.kind === filter.kind;
    if (filter.type === 'parent') return item.item.parentId === filter.parentId;
    const widget = item.item.extensions?.['omnidraw:widget'];
    if (widget === null || typeof widget !== 'object' || Array.isArray(widget)) return false;
    if (filter.type === 'widget-instance') return widget.instanceId === filter.instanceId;
    return widget.widgetKey === filter.widgetKey;
  });
  items = [...items].sort((left, right) => left.id.localeCompare(right.id));
  const limit = query.limit ?? 100;
  const remaining = afterCursor(items, query.cursor);
  const page = remaining.slice(0, limit);
  return Object.freeze({
    items: Object.freeze(page),
    nextCursor: remaining.length > page.length && page.length > 0
      ? cursorFor(query, page.at(-1)!)
      : null,
  });
}

export function layerCanvasAuthoritySim(args: Readonly<{
  initialSnapshots: readonly TCanvasSnapshot[];
}>): Layer.Layer<CanvasAuthority, never, SimulationWorld> {
  return Layer.effect(
    CanvasAuthority,
    Effect.gen(function*() {
      const world = yield* SimulationWorld;
      const state = yield* Ref.make<TSimCanvasState>({
        snapshots: new Map(args.initialSnapshots.map((snapshot) => [snapshot.canvasId, structuredClone(snapshot)])),
        receipts: new Map(),
        history: new Map(args.initialSnapshots.map((snapshot) => [snapshot.canvasId, []])),
      });
      const events = yield* PubSub.unbounded<TCanvasEvent>();
      const mapSimulationError = (error: unknown) => new CanvasAuthorityError(
        'UNAVAILABLE',
        'Canvas simulation world rejected an operation.',
        {},
        { cause: error },
      );

      return CanvasAuthority.of({
        getSnapshot: ({ canvasId }) => Effect.gen(function*() {
          const current = yield* Ref.get(state);
          const snapshot = current.snapshots.get(canvasId);
          if (snapshot === undefined) {
            return yield* Effect.fail(new CanvasAuthorityError('NOT_FOUND', `Canvas '${canvasId}' does not exist.`));
          }
          return structuredClone(snapshot);
        }),
        queryItems: (query) => Effect.gen(function*() {
          const current = yield* Ref.get(state);
          const snapshot = current.snapshots.get(query.canvasId);
          if (snapshot === undefined) {
            return yield* Effect.fail(new CanvasAuthorityError('NOT_FOUND', `Canvas '${query.canvasId}' does not exist.`));
          }
          return querySnapshot(snapshot, query);
        }),
        execute: (command) => Effect.gen(function*() {
          const key = receiptKey(command.canvasId, command.commandId);
          const before = yield* Ref.get(state);
          const duplicate = before.receipts.get(key);
          if (duplicate !== undefined) return structuredClone(duplicate);
          const snapshot = before.snapshots.get(command.canvasId);
          if (snapshot === undefined) {
            return yield* Effect.fail(new CanvasAuthorityError('NOT_FOUND', `Canvas '${command.canvasId}' does not exist.`));
          }
          const beforeCommit = yield* world.fault({ point: 'canvas.command.before-commit' }).pipe(
            Effect.mapError(mapSimulationError),
          );
          if (beforeCommit === 'fail-before') {
            return yield* Effect.fail(new CanvasAuthorityError('UNAVAILABLE', 'Injected failure before Canvas commit.'));
          }
          const timestamp = '1970-01-01 00:00:00';
          const reduction = yield* Effect.try({
            try: () => fnReduceCanvasCommand({ snapshot, command, timestamp }),
            catch: (error) => error instanceof CanvasAuthorityError
              ? error
              : new CanvasAuthorityError('INVALID_COMMAND', 'Canvas reduction failed.', {}, { cause: error }),
          });
          const snapshots = new Map(before.snapshots);
          snapshots.set(command.canvasId, reduction.snapshot);
          const receipts = new Map(before.receipts);
          receipts.set(key, reduction.event);
          const history = new Map(before.history);
          history.set(command.canvasId, Object.freeze([
            ...(history.get(command.canvasId) ?? []),
            reduction.event,
          ]));
          yield* Ref.set(state, { snapshots, receipts, history });
          yield* PubSub.publish(events, reduction.event);
          yield* world.observe({
            label: 'canvas.command.committed',
            value: { canvasId: command.canvasId, commandId: command.commandId, revision: reduction.event.revision },
          }).pipe(Effect.mapError(mapSimulationError));
          const afterCommit = beforeCommit === 'commit-then-lost-ack'
            ? beforeCommit
            : yield* world.fault({ point: 'canvas.command.after-commit' }).pipe(
              Effect.mapError(mapSimulationError),
            );
          if (afterCommit === 'commit-then-lost-ack' || afterCommit === 'fail-before') {
            return yield* Effect.fail(new CanvasAuthorityError(
              'POST_COMMIT_FAILURE',
              'Canvas command committed but its acknowledgement was lost.',
              { commandId: command.commandId },
            ));
          }
          return reduction.event;
        }),
        events: ({ canvasId, afterRevision }) => Effect.gen(function*() {
          const current = yield* Ref.get(state);
          const snapshot = current.snapshots.get(canvasId);
          if (snapshot === undefined) {
            return yield* Effect.fail(new CanvasAuthorityError('NOT_FOUND', `Canvas '${canvasId}' does not exist.`));
          }
          if (afterRevision > snapshot.revision) {
            return Stream.succeed<TCanvasEvent>({ type: 'resync-required', canvasId, revision: snapshot.revision });
          }
          const replay = (current.history.get(canvasId) ?? []).filter((event) => event.revision > afterRevision);
          const expectedReplayCount = snapshot.revision - afterRevision;
          const replayIsContiguous = expectedReplayCount === 0 || (
            replay.length === expectedReplayCount
            && replay.every((event, index) => event.revision === afterRevision + index + 1)
          );
          if (!replayIsContiguous) {
            return Stream.succeed<TCanvasEvent>({
              type: 'resync-required',
              canvasId,
              revision: snapshot.revision,
            });
          }
          const live = Stream.fromPubSub(events).pipe(
            Stream.filter((event) => event.canvasId === canvasId && event.revision > afterRevision),
          );
          return Stream.fromIterable<TCanvasEvent>(replay).pipe(Stream.concat(live));
        }),
        beginDeletion: () => Effect.void,
        abortDeletion: () => Effect.void,
        commitDeletion: () => Effect.void,
        release: () => Effect.void,
      });
    }),
  );
}
