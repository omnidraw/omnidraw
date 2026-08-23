import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { fnCanonicalJson } from '../core/fn.canonical-json';
import { createSimulationRuntime } from './runtime';
import {
  SimulationFaults,
  SimulationHostGate,
  SimulationIdentifiers,
  SimulationNetwork,
  SimulationOutcomes,
  SimulationProcesses,
  SimulationStorage,
  SimulationTime,
} from './service.simulation-capabilities';
import { SimulationWorld } from './service.simulation-world';
import type { TSimulationConfig } from './types';

function controlledScenario() {
  return Effect.gen(function*() {
    const time = yield* SimulationTime;
    const identifiers = yield* SimulationIdentifiers;
    const storage = yield* SimulationStorage;
    const network = yield* SimulationNetwork;
    const processes = yield* SimulationProcesses;
    const outcomes = yield* SimulationOutcomes;
    const faults = yield* SimulationFaults;
    const hostGate = yield* SimulationHostGate;
    const world = yield* SimulationWorld;

    const startedAt = yield* time.nowMillis;
    const generatedId = yield* identifiers.nextId({ namespace: 'operation', label: 'primary-operation' });
    const entropy = yield* identifiers.nextInt({
      stream: 'scenario:business-choice',
      label: 'bounded-choice',
      upperExclusive: 7,
    });

    const firstTransaction = yield* storage.transact({
      transactionId: 'transaction-stable-1',
      expectedVersions: { account: null },
      mutations: [{ type: 'put', key: 'account', value: { balance: 7, owner: 'Ada' } }],
    }).pipe(Effect.match({
      onFailure: (error) => error.reason,
      onSuccess: (result) => result.status,
    }));
    const retriedTransaction = yield* storage.transact({
      transactionId: 'transaction-stable-1',
      expectedVersions: { account: null },
      mutations: [{ type: 'put', key: 'account', value: { balance: 7, owner: 'Ada' } }],
    });
    const storageSnapshot = yield* storage.snapshot;

    yield* network.connect({ nodeId: 'caller' });
    yield* network.connect({ nodeId: 'authority' });
    const duplicated = yield* network.send({
      from: 'caller',
      to: 'authority',
      channel: 'duplicated',
      payload: { operationId: generatedId },
    });
    const duplicateFirst = yield* network.deliverNext;
    const duplicateSecond = yield* network.deliverNext;
    const delayed = yield* network.send({
      from: 'authority',
      to: 'caller',
      channel: 'delayed',
      payload: { acknowledged: true },
    });
    const beforeDelay = yield* network.deliverNext;
    yield* time.advance({ millis: 50 });
    const afterDelay = yield* network.deliverNext;
    const dropped = yield* network.send({
      from: 'caller',
      to: 'authority',
      channel: 'dropped',
      payload: { ignored: true },
    });
    yield* network.disconnect({ nodeId: 'authority' });
    const disconnected = yield* network.send({
      from: 'caller',
      to: 'authority',
      channel: 'connected-only',
      payload: { unavailable: true },
    });
    yield* network.connect({ nodeId: 'authority' });

    yield* processes.start({ nodeId: 'worker' });
    yield* processes.cancel({ nodeId: 'worker', operationId: generatedId });
    const cancelled = yield* processes.isCancelled({ nodeId: 'worker', operationId: generatedId });
    yield* processes.crash({ nodeId: 'worker' });
    const restarted = yield* processes.restart({ nodeId: 'worker' });

    const functionOutcome = yield* outcomes.take({ kind: 'function', operationId: 'function-1' });
    const resourceOutcome = yield* outcomes.take({ kind: 'resource', operationId: 'resource-1' });
    const explicitFault = yield* faults.decide({ point: 'scenario.explicit-fault' });

    yield* hostGate.register({ operationId: 'host-1', capability: 'scripted-provider' });
    const gatedCompletion = yield* hostGate.complete({
      operationId: 'host-1',
      value: { providerSequence: 3 },
    });
    yield* hostGate.assertNoEscapes;

    const evidence = {
      startedAt,
      finishedAt: yield* time.nowMillis,
      generatedId,
      entropy,
      firstTransaction,
      retriedTransaction,
      storageSnapshot,
      duplicated,
      duplicateFirst,
      duplicateSecond,
      delayed,
      beforeDelay,
      afterDelay,
      dropped,
      disconnected,
      cancelled,
      restarted,
      functionOutcome,
      resourceOutcome,
      explicitFault,
      gatedCompletion,
    } as const;
    const record = yield* world.finish({ finalState: evidence });
    return { evidence, record } as const;
  });
}

