import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { layerAgentAuthoritySim } from '../sim/layer.domain-authorities.sim';
import { runAgentConformance } from './agent.suite';

describe('agent simulation conformance', () => {
  test('runs the shared core program against deterministic simulation', async () => {
    const result = await Effect.runPromise(runAgentConformance().pipe(Effect.provide(
      layerAgentAuthoritySim({
        connection: {
          vcJson: null,
          messageHistory: [{ entryId: 'entry-1', message: { role: 'assistant', text: 'ready' } }],
        },
        events: [{ sequence: 1, event: { kind: 'widget-catalog', type: 'changed' } }],
      }),
    )));
    expect(result).toEqual({
      historyCount: 1,
      eventSequence: 1,
      eventKind: 'widget-catalog',
      terminalCode: 'EVENT_CURSOR_INVALID',
    });
  });
});
