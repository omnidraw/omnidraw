import { Context, Effect, Layer } from 'effect';
import { fnCanonicalJson } from '../core/fn.canonical-json';
import {
  SimulationFaults,
  SimulationHostGate,
  SimulationIdentifiers,
  SimulationNetwork,
  SimulationOutcomes,
  SimulationProcesses,
  SimulationStorage,
  SimulationTime,
  type ISimulationFaults,
  type ISimulationHostGate,
  type ISimulationIdentifiers,
  type ISimulationNetwork,
  type ISimulationOutcomes,
  type ISimulationProcesses,
  type ISimulationStorage,
  type ISimulationTime,
  type TSimulationCapabilities,
  type TSimulationNetworkEnvelope,
  type TSimulationProcessState,
  type TSimulationStorageEntry,
  type TSimulationTransactionResult,
} from './service.simulation-capabilities';
import { SimulationError, SimulationWorld } from './service.simulation-world';
import type {
  TSimulationConfig,
  TSimulationNetworkDisposition,
  TSimulationOutcome,
} from './types';

type TMutableStorageEntry = {
  value: unknown;
  version: number;
};

type TMutableProcessState = {
  generation: number;
  running: boolean;
  cancelledOperations: Set<string>;
};

function canonicalClone<T>(value: T): T {
  return JSON.parse(fnCanonicalJson(value)) as T;
}

function requireName(value: string, label: string): Effect.Effect<void, SimulationError> {
  return value.length > 0
    ? Effect.void
    : Effect.fail(new SimulationError('INVALID_CONFIG', `${label} must be non-empty.`));
}

function sortedVersions(entries: ReadonlyMap<string, TMutableStorageEntry>, keys: readonly string[]): Readonly<Record<string, number>> {
  return Object.freeze(Object.fromEntries(
    [...new Set(keys)].sort().map((key) => [key, entries.get(key)?.version ?? 0]),
  ));
}

function publicProcessState(nodeId: string, state: TMutableProcessState): TSimulationProcessState {
  return Object.freeze({
    nodeId,
    generation: state.generation,
    running: state.running,
    cancelledOperations: Object.freeze([...state.cancelledOperations].sort()),
  });
}

