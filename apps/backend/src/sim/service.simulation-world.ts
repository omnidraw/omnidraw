import { Context, type Effect } from 'effect';
import type {
  TSimulationFault,
  TSimulationRecord,
  TSimulationStepInput,
} from './types';

export interface ISimulationWorld {
  readonly choose: (args: Readonly<{
    stream: string;
    label: string;
    optionCount: number;
  }>) => Effect.Effect<number, SimulationError>;
  readonly fault: (args: Readonly<{ point: string }>) => Effect.Effect<TSimulationFault, SimulationError>;
  readonly currentTimeMillis: Effect.Effect<number>;
  readonly advanceTime: (args: Readonly<{ millis: number }>) => Effect.Effect<void, SimulationError>;
  readonly trace: (step: TSimulationStepInput) => Effect.Effect<void, SimulationError>;
  readonly observe: (args: Readonly<{ label: string; value: unknown }>) => Effect.Effect<void, SimulationError>;
  readonly finish: (args: Readonly<{
    finalState: unknown;
    invariantFailure?: Readonly<{ name: string; message: string }>;
  }>) => Effect.Effect<TSimulationRecord, SimulationError>;
  readonly record: Effect.Effect<TSimulationRecord>;
}

export class SimulationWorld extends Context.Service<SimulationWorld, ISimulationWorld>()(
  'omnidraw/backend/SimulationWorld',
) {}

export class SimulationError extends Error {
  readonly _tag = 'SimulationError';
  readonly reason:
    | 'INVALID_CONFIG'
    | 'STEP_BOUND'
    | 'REPLAY_DIVERGENCE'
    | 'INJECTED_FAULT'
    | 'AMBIGUOUS_ACK'
    | 'CANCELLED'
    | 'HOST_WORLD_ESCAPE';
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    reason: SimulationError['reason'],
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'SimulationError';
    this.reason = reason;
    this.details = details;
  }
}
