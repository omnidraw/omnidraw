import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { layerWidgetStateAuthoritySim } from '../sim/layer.domain-authorities.sim';
import { txChangeWidgetState } from '../core/widget-state/tx.change';
import {
  WIDGET_STATE_CONFORMANCE_IDENTITY,
  runWidgetStateConformance,
} from './widget-state.suite';

describe('widget-state simulation conformance', () => {
  test('runs shared CAS/replay semantics against deterministic simulation', async () => {
    const result = await Effect.runPromise(runWidgetStateConformance().pipe(Effect.provide(
      layerWidgetStateAuthoritySim({ initialState: null, now: () => 0 }),
    )));
    expect(result).toEqual({
      version: 1,
      conflictVersion: 1,
      replayVersion: 1,
      futureResyncVersion: 1,
    });
  });

  test('reuses deterministic core mutation-rate admission', async () => {
    let now = 0;
    const layer = layerWidgetStateAuthoritySim({
      initialState: null,
      now: () => now,
      mutationRateLimit: 1,
    });
    const result = await Effect.runPromise(Effect.gen(function*() {
      const first = yield* txChangeWidgetState({
        identity: WIDGET_STATE_CONFORMANCE_IDENTITY,
        expectedVersion: 0,
        state: { now },
      });
      const limited = yield* txChangeWidgetState({
        identity: WIDGET_STATE_CONFORMANCE_IDENTITY,
        expectedVersion: 1,
        state: { now },
      });
      now = 1_000;
      const afterWindow = yield* txChangeWidgetState({
        identity: WIDGET_STATE_CONFORMANCE_IDENTITY,
        expectedVersion: 1,
        state: { now },
      });
      return { first, limited, afterWindow };
    }).pipe(Effect.provide(layer)));

    expect(result.first.status).toBe('changed');
    expect(result.limited).toEqual({
      status: 'rate-limited',
      retryAfterMs: 1_000,
    });
    expect(result.afterWindow.status).toBe('changed');
  });
});
