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
      }),
    )));
    expect(result).toEqual({ historyCount: 1 });
  });
});
