export type TReproductionTraceChannel =
  | 'input.dom'
  | 'input.engine'
  | 'picking'
  | 'transform'
  | 'editor'
  | 'document'
  | 'transport'
  | 'widget-host'
  | 'system';

export type TReproductionTracePriority =
  | 'critical'
  | 'high'
  | 'normal'
  | 'low';

export type TReproductionTraceStatus =
  | 'idle'
  | 'recording'
  | 'marked'
  | 'stopped';

export type TReproductionTraceMode = 'smart' | 'advanced';

export type TReproductionTraceValue =
  | null
  | boolean
  | number
  | string
  | readonly TReproductionTraceValue[]
  | Readonly<{ [key: string]: TReproductionTraceValue }>;

export type TReproductionTraceCorrelation = Readonly<{
  canvasId?: string;
  gestureId?: string;
  engineGestureId?: string;
  pointerId?: string;
  nodeId?: string;
  widgetId?: string;
  transactionId?: string;
  commandId?: string;
}>;

export type TReproductionTraceEventInput = Readonly<{
  channel: TReproductionTraceChannel;
  type: string;
  priority?: TReproductionTracePriority;
  correlation?: TReproductionTraceCorrelation;
  data?: unknown;
}>;

export type TReproductionTraceEvent = Readonly<{
  sequence: number;
  elapsedMs: number;
  channel: TReproductionTraceChannel;
  type: string;
  priority: TReproductionTracePriority;
  correlation?: TReproductionTraceCorrelation;
  data?: TReproductionTraceValue;
}>;

export type TReproductionTraceEnvironment = Readonly<{
  applicationVersion: string;
  buildMode: string;
  canvasId: string;
  cangineVersion: string;
  browser: string;
  platform: string;
  viewport: Readonly<{ width: number; height: number }>;
  devicePixelRatio: number;
}>;

export type TReproductionTraceHeader = Readonly<{
  kind: 'vibecanvas-developer-trace';
  schemaVersion: 1;
  mode: TReproductionTraceMode;
  startedAt: string;
  environment: TReproductionTraceEnvironment;
  enabledChannels: readonly TReproductionTraceChannel[];
  budgets: Readonly<{
    copyBytes: number;
    downloadBytes: number;
    maxEvents: number;
    markTailMs: number;
  }>;
}>;

export type TReproductionTraceOmissions = Readonly<{
  captured: number;
  retained: number;
  coalesced: number;
  summarized: number;
  omitted: number;
  redacted: number;
}>;

export type TReproductionTraceAnomaly = Readonly<{
  kind: 'possible anomaly';
  rule: string;
  relatedSequences: readonly number[];
  explanation: string;
}>;

export type TReproductionTraceSummary = Readonly<{
  kind: 'summary';
  status: TReproductionTraceStatus;
  durationMs: number;
  markedSequence: number | null;
  eventCounts: Readonly<Record<string, number>>;
  gestureChains: readonly Readonly<{
    gestureId: string;
    sequences: readonly number[];
    channels: readonly TReproductionTraceChannel[];
  }>[];
  anomalies: readonly TReproductionTraceAnomaly[];
  omissions: TReproductionTraceOmissions;
}>;

export type TReproductionTraceArtifact = Readonly<{
  text: string;
  bytes: number;
  summary: TReproductionTraceSummary;
}>;

export type TReproductionTraceArtifacts = Readonly<{
  copy: TReproductionTraceArtifact;
  download: TReproductionTraceArtifact;
}>;

export type TReproductionTraceState = Readonly<{
  status: TReproductionTraceStatus;
  elapsedMs: number;
  retainedEvents: number;
  omittedEvents: number;
  estimatedBytes: number;
  markedSequence: number | null;
  enabledChannels: readonly TReproductionTraceChannel[];
  canStart: boolean;
  canMark: boolean;
  canStop: boolean;
  canExport: boolean;
  canClear: boolean;
}>;

export type TReproductionTraceSink = Readonly<{
  emit(event: TReproductionTraceEventInput): void;
  elapsedMs(): number;
  isRecording(): boolean;
  mode(): TReproductionTraceMode;
}>;

export type TReproductionTraceOwner = TReproductionTraceSink & Readonly<{
  start(
    channels?: readonly TReproductionTraceChannel[],
    mode?: TReproductionTraceMode,
  ): boolean;
  mark(): boolean;
  stop(): boolean;
  clear(): void;
  copy(): Promise<boolean>;
  download(): boolean;
  artifacts(): TReproductionTraceArtifacts | null;
  state(): TReproductionTraceState;
  subscribe(listener: (state: TReproductionTraceState) => void): () => void;
  subscribeLifecycle(
    listener: (recording: boolean) => void,
  ): () => void;
  dispose(): void;
}>;

export type TReproductionTraceDiagnostics = Readonly<{
  reproductionTrace: true;
  applicationVersion?: string;
  buildMode?: string;
  cangineVersion?: string;
}>;