describe('controlled simulation capability layers', () => {
  test('control and canonically replay time, entropy, transactions, network, processes, and outcomes', async () => {
    const config: TSimulationConfig = {
      applicationVersion: 'backend-test-revision',
      scenario: 'all-controlled-capabilities',
      rootSeed: 0x5eed,
      logicalNodes: ['caller', 'authority', 'worker'],
      initialConfiguration: { z: 1, a: 2 },
      scriptedFaults: {
        'storage.transaction.before-commit': ['commit-then-lost-ack'],
        'scenario.explicit-fault': ['fail-before'],
      },
      scriptedDeliveries: {
        duplicated: [{ type: 'duplicate' }],
        delayed: [{ type: 'delay', millis: 50 }],
        dropped: [{ type: 'drop' }],
      },
      scriptedOutcomes: {
        'function:function-1': [{ status: 'success', value: { result: 42 } }],
        'resource:resource-1': [{ status: 'failure', error: 'resource unavailable' }],
      },
    };

    const first = createSimulationRuntime(config);
    const recorded = await first.runPromise(controlledScenario());
    await first.dispose();

    expect(recorded.evidence.firstTransaction).toBe('AMBIGUOUS_ACK');
    expect(recorded.evidence.retriedTransaction.status).toBe('duplicate');
    expect(recorded.evidence.storageSnapshot).toHaveLength(1);
    expect(recorded.evidence.duplicateFirst?.messageId).toBe(recorded.evidence.duplicateSecond?.messageId);
    expect(recorded.evidence.duplicateFirst?.copy).not.toBe(recorded.evidence.duplicateSecond?.copy);
    expect(recorded.evidence.beforeDelay).toBeNull();
    expect(recorded.evidence.afterDelay?.messageId).toBe(recorded.evidence.delayed.messageId);
    expect(recorded.evidence.dropped.disposition.type).toBe('drop');
    expect(recorded.evidence.disconnected.disposition.type).toBe('drop');
    expect(recorded.evidence.cancelled).toBe(true);
    expect(recorded.evidence.restarted.generation).toBe(2);
    expect(recorded.record.schedule.length).toBeGreaterThan(0);
    expect(new Set(recorded.record.steps.map((step) => step.type))).toEqual(new Set([
      'choice', 'id', 'fault', 'transaction', 'network', 'time', 'process', 'outcome', 'host-gate',
    ]));

    const replay = createSimulationRuntime({ ...config, replay: recorded.record });
    const replayed = await replay.runPromise(controlledScenario());
    await replay.dispose();
    expect(replayed.record).toEqual(recorded.record);
    expect(fnCanonicalJson(replayed.record)).toBe(fnCanonicalJson(recorded.record));
  });

  test('rejects completion that bypasses the deterministic host gate', async () => {
    const runtime = createSimulationRuntime({
      applicationVersion: 'backend-test-revision',
      scenario: 'host-world-no-escape',
      rootSeed: 19,
    });
    const result = await runtime.runPromise(Effect.gen(function*() {
      const hostGate = yield* SimulationHostGate;
      const completion = yield* hostGate.complete({ operationId: 'unregistered', value: 1 }).pipe(
        Effect.match({ onFailure: (error) => error.reason, onSuccess: () => 'unexpected-success' as const }),
      );
      const audit = yield* hostGate.assertNoEscapes.pipe(
        Effect.match({ onFailure: (error) => error.reason, onSuccess: () => 'clean' as const }),
      );
      const world = yield* SimulationWorld;
      const record = yield* world.finish({ finalState: { completion, audit } });
      return { completion, audit, record };
    }));
    await runtime.dispose();

    expect(result.completion).toBe('HOST_WORLD_ESCAPE');
    expect(result.audit).toBe('HOST_WORLD_ESCAPE');
    expect(result.record.steps).toContainEqual(expect.objectContaining({
      type: 'host-gate',
      action: 'escape',
    }));
  });
});
