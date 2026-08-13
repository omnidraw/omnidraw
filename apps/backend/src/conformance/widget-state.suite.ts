import { Effect, Stream } from 'effect';
import { fxWidgetStateEvents } from '../core/widget-state/fx.events';
import { fxGetWidgetState } from '../core/widget-state/fx.get';
import { txChangeWidgetState } from '../core/widget-state/tx.change';
import type { WidgetStateAuthority } from '../core/widget-state/service.widget-state';

export const WIDGET_STATE_CONFORMANCE_IDENTITY = {
  canvasId: 'canvas-1', elementId: 'widget-1', widgetInstanceId: 'instance-1',
} as const;

export function runWidgetStateConformance(): Effect.Effect<
  Readonly<{
    version: number;
    conflictVersion: number;
    replayVersion: number;
    futureResyncVersion: number;
  }>,
  unknown,
  WidgetStateAuthority
> {
  return Effect.gen(function*() {
    const before = yield* fxGetWidgetState({ identity: WIDGET_STATE_CONFORMANCE_IDENTITY });
    if (before.status !== 'found') return yield* Effect.die('Widget-state fixture is unavailable.');
    const changed = yield* txChangeWidgetState({
      identity: WIDGET_STATE_CONFORMANCE_IDENTITY,
      expectedVersion: before.snapshot.version,
      state: { count: 1 },
    });
    const conflict = yield* txChangeWidgetState({
      identity: WIDGET_STATE_CONFORMANCE_IDENTITY,
      expectedVersion: before.snapshot.version,
      state: { count: 2 },
    });
    if (changed.status !== 'changed' || conflict.status !== 'conflict') {
      return yield* Effect.die('Widget-state authority violated CAS semantics.');
    }
    const events = yield* fxWidgetStateEvents({
      identity: WIDGET_STATE_CONFORMANCE_IDENTITY,
      afterVersion: before.snapshot.version,
    });
    const replay = yield* Stream.runHead(events);
    if (replay._tag !== 'Some') return yield* Effect.die('Widget-state replay is missing.');
    const futureEvents = yield* fxWidgetStateEvents({
      identity: WIDGET_STATE_CONFORMANCE_IDENTITY,
      afterVersion: changed.snapshot.version + 100,
    });
    const future = yield* Stream.runHead(futureEvents);
    if (
      future._tag !== 'Some'
      || future.value.type !== 'snapshot'
      || future.value.reason !== 'resync'
    ) return yield* Effect.die('Widget-state future cursor did not request resync.');
    return {
      version: changed.snapshot.version,
      conflictVersion: conflict.snapshot.version,
      replayVersion: replay.value.snapshot.version,
      futureResyncVersion: future.value.snapshot.version,
    };
  });
}
