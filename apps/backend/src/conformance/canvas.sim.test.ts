import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import {
  canvasAuthorityConformanceFixture,
  runCanvasAuthorityConformance,
} from './canvas.suite';
import { layerCanvasAuthoritySim } from '../sim/canvas/layer.canvas-authority.sim';
import { createSimulationRuntime } from '../sim/runtime';
import { SimulationWorld } from '../sim/service.simulation-world';

describe('Canvas authority simulation conformance', () => {
  test('runs unchanged and records a replayable trace', async () => {
    const fixture = canvasAuthorityConformanceFixture();
    const config = {
      applicationVersion: 'test',
      scenario: 'canvas-authority-conformance',
      rootSeed: 17,
    } as const;
    const runtime = createSimulationRuntime(config);
    const { result, record } = await runtime.runPromise(Effect.gen(function*() {
      const result = yield* runCanvasAuthorityConformance({ canvasId: fixture.canvasId }).pipe(
        Effect.provide(layerCanvasAuthoritySim({ initialSnapshots: [fixture] })),
      );
      const world = yield* SimulationWorld;
      const record = yield* world.finish({ finalState: result.snapshot });
      return { result, record };
    }));
    await runtime.dispose();

    expect(result.duplicate).toEqual(result.first);
    expect(result.commandMatrix.map((event) => event.revision)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(result.replayed).toEqual(result.first);
    expect(result.resync).toEqual({
      type: 'resync-required',
      canvasId: fixture.canvasId,
      revision: 8,
    });
    expect(record.steps.some((step) => step.type === 'observation')).toBe(true);
    expect(record.finalStateDigest).toStartWith('fnv1a64:');
  });
});