export function layerSimulationCapabilities(
  config: TSimulationConfig,
): Layer.Layer<TSimulationCapabilities, never, SimulationWorld> {
  return Layer.effectContext(Effect.gen(function*() {
    const world = yield* SimulationWorld;
    const idCounters = new Map<string, number>();
    const storageEntries = new Map<string, TMutableStorageEntry>();
    const transactionReceipts = new Map<string, TSimulationTransactionResult>();
    const connectedNodes = new Set<string>();
    const pendingNetwork: TSimulationNetworkEnvelope[] = [];
    const deliveryOffsets = new Map<string, number>();
    const processes = new Map<string, TMutableProcessState>();
    const outcomeOffsets = new Map<string, number>();
    const registeredHostOperations = new Map<string, string>();
    const hostEscapes: Array<Readonly<{ operationId: string; capability: string }>> = [];

    const time: ISimulationTime = SimulationTime.of({
      nowMillis: world.currentTimeMillis,
      advance: world.advanceTime,
    });

    const nextId: ISimulationIdentifiers['nextId'] = ({ namespace, label }) => Effect.gen(function*() {
      yield* requireName(namespace, 'ID namespace');
      yield* requireName(label, 'ID label');
      const counter = (idCounters.get(namespace) ?? 0) + 1;
      const draw = yield* world.choose({
        stream: `entropy:${namespace}`,
        label,
        optionCount: 0x1_0000_0000,
      });
      idCounters.set(namespace, counter);
      const value = `${namespace}-${counter.toString(36).padStart(4, '0')}-${draw.toString(36).padStart(7, '0')}`;
      yield* world.trace({ type: 'id', namespace, label, value });
      return value;
    });

    const identifiers: ISimulationIdentifiers = SimulationIdentifiers.of({
      nextInt: ({ stream, label, upperExclusive }) => world.choose({ stream, label, optionCount: upperExclusive }),
      nextId,
    });

    const storage: ISimulationStorage = SimulationStorage.of({
      get: ({ key }) => Effect.gen(function*() {
        yield* requireName(key, 'Storage key');
        const entry = storageEntries.get(key);
        return entry === undefined
          ? null
          : Object.freeze({ key, value: canonicalClone(entry.value), version: entry.version });
      }),
      transact: ({ transactionId, expectedVersions = {}, mutations }) => Effect.gen(function*() {
        yield* requireName(transactionId, 'Transaction id');
        const duplicate = transactionReceipts.get(transactionId);
        if (duplicate !== undefined) {
          const result = Object.freeze({ ...canonicalClone(duplicate), status: 'duplicate' as const });
          yield* world.trace({
            type: 'transaction',
            transactionId,
            outcome: 'duplicate',
            versions: result.versions,
          });
          return result;
        }
        if (mutations.length === 0 || new Set(mutations.map((mutation) => mutation.key)).size !== mutations.length) {
          return yield* Effect.fail(new SimulationError(
            'INVALID_CONFIG',
            'A simulated transaction requires unique, non-empty mutations.',
            { transactionId },
          ));
        }
        for (const mutation of mutations) yield* requireName(mutation.key, 'Storage key');
        const preparedMutations = yield* Effect.try({
          try: () => mutations.map((mutation) => mutation.type === 'delete'
            ? mutation
            : Object.freeze({ ...mutation, value: canonicalClone(mutation.value) })),
          catch: (error) => new SimulationError(
            'INVALID_CONFIG',
            'A simulated transaction value is not canonical JSON.',
            { transactionId, error },
          ),
        });
        for (const [key, expected] of Object.entries(expectedVersions).sort(([left], [right]) => left.localeCompare(right))) {
          const actual = storageEntries.get(key)?.version ?? null;
          if (actual !== expected) {
            const versions = sortedVersions(storageEntries, Object.keys(expectedVersions));
            yield* world.trace({ type: 'transaction', transactionId, outcome: 'conflict', versions });
            return Object.freeze({ status: 'conflict' as const, versions });
          }
        }
        let beforeCommit = yield* world.fault({ point: 'storage.transaction.before-commit' });
        if (beforeCommit === 'fail-before') {
          yield* world.trace({
            type: 'transaction',
            transactionId,
            outcome: 'failed-before',
            versions: Object.freeze({}),
          });
          return yield* Effect.fail(new SimulationError(
            'INJECTED_FAULT',
            'Injected storage failure before transaction commit.',
            { transactionId },
          ));
        }
        if (beforeCommit !== 'commit-then-lost-ack') {
          beforeCommit = yield* world.fault({ point: `storage.transaction.${transactionId}.before-commit` });
          if (beforeCommit === 'fail-before') {
            yield* world.trace({
              type: 'transaction',
              transactionId,
              outcome: 'failed-before',
              versions: Object.freeze({}),
            });
            return yield* Effect.fail(new SimulationError(
              'INJECTED_FAULT',
              'Injected storage failure before transaction commit.',
              { transactionId },
            ));
          }
        }
        for (const mutation of preparedMutations) {
          const version = (storageEntries.get(mutation.key)?.version ?? 0) + 1;
          if (mutation.type === 'delete') storageEntries.delete(mutation.key);
          else storageEntries.set(mutation.key, { value: mutation.value, version });
        }
        const versions = sortedVersions(storageEntries, preparedMutations.map((mutation) => mutation.key));
        const committed: TSimulationTransactionResult = Object.freeze({ status: 'committed', versions });
        transactionReceipts.set(transactionId, committed);
        yield* world.trace({ type: 'transaction', transactionId, outcome: 'committed', versions });
        const afterCommit = beforeCommit === 'commit-then-lost-ack'
          ? beforeCommit
          : yield* world.fault({ point: 'storage.transaction.after-commit' });
        if (afterCommit !== 'pass') {
          yield* world.trace({ type: 'transaction', transactionId, outcome: 'lost-ack', versions });
          return yield* Effect.fail(new SimulationError(
            'AMBIGUOUS_ACK',
            'Storage transaction committed but its acknowledgement was lost.',
            { transactionId, versions },
          ));
        }
        return committed;
      }),
      snapshot: Effect.sync(() => Object.freeze(
        [...storageEntries.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]): TSimulationStorageEntry => Object.freeze({
            key,
            value: canonicalClone(entry.value),
            version: entry.version,
          })),
      )),
    });

    function nextDisposition(channel: string): TSimulationNetworkDisposition {
      const scripted = config.scriptedDeliveries?.[channel] ?? [{ type: 'deliver' as const }];
      const offset = deliveryOffsets.get(channel) ?? 0;
      deliveryOffsets.set(channel, offset + 1);
      return canonicalClone(scripted[Math.min(offset, scripted.length - 1)] ?? { type: 'deliver' });
    }

    const network: ISimulationNetwork = SimulationNetwork.of({
      connect: ({ nodeId }) => Effect.gen(function*() {
        yield* requireName(nodeId, 'Network node id');
        connectedNodes.add(nodeId);
        yield* world.trace({
          type: 'network', action: 'connect', messageId: null, from: nodeId, to: nodeId,
          channel: null, copy: null, readyAtMillis: null,
        });
      }),
      disconnect: ({ nodeId }) => Effect.gen(function*() {
        yield* requireName(nodeId, 'Network node id');
        connectedNodes.delete(nodeId);
        yield* world.trace({
          type: 'network', action: 'disconnect', messageId: null, from: nodeId, to: nodeId,
          channel: null, copy: null, readyAtMillis: null,
        });
      }),
      send: ({ from, to, channel, payload }) => Effect.gen(function*() {
        yield* requireName(from, 'Network source');
        yield* requireName(to, 'Network destination');
        yield* requireName(channel, 'Network channel');
        const messageId = yield* nextId({ namespace: 'message', label: `${channel}:${from}->${to}` });
        let disposition = nextDisposition(channel);
        if (!connectedNodes.has(from) || !connectedNodes.has(to)) disposition = { type: 'drop' };
        const nowMillis = yield* world.currentTimeMillis;
        if (disposition.type === 'delay' && (!Number.isSafeInteger(disposition.millis) || disposition.millis < 0)) {
          return yield* Effect.fail(new SimulationError(
            'INVALID_CONFIG',
            'Network delay must be a non-negative safe integer.',
            { channel, disposition },
          ));
        }
        if (
          disposition.type === 'duplicate'
          && (disposition.copies !== undefined
            && (!Number.isSafeInteger(disposition.copies) || disposition.copies < 2 || disposition.copies > 16))
        ) {
          return yield* Effect.fail(new SimulationError(
            'INVALID_CONFIG',
            'Network duplicate copies must be an integer from 2 through 16.',
            { channel, disposition },
          ));
        }
        if (disposition.type === 'drop') {
          yield* world.trace({
            type: 'network', action: 'drop', messageId, from, to, channel, copy: null, readyAtMillis: null,
          });
          return Object.freeze({ messageId, disposition });
        }
        const copies = disposition.type === 'duplicate' ? (disposition.copies ?? 2) : 1;
        const readyAtMillis = nowMillis + (disposition.type === 'delay' ? disposition.millis : 0);
        for (let copy = 0; copy < copies; copy += 1) {
          pendingNetwork.push(Object.freeze({
            messageId,
            from,
            to,
            channel,
            payload: canonicalClone(payload),
            copy,
            readyAtMillis,
          }));
          yield* world.trace({
            type: 'network', action: 'enqueue', messageId, from, to, channel, copy, readyAtMillis,
          });
        }
        return Object.freeze({ messageId, disposition });
      }),
      deliverNext: Effect.gen(function*() {
        const nowMillis = yield* world.currentTimeMillis;
        const ready = pendingNetwork.filter((envelope) => (
          envelope.readyAtMillis <= nowMillis
          && connectedNodes.has(envelope.from)
          && connectedNodes.has(envelope.to)
        ));
        if (ready.length === 0) return null;
        const selectedIndex = yield* world.choose({
          stream: 'network:delivery',
          label: 'next-ready-envelope',
          optionCount: ready.length,
        });
        const selected = ready[selectedIndex]!;
        const queueIndex = pendingNetwork.indexOf(selected);
        pendingNetwork.splice(queueIndex, 1);
        yield* world.trace({
          type: 'network', action: 'deliver', messageId: selected.messageId,
          from: selected.from, to: selected.to, channel: selected.channel,
          copy: selected.copy, readyAtMillis: selected.readyAtMillis,
        });
        return canonicalClone(selected);
      }),
      pending: Effect.sync(() => Object.freeze(
        [...pendingNetwork]
          .sort((left, right) => (
            left.readyAtMillis - right.readyAtMillis
            || left.messageId.localeCompare(right.messageId)
            || left.copy - right.copy
          ))
          .map(canonicalClone),
      )),
    });

    function requireProcess(nodeId: string): Effect.Effect<TMutableProcessState, SimulationError> {
      const state = processes.get(nodeId);
      return state === undefined
        ? Effect.fail(new SimulationError('INVALID_CONFIG', `Logical process '${nodeId}' is not started.`))
        : Effect.succeed(state);
    }

    const processService: ISimulationProcesses = SimulationProcesses.of({
      start: ({ nodeId }) => Effect.gen(function*() {
        yield* requireName(nodeId, 'Process node id');
        const state = processes.get(nodeId) ?? {
          generation: 1,
          running: true,
          cancelledOperations: new Set<string>(),
        };
        state.running = true;
        processes.set(nodeId, state);
        yield* world.trace({ type: 'process', action: 'start', nodeId, operationId: null });
        return publicProcessState(nodeId, state);
      }),
      crash: ({ nodeId }) => Effect.gen(function*() {
        const state = yield* requireProcess(nodeId);
        state.running = false;
        yield* world.trace({ type: 'process', action: 'crash', nodeId, operationId: null });
        return publicProcessState(nodeId, state);
      }),
      restart: ({ nodeId }) => Effect.gen(function*() {
        const state = yield* requireProcess(nodeId);
        state.running = true;
        state.generation += 1;
        yield* world.trace({ type: 'process', action: 'restart', nodeId, operationId: null });
        return publicProcessState(nodeId, state);
      }),
      cancel: ({ nodeId, operationId }) => Effect.gen(function*() {
        yield* requireName(operationId, 'Operation id');
        const state = yield* requireProcess(nodeId);
        state.cancelledOperations.add(operationId);
        yield* world.trace({ type: 'process', action: 'cancel', nodeId, operationId });
      }),
      isCancelled: ({ nodeId, operationId }) => Effect.gen(function*() {
        const state = yield* requireProcess(nodeId);
        return state.cancelledOperations.has(operationId);
      }),
      state: ({ nodeId }) => Effect.gen(function*() {
        const state = yield* requireProcess(nodeId);
        return publicProcessState(nodeId, state);
      }),
    });

    const outcomes: ISimulationOutcomes = SimulationOutcomes.of({
      take: ({ kind, operationId }) => Effect.gen(function*() {
        yield* requireName(operationId, 'Outcome operation id');
        const key = `${kind}:${operationId}`;
        const scripted = config.scriptedOutcomes?.[key];
        if (scripted === undefined || scripted.length === 0) {
          return yield* Effect.fail(new SimulationError(
            'INVALID_CONFIG',
            `No explicit simulated ${kind} outcome is configured for '${operationId}'.`,
          ));
        }
        const offset = outcomeOffsets.get(key) ?? 0;
        outcomeOffsets.set(key, offset + 1);
        const outcome: TSimulationOutcome = canonicalClone(
          scripted[Math.min(offset, scripted.length - 1)]!,
        );
        yield* world.trace({ type: 'outcome', kind, operationId, status: outcome.status });
        return outcome;
      }),
    });

    const faults: ISimulationFaults = SimulationFaults.of({ decide: world.fault });

    const hostGate: ISimulationHostGate = SimulationHostGate.of({
      register: ({ operationId, capability }) => Effect.gen(function*() {
        yield* requireName(operationId, 'Host operation id');
        yield* requireName(capability, 'Host capability');
        const registered = registeredHostOperations.get(operationId);
        if (registered !== undefined && registered !== capability) {
          return yield* Effect.fail(new SimulationError(
            'HOST_WORLD_ESCAPE',
            `Host operation '${operationId}' changed capability identity.`,
          ));
        }
        registeredHostOperations.set(operationId, capability);
        yield* world.trace({ type: 'host-gate', action: 'register', operationId, capability });
      }),
      complete: <A>({ operationId, value }: Readonly<{ operationId: string; value: A }>) => Effect.gen(function*() {
        const capability = registeredHostOperations.get(operationId);
        if (capability === undefined) {
          hostEscapes.push({ operationId, capability: 'unregistered-completion' });
          yield* world.trace({
            type: 'host-gate', action: 'escape', operationId, capability: 'unregistered-completion',
          });
          return yield* Effect.fail(new SimulationError(
            'HOST_WORLD_ESCAPE',
            `Unregistered host completion '${operationId}' attempted to enter simulation.`,
          ));
        }
        registeredHostOperations.delete(operationId);
        yield* world.trace({ type: 'host-gate', action: 'complete', operationId, capability });
        return canonicalClone(value);
      }),
      rejectEscape: ({ operationId, capability }) => Effect.gen(function*() {
        hostEscapes.push({ operationId, capability });
        yield* world.trace({ type: 'host-gate', action: 'escape', operationId, capability });
        return yield* Effect.fail(new SimulationError(
          'HOST_WORLD_ESCAPE',
          `Ambient host capability '${capability}' escaped into simulation.`,
          { operationId, capability },
        ));
      }),
      assertNoEscapes: Effect.suspend(() => hostEscapes.length === 0
        ? Effect.void
        : Effect.fail(new SimulationError(
          'HOST_WORLD_ESCAPE',
          'Simulation observed an uncontrolled host-world escape.',
          { escapes: canonicalClone(hostEscapes) },
        ))),
    });

    return Context.make(SimulationTime, time).pipe(
      Context.add(SimulationIdentifiers, identifiers),
      Context.add(SimulationStorage, storage),
      Context.add(SimulationNetwork, network),
      Context.add(SimulationProcesses, processService),
      Context.add(SimulationOutcomes, outcomes),
      Context.add(SimulationFaults, faults),
      Context.add(SimulationHostGate, hostGate),
    );
  }));
}
