import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { fnCanonicalJson } from '../core/fn.canonical-json';
import { createSimulationRuntime } from './runtime';
import { SeededSimulationScheduler } from './scheduler';
import { SimulationWorld } from './service.simulation-world';

describe('deterministic simulation world', () => {
  test('records and replays choices, faults, time, observations, and final state', async () => {
    const config = {
      applicationVersion: 'test',
      scenario: 'record-replay',
      rootSeed: 42,
      scriptedFaults: { commit: ['commit-then-lost-ack'] as const },
    };
    const first = createSimulationRuntime(config);
    const record = await first.runPromise(Effect.gen(function*() {
      const world = yield* SimulationWorld;
      const choice = yield* world.choose({ stream: 'network', label: 'delivery', optionCount: 3 });
      const fault = yield* world.fault({ point: 'commit' });
      yield* world.advanceTime({ millis: 500 });
      yield* world.observe({ label: 'result', value: { choice, fault } });
      return yield* world.finish({ finalState: { revision: 1, choice } });
    }));
    await first.dispose();

    const replay = createSimulationRuntime({ ...config, replay: record });
    const replayed = await replay.runPromise(Effect.gen(function*() {
      const world = yield* SimulationWorld;
      const choice = yield* world.choose({ stream: 'network', label: 'delivery', optionCount: 3 });
      const fault = yield* world.fault({ point: 'commit' });
      yield* world.advanceTime({ millis: 500 });
      yield* world.observe({ label: 'result', value: { choice, fault } });
      return yield* world.finish({ finalState: { revision: 1, choice } });
    }));
    await replay.dispose();

    expect(replayed).toEqual(record);
    expect(fnCanonicalJson(replayed)).toBe(fnCanonicalJson(record));
  });

  test('rejects replay metadata, malformed recorded choices, and unconsumed evidence', async () => {
    const config = {
      applicationVersion: 'test',
      scenario: 'strict-replay-validation',
      rootSeed: 73,
      logicalNodes: ['left', 'right'],
      initialConfiguration: { mode: 'strict' },
    } as const;
    const first = createSimulationRuntime(config);
    const record = await first.runPromise(Effect.gen(function*() {
      const world = yield* SimulationWorld;
      yield* world.choose({ stream: 'delivery', label: 'peer', optionCount: 2 });
      yield* world.observe({ label: 'canonical', value: { z: 1, a: 2 } });
      return yield* world.finish({ finalState: { revision: 1 } });
    }));
    await first.dispose();

    const invalidChoice = structuredClone(record);
    const choiceIndex = invalidChoice.steps.findIndex((step) => step.type === 'choice');
    invalidChoice.steps[choiceIndex] = {
      ...invalidChoice.steps[choiceIndex]!,
      selectedIndex: 999,
    } as typeof invalidChoice.steps[number];
    const invalidRuntime = createSimulationRuntime({ ...config, replay: invalidChoice });
    await expect(invalidRuntime.runPromise(Effect.gen(function*() {
      const world = yield* SimulationWorld;
      yield* world.choose({ stream: 'delivery', label: 'peer', optionCount: 2 });
    }))).rejects.toMatchObject({ reason: 'REPLAY_DIVERGENCE' });
    await invalidRuntime.dispose();

    const unconsumedRuntime = createSimulationRuntime({ ...config, replay: record });
    await expect(unconsumedRuntime.runPromise(Effect.gen(function*() {
      const world = yield* SimulationWorld;
      yield* world.choose({ stream: 'delivery', label: 'peer', optionCount: 2 });
      return yield* world.finish({ finalState: { revision: 1 } });
    }))).rejects.toMatchObject({ reason: 'REPLAY_DIVERGENCE' });
    await unconsumedRuntime.dispose();

    const metadataRuntime = createSimulationRuntime({
      ...config,
      applicationVersion: 'different-revision',
      replay: record,
    });
    await expect(metadataRuntime.runPromise(Effect.void)).rejects.toMatchObject({
      reason: 'INVALID_CONFIG',
    });
    await metadataRuntime.dispose();
  });

  test('enforces the deterministic step bound', async () => {
    const runtime = createSimulationRuntime({
      applicationVersion: 'test',
      scenario: 'step-bound',
      rootSeed: 7,
      stepBound: 1,
    });
    await expect(runtime.runPromise(Effect.gen(function*() {
      const world = yield* SimulationWorld;
      yield* world.observe({ label: 'within-bound', value: 1 });
      yield* world.observe({ label: 'past-bound', value: 2 });
    }))).rejects.toMatchObject({ reason: 'STEP_BOUND' });
    await runtime.dispose();
  });

  test('keeps dispatcher queues isolated and chooses peers deterministically', () => {
    const scheduler = new SeededSimulationScheduler(7, { autoFlush: false });
    const left = scheduler.makeDispatcher();
    const right = scheduler.makeDispatcher();
    const order: string[] = [];
    left.scheduleTask(() => order.push('left-a'), 1);
    left.scheduleTask(() => order.push('left-b'), 1);
    right.scheduleTask(() => order.push('right'), 0);

    left.flush();
    expect(order).toHaveLength(2);
    expect(order.every((entry) => entry.startsWith('left'))).toBe(true);
    right.flush();
    expect(order.at(-1)).toBe('right');
    expect(scheduler.snapshot()).toEqual([
      expect.objectContaining({ dispatcherId: 0, priority: 1, runnableSequences: [0, 1] }),
      expect.objectContaining({ dispatcherId: 0, priority: 1 }),
      expect.objectContaining({ dispatcherId: 1, priority: 0, runnableSequences: [2] }),
    ]);
  });
});
