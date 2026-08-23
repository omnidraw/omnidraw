import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { runAgentConformance } from './agent.suite';
import { createLiveMechanicsConformanceRuntime } from './tests/live-mechanics.fixture';
import { LiveCanvas, LiveDatabase } from '../shell/runtime/service.live-mechanics';

describe('agent live conformance', () => {
  test('runs the shared core program against the scoped production AgentService graph', async () => {
    const fixture = await createLiveMechanicsConformanceRuntime('agent-live');
    try {
      const result = await fixture.runtime.runPromise(Effect.gen(function*() {
        const database = yield* LiveDatabase;
        const canvas = yield* LiveCanvas;
        yield* Effect.promise(() => database.canvas.create({ id: 'canvas-1', name: 'Conformance canvas' }));
        yield* Effect.promise(() => canvas.execute({
          commandId: 'place-chat',
          canvasId: 'canvas-1',
          baseRevision: 0,
          operations: [{
            type: 'insert',
            item: {
              id: 'chat-1',
              parentId: null,
              orderKey: 'a',
              kind: 'widget-frame',
              transform: {
                position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 },
                skew: { x: 0, y: 0 }, origin: { x: 0, y: 0 },
              },
              size: { width: 320, height: 480 },
              extensions: { 'omnidraw:widget': {
                schemaVersion: 1, type: 'ui-widget', kind: 'ai-chat',
                payload: {
                  sessionId: '00000000-0000-4000-8000-000000000001',
                  approvalPolicy: { mode: 'manual' },
                },
              } },
            },
          }],
          preconditions: [{ type: 'item-absent', itemId: 'chat-1' }],
        }));
        return yield* runAgentConformance();
      }));
      expect(result).toEqual({ historyCount: 0 });
    } finally {
      await fixture.dispose();
    }
  });
});
