import { Clock, Effect, Layer } from 'effect';
import { fnCanonicalJson, fnCanonicalStateDigest } from '../core/fn.canonical-json';
import { fnCreateSeededRandom } from './fn.seeded-random';
import { SimulationError, SimulationWorld } from './service.simulation-world';
import {
  SIMULATION_EFFECT_VERSION,
  SIMULATION_RECORD_SCHEMA_VERSION,
  type TSimulationConfig,
  type TSimulationFault,
  type TSimulationRecord,
  type TSimulationScheduleChoice,
  type TSimulationStep,
  type TSimulationStepInput,
} from './types';

const DEFAULT_STEP_BOUND = 10_000;

export interface ISimulationScheduleTrace {
  readonly snapshot: () => readonly TSimulationScheduleChoice[];
  readonly assertReplayConsumed: () => void;
}

const emptyScheduleTrace: ISimulationScheduleTrace = Object.freeze({
  snapshot: () => Object.freeze([]),
  assertReplayConsumed: () => undefined,
});

function canonicalClone<T>(value: T): T {
  return JSON.parse(fnCanonicalJson(value)) as T;
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return fnCanonicalJson(left) === fnCanonicalJson(right);
}

function invalidConfig(message: string, details: Readonly<Record<string, unknown>> = {}): SimulationError {
  return new SimulationError('INVALID_CONFIG', message, details);
}

