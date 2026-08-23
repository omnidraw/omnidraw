export const SIMULATION_RECORD_SCHEMA_VERSION = '1.0.0' as const;
export const SIMULATION_EFFECT_VERSION = '4.0.0-rc.108' as const;

export type TSimulationFault = 'pass' | 'fail-before' | 'commit-then-lost-ack';

export type TSimulationNetworkDisposition =
  | Readonly<{ type: 'deliver' }>
  | Readonly<{ type: 'drop' }>
  | Readonly<{ type: 'duplicate'; copies?: number }>
  | Readonly<{ type: 'delay'; millis: number }>;

export type TSimulationOutcome =
  | Readonly<{ status: 'success'; value: unknown }>
  | Readonly<{ status: 'failure'; error: string }>
  | Readonly<{ status: 'cancelled' }>;

export type TSimulationScheduleChoice = Readonly<{
  sequence: number;
  dispatcherId: number;
  priority: number;
  runnableSequences: readonly number[];
  selectedIndex: number;
  selectedSequence: number;
}>;

export type TSimulationStep =
  | Readonly<{
      type: 'choice';
      sequence: number;
      stream: string;
      label: string;
      optionCount: number;
      selectedIndex: number;
    }>
  | Readonly<{
      type: 'fault';
      sequence: number;
      point: string;
      outcome: TSimulationFault;
    }>
  | Readonly<{
      type: 'time';
      sequence: number;
      fromMillis: number;
      toMillis: number;
    }>
  | Readonly<{
      type: 'id';
      sequence: number;
      namespace: string;
      label: string;
      value: string;
    }>
  | Readonly<{
      type: 'transaction';
      sequence: number;
      transactionId: string;
      outcome: 'committed' | 'duplicate' | 'conflict' | 'failed-before' | 'lost-ack';
      versions: Readonly<Record<string, number>>;
    }>
  | Readonly<{
      type: 'network';
      sequence: number;
      action: 'connect' | 'disconnect' | 'enqueue' | 'drop' | 'deliver';
      messageId: string | null;
      from: string;
      to: string;
      channel: string | null;
      copy: number | null;
      readyAtMillis: number | null;
    }>
  | Readonly<{
      type: 'process';
      sequence: number;
      action: 'start' | 'cancel' | 'crash' | 'restart';
      nodeId: string;
      operationId: string | null;
    }>
  | Readonly<{
      type: 'outcome';
      sequence: number;
      kind: 'function' | 'resource';
      operationId: string;
      status: TSimulationOutcome['status'];
    }>
  | Readonly<{
      type: 'host-gate';
      sequence: number;
      action: 'register' | 'complete' | 'escape';
      operationId: string;
      capability: string;
    }>
  | Readonly<{
      type: 'observation';
      sequence: number;
      label: string;
      value: unknown;
    }>;

export type TSimulationStepInput = TSimulationStep extends infer Step
  ? Step extends TSimulationStep
    ? Omit<Step, 'sequence'>
    : never
  : never;

export type TSimulationRecord = Readonly<{
  schemaVersion: typeof SIMULATION_RECORD_SCHEMA_VERSION;
  applicationVersion: string;
  effectVersion: typeof SIMULATION_EFFECT_VERSION;
  scenario: string;
  rootSeed: number;
  logicalNodes: readonly string[];
  initialConfiguration: unknown;
  stepBound: number;
  schedule: readonly TSimulationScheduleChoice[];
  steps: readonly TSimulationStep[];
  finalStateDigest: string | null;
  invariantFailure: Readonly<{ name: string; message: string }> | null;
}>;

export type TSimulationConfig = Readonly<{
  applicationVersion: string;
  scenario: string;
  rootSeed: number;
  logicalNodes?: readonly string[];
  initialConfiguration?: unknown;
  stepBound?: number;
  scriptedFaults?: Readonly<Record<string, readonly TSimulationFault[]>>;
  scriptedDeliveries?: Readonly<Record<string, readonly TSimulationNetworkDisposition[]>>;
  scriptedOutcomes?: Readonly<Record<string, readonly TSimulationOutcome[]>>;
  replay?: TSimulationRecord;
}>;
