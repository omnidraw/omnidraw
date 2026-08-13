import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { layerWidgetStateAuthoritySim } from '../sim/layer.domain-authorities.sim';
import { runWidgetStateConformance } from './widget-state.suite';

describe('widget-state simulation conformance', () => {
  test('runs shared CAS/replay semantics against deterministic simulation', async () => {
    const result = await Effect.runPromise(runWidgetStateConformance().pipe(Effect.provide(
      layerWidgetStateAuthoritySim({ initialState: null }),
    )));
    expect(result).toEqual({
      version: 1,
      conflictVersion: 1,
      replayVersion: 1,
      futureResyncVersion: 1,
    });
  });
});
