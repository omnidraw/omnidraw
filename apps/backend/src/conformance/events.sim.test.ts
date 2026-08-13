import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { layerEventAuthoritySim } from '../sim/layer.domain-authorities.sim';
import { runEventsConformance } from './events.suite';

describe('events simulation conformance', () => {
  test('runs shared publication/replay/cursor semantics against deterministic simulation', async () => {
    const result = await Effect.runPromise(runEventsConformance().pipe(
      Effect.provide(layerEventAuthoritySim({})),
    ));
    expect(result).toEqual({
      firstSequence: 1,
      replayedSequence: 1,
      cursorCount: 1,
      terminalCode: 'EVENT_CURSOR_INVALID',
    });
  });
});
