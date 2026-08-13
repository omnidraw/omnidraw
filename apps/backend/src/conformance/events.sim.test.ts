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
      replayed: [
        { sequence: 1, kind: 'widget-catalog' },
        { sequence: 2, kind: 'widgetupdate' },
      ],
      afterCursor: [{ sequence: 2, kind: 'widgetupdate' }],
      terminalCode: 'EVENT_CURSOR_INVALID',
    });
  });
});