export function layerSimulationWorld(
  config: TSimulationConfig,
  scheduleTrace: ISimulationScheduleTrace = emptyScheduleTrace,
): Layer.Layer<SimulationWorld, never, Clock.Clock> {
  return Layer.effect(
    SimulationWorld,
    Effect.gen(function*() {
      const clock = yield* Clock.Clock;
      const random = fnCreateSeededRandom(config.rootSeed);
      const steps: TSimulationStep[] = [];
      const faultOffsets = new Map<string, number>();
      const replay = config.replay;
      const stepBound = config.stepBound ?? replay?.stepBound ?? DEFAULT_STEP_BOUND;
      const logicalNodes = canonicalClone(config.logicalNodes ?? replay?.logicalNodes ?? ['node-0']);
      const initialConfiguration = canonicalClone(
        config.initialConfiguration ?? replay?.initialConfiguration ?? null,
      );
      let nowMillis = clock.currentTimeMillisUnsafe();
      let finalStateDigest: string | null = null;
      let invariantFailure: TSimulationRecord['invariantFailure'] = null;

      if (!Number.isSafeInteger(config.rootSeed)) {
        return yield* Effect.die(invalidConfig('Simulation rootSeed must be a safe integer.'));
      }
      if (config.applicationVersion.length === 0 || config.scenario.length === 0) {
        return yield* Effect.die(invalidConfig('Simulation version and scenario must be non-empty.'));
      }
      if (!Number.isSafeInteger(stepBound) || stepBound < 1) {
        return yield* Effect.die(invalidConfig('Simulation stepBound must be positive.'));
      }
      if (
        logicalNodes.length === 0
        || logicalNodes.some((node) => node.length === 0)
        || new Set(logicalNodes).size !== logicalNodes.length
      ) {
        return yield* Effect.die(invalidConfig('Simulation logical nodes must be non-empty and unique.'));
      }
      if (replay !== undefined) {
        if (
          replay.schemaVersion !== SIMULATION_RECORD_SCHEMA_VERSION
          || replay.applicationVersion !== config.applicationVersion
          || replay.effectVersion !== SIMULATION_EFFECT_VERSION
          || replay.scenario !== config.scenario
          || replay.rootSeed !== config.rootSeed
          || replay.stepBound !== stepBound
          || !Array.isArray(replay.schedule)
          || !canonicalEqual(replay.logicalNodes, logicalNodes)
          || !canonicalEqual(replay.initialConfiguration, initialConfiguration)
        ) {
          return yield* Effect.die(invalidConfig('Replay metadata does not match this run.'));
        }
      }

      function append(step: TSimulationStepInput): Effect.Effect<void, SimulationError> {
        return Effect.suspend(() => {
          if (steps.length >= stepBound) {
            return Effect.fail(new SimulationError('STEP_BOUND', 'Simulation exceeded its deterministic step bound.', {
              stepBound,
            }));
          }
          const complete = Object.freeze(canonicalClone({ ...step, sequence: steps.length })) as TSimulationStep;
          const expected = replay?.steps[steps.length];
          if (expected !== undefined && !canonicalEqual(expected, complete)) {
            return Effect.fail(new SimulationError('REPLAY_DIVERGENCE', 'Replay diverged from the recorded step.', {
              sequence: steps.length,
              expected,
              actual: complete,
            }));
          }
          steps.push(complete);
          return Effect.void;
        });
      }

      function snapshot(): TSimulationRecord {
        return Object.freeze({
          schemaVersion: SIMULATION_RECORD_SCHEMA_VERSION,
          applicationVersion: config.applicationVersion,
          effectVersion: SIMULATION_EFFECT_VERSION,
          scenario: config.scenario,
          rootSeed: config.rootSeed,
          logicalNodes: Object.freeze([...logicalNodes]),
          initialConfiguration,
          stepBound,
          schedule: scheduleTrace.snapshot(),
          steps: Object.freeze([...steps]),
          finalStateDigest,
          invariantFailure,
        });
      }

      return SimulationWorld.of({
        choose: ({ stream, label, optionCount }) => Effect.gen(function*() {
          if (stream.length === 0 || label.length === 0 || !Number.isSafeInteger(optionCount) || optionCount < 1) {
            return yield* Effect.fail(invalidConfig('Simulation choice requires names and at least one option.', {
              stream,
              label,
              optionCount,
            }));
          }
          const expected = replay?.steps[steps.length];
          const selectedIndex = expected?.type === 'choice'
            ? expected.selectedIndex
            : random.nextInt(stream, optionCount);
          if (!Number.isSafeInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= optionCount) {
            return yield* Effect.fail(new SimulationError(
              'REPLAY_DIVERGENCE',
              'Replay selected an invalid choice index.',
              { stream, label, optionCount, selectedIndex },
            ));
          }
          yield* append({ type: 'choice', stream, label, optionCount, selectedIndex });
          return selectedIndex;
        }),
        fault: ({ point }) => Effect.gen(function*() {
          if (point.length === 0) return yield* Effect.fail(invalidConfig('Simulation fault point must be non-empty.'));
          const scripted = config.scriptedFaults?.[point] ?? ['pass'];
          const offset = faultOffsets.get(point) ?? 0;
          const expected = replay?.steps[steps.length];
          const outcome: TSimulationFault = expected?.type === 'fault'
            ? expected.outcome
            : scripted[Math.min(offset, scripted.length - 1)] ?? 'pass';
          faultOffsets.set(point, offset + 1);
          yield* append({ type: 'fault', point, outcome });
          return outcome;
        }),
        currentTimeMillis: Effect.sync(() => nowMillis),
        advanceTime: ({ millis }) => Effect.gen(function*() {
          if (!Number.isSafeInteger(millis) || millis < 0) {
            return yield* Effect.fail(invalidConfig('Virtual time advances must be non-negative integers.', {
              millis,
            }));
          }
          const fromMillis = nowMillis;
          nowMillis += millis;
          const adjustable = clock as Clock.Clock & { readonly setTime?: (millis: number) => Effect.Effect<void> };
          if (adjustable.setTime !== undefined) yield* adjustable.setTime(nowMillis);
          yield* append({ type: 'time', fromMillis, toMillis: nowMillis });
        }),
        trace: append,
        observe: ({ label, value }) => append({
          type: 'observation',
          label,
          value: canonicalClone(value),
        }),
        finish: ({ finalState, invariantFailure: failure }) => Effect.try({
          try: () => {
            finalStateDigest = fnCanonicalStateDigest(finalState);
            invariantFailure = failure === undefined ? null : canonicalClone(failure);
            scheduleTrace.assertReplayConsumed();
            const record = snapshot();
            if (replay !== undefined) {
              if (steps.length !== replay.steps.length) {
                throw new SimulationError('REPLAY_DIVERGENCE', 'Replay ended before all recorded steps were consumed.', {
                  consumed: steps.length,
                  recorded: replay.steps.length,
                });
              }
              if (
                record.finalStateDigest !== replay.finalStateDigest
                || !canonicalEqual(record.invariantFailure, replay.invariantFailure)
                || !canonicalEqual(record.schedule, replay.schedule)
              ) {
                throw new SimulationError('REPLAY_DIVERGENCE', 'Replay final evidence differs from the recording.', {
                  expected: replay,
                  actual: record,
                });
              }
            }
            return record;
          },
          catch: (error) => error instanceof SimulationError
            ? error
            : new SimulationError('INVALID_CONFIG', 'Could not finalize simulation record.', { error }),
        }),
        record: Effect.sync(snapshot),
      });
    }),
  );
}
