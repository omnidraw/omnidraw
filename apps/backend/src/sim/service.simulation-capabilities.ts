import { Context, type Effect } from 'effect';
import type { SimulationError } from './service.simulation-world';
import type {
  TSimulationFault,
  TSimulationNetworkDisposition,
  TSimulationOutcome,
} from './types';

export interface ISimulationTime {
  readonly nowMillis: Effect.Effect<number>;
  readonly advance: (args: Readonly<{ millis: number }>) => Effect.Effect<void, SimulationError>;
}

export class SimulationTime extends Context.Service<SimulationTime, ISimulationTime>()(
  'omnidraw/backend/sim/Time',
) {}

export interface ISimulationIdentifiers {
  readonly nextInt: (args: Readonly<{
    stream: string;
    label: string;
    upperExclusive: number;
  }>) => Effect.Effect<number, SimulationError>;
  readonly nextId: (args: Readonly<{
    namespace: string;
    label: string;
  }>) => Effect.Effect<string, SimulationError>;
}

export class SimulationIdentifiers extends Context.Service<SimulationIdentifiers, ISimulationIdentifiers>()(
  'omnidraw/backend/sim/Identifiers',
) {}

export type TSimulationStorageMutation =
  | Readonly<{ type: 'put'; key: string; value: unknown }>
  | Readonly<{ type: 'delete'; key: string }>;

export type TSimulationStorageEntry = Readonly<{
  key: string;
  value: unknown;
  version: number;
}>;

export type TSimulationTransactionResult = Readonly<{
  status: 'committed' | 'duplicate' | 'conflict';
  versions: Readonly<Record<string, number>>;
}>;

export interface ISimulationStorage {
  readonly get: (args: Readonly<{ key: string }>) => Effect.Effect<TSimulationStorageEntry | null, SimulationError>;
  readonly transact: (args: Readonly<{
    transactionId: string;
    expectedVersions?: Readonly<Record<string, number | null>>;
    mutations: readonly TSimulationStorageMutation[];
  }>) => Effect.Effect<TSimulationTransactionResult, SimulationError>;
  readonly snapshot: Effect.Effect<readonly TSimulationStorageEntry[]>;
}

export class SimulationStorage extends Context.Service<SimulationStorage, ISimulationStorage>()(
  'omnidraw/backend/sim/Storage',
) {}

export type TSimulationNetworkEnvelope = Readonly<{
  messageId: string;
  from: string;
  to: string;
  channel: string;
  payload: unknown;
  copy: number;
  readyAtMillis: number;
}>;

export type TSimulationNetworkSendResult = Readonly<{
  messageId: string;
  disposition: TSimulationNetworkDisposition;
}>;

export interface ISimulationNetwork {
  readonly connect: (args: Readonly<{ nodeId: string }>) => Effect.Effect<void, SimulationError>;
  readonly disconnect: (args: Readonly<{ nodeId: string }>) => Effect.Effect<void, SimulationError>;
  readonly send: (args: Readonly<{
    from: string;
    to: string;
    channel: string;
    payload: unknown;
  }>) => Effect.Effect<TSimulationNetworkSendResult, SimulationError>;
  readonly deliverNext: Effect.Effect<TSimulationNetworkEnvelope | null, SimulationError>;
  readonly pending: Effect.Effect<readonly TSimulationNetworkEnvelope[]>;
}

export class SimulationNetwork extends Context.Service<SimulationNetwork, ISimulationNetwork>()(
  'omnidraw/backend/sim/Network',
) {}

export type TSimulationProcessState = Readonly<{
  nodeId: string;
  generation: number;
  running: boolean;
  cancelledOperations: readonly string[];
}>;

export interface ISimulationProcesses {
  readonly start: (args: Readonly<{ nodeId: string }>) => Effect.Effect<TSimulationProcessState, SimulationError>;
  readonly crash: (args: Readonly<{ nodeId: string }>) => Effect.Effect<TSimulationProcessState, SimulationError>;
  readonly restart: (args: Readonly<{ nodeId: string }>) => Effect.Effect<TSimulationProcessState, SimulationError>;
  readonly cancel: (args: Readonly<{
    nodeId: string;
    operationId: string;
  }>) => Effect.Effect<void, SimulationError>;
  readonly isCancelled: (args: Readonly<{
    nodeId: string;
    operationId: string;
  }>) => Effect.Effect<boolean, SimulationError>;
  readonly state: (args: Readonly<{ nodeId: string }>) => Effect.Effect<TSimulationProcessState, SimulationError>;
}

export class SimulationProcesses extends Context.Service<SimulationProcesses, ISimulationProcesses>()(
  'omnidraw/backend/sim/Processes',
) {}

export interface ISimulationOutcomes {
  readonly take: (args: Readonly<{
    kind: 'function' | 'resource';
    operationId: string;
  }>) => Effect.Effect<TSimulationOutcome, SimulationError>;
}

export class SimulationOutcomes extends Context.Service<SimulationOutcomes, ISimulationOutcomes>()(
  'omnidraw/backend/sim/Outcomes',
) {}

export interface ISimulationFaults {
  readonly decide: (args: Readonly<{ point: string }>) => Effect.Effect<TSimulationFault, SimulationError>;
}

export class SimulationFaults extends Context.Service<SimulationFaults, ISimulationFaults>()(
  'omnidraw/backend/sim/Faults',
) {}

export interface ISimulationHostGate {
  readonly register: (args: Readonly<{
    operationId: string;
    capability: string;
  }>) => Effect.Effect<void, SimulationError>;
  readonly complete: <A>(args: Readonly<{
    operationId: string;
    value: A;
  }>) => Effect.Effect<A, SimulationError>;
  readonly rejectEscape: (args: Readonly<{
    operationId: string;
    capability: string;
  }>) => Effect.Effect<never, SimulationError>;
  readonly assertNoEscapes: Effect.Effect<void, SimulationError>;
}

export class SimulationHostGate extends Context.Service<SimulationHostGate, ISimulationHostGate>()(
  'omnidraw/backend/sim/HostGate',
) {}

export type TSimulationCapabilities =
  | SimulationTime
  | SimulationIdentifiers
  | SimulationStorage
  | SimulationNetwork
  | SimulationProcesses
  | SimulationOutcomes
  | SimulationFaults
  | SimulationHostGate;
