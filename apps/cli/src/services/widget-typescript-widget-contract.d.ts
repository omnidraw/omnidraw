export type TWidgetServerFunctionEffect = 'fn' | 'fx' | 'tx';

export type TWidgetServerFunctionLimits = Readonly<{
  timeoutMs: number;
  memoryTier: 'small' | 'medium' | 'large';
  outputByteLimit: number;
  logByteLimit: number;
}>;

export type TWidgetServerFunctionRetry = Readonly<{
  mode: 'none' | 'idempotent';
  maxAttempts: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
}>;

export type TWidgetSerializableJson =
  | null
  | boolean
  | number
  | string
  | readonly TWidgetSerializableJson[]
  | Readonly<{ [key: string]: TWidgetSerializableJson }>;

export type TWidgetServerFunctionDescriptor = Readonly<{
  schemaVersion: 1;
  exportName: string;
  modulePath: string;
  effect: TWidgetServerFunctionEffect;
  inputSchema: Readonly<Record<string, TWidgetSerializableJson>>;
  outputSchema: Readonly<Record<string, TWidgetSerializableJson>>;
  resources: readonly Readonly<{
    slot: string;
    effect: 'read' | 'write' | 'read_write';
  }>[];
  limits: TWidgetServerFunctionLimits;
  retry: TWidgetServerFunctionRetry;
}>;

export type TWidgetUiManifest = Readonly<{ entry: string }>;
export type TWidgetServerManifest = Readonly<{ entry: string; runtimeAbi: string }>;
export type TWidgetManifestV2 = Readonly<{
  schemaVersion: 2;
  name: string;
  slug: string;
  description?: string;
  ui: TWidgetUiManifest;
  server?: TWidgetServerManifest;
}>;
