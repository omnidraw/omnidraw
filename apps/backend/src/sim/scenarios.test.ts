import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { createSimulationRuntime } from './runtime';
import { SimulationWorld } from './service.simulation-world';
import {
  txSimulateCancellableCommit,
  txSimulateWidgetPublicationLoadRace,
} from './scenarios';

describe('required deterministic distributed scenarios', () => {
  test('publication/load races retain and load only the accepted generation', async () => {
    const runtime = createSimulationRuntime({
      applicationVersion: 'test',
      scenario: 'widget-publication-load-race',
      rootSeed: 31,
      logicalNodes: ['publisher', 'runtime-loader'],
    });
    const result = await runtime.runPromise(Effect.gen(function*() {
      const state = yield* txSimulateWidgetPublicationLoadRace({
        before: { acceptedGeneration: 1, loadedGeneration: 1, lastGoodGeneration: 1 },
        publishingGeneration: 2,
      });
      const world = yield* SimulationWorld;
      return { state, record: yield* world.finish({ finalState: state }) };
    }));
    await runtime.dispose();
    expect(result.state).toEqual({
      acceptedGeneration: 2,
      loadedGeneration: 2,
      lastGoodGeneration: 2,
    });
    expect(result.record.logicalNodes).toEqual(['publisher', 'runtime-loader']);
  });

  test('cancellation around commit plus a lost acknowledgement remains exactly once', async () => {
    const config = {
      applicationVersion: 'test',
      scenario: 'function-resource-cancel-lost-ack',
      rootSeed: 99,
      logicalNodes: ['caller', 'authority'],
      scriptedFaults: {
        'operation.before-commit': ['commit-then-lost-ack'] as const,
      },
    };
    const first = createSimulationRuntime(config);
    const { state, record } = await first.runPromise(Effect.gen(function*() {
      const initial = {
        operationId: 'operation-stable-1',
        commitCount: 0,
        acknowledged: false,
        cancelled: false,
      } as const;
      const lostAck = yield* txSimulateCancellableCommit({ state: initial, cancelRequested: true });
      const retried = yield* txSimulateCancellableCommit({ state: lostAck, cancelRequested: true });
      const world = yield* SimulationWorld;
      return { state: retried, record: yield* world.finish({ finalState: retried }) };
    }));
    await first.dispose();
    expect(state.commitCount).toBe(1);
    expect(state.cancelled).toBe(true);

    const replay = createSimulationRuntime({ ...config, replay: record });
    const replayRecord = await replay.runPromise(Effect.gen(function*() {
      const initial = {
        operationId: 'operation-stable-1',
        commitCount: 0,
        acknowledged: false,
        cancelled: false,
      } as const;
      const lostAck = yield* txSimulateCancellableCommit({ state: initial, cancelRequested: true });
      const retried = yield* txSimulateCancellableCommit({ state: lostAck, cancelRequested: true });
      const world = yield* SimulationWorld;
      return yield* world.finish({ finalState: retried });
    }));
    await replay.dispose();
    expect(replayRecord).toEqual(record);
  });
});
