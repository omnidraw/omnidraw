/**
 * @file Authoring and registration surface for bounded short-lived server functions.
 * This tiny runtime is bundled into each server artifact.
 */

import type {
  TWidgetSerializableJsonObject,
  TWidgetServerFunctionDescriptor,
  TWidgetServerFunctionEffect,
  TWidgetServerFunctionLimits,
  TWidgetServerFunctionResourceAccess,
  TWidgetServerFunctionRetry,
} from '@vibecanvas/widget-contract';

export type TServerFunctionRuntimeSchema<TValue> = Readonly<{
  parse(value: unknown): TValue;
}>;

export type TServerFunctionResourceDeclaration = Readonly<Record<
  string,
  'read' | 'write' | 'read_write'
>>;

type TSchemaValue<TSchema> = TSchema extends TServerFunctionRuntimeSchema<infer TValue>
  ? TValue
  : never;

type TReadableSlot<TResources extends TServerFunctionResourceDeclaration> = {
  [TSlot in keyof TResources]: TResources[TSlot] extends 'read' | 'read_write' ? TSlot : never;
}[keyof TResources] & string;

type TWritableSlot<TResources extends TServerFunctionResourceDeclaration> = {
  [TSlot in keyof TResources]: TResources[TSlot] extends 'write' | 'read_write' ? TSlot : never;
}[keyof TResources] & string;

export type TServerFunctionReadResources<
  TResources extends TServerFunctionResourceDeclaration,
> = Readonly<{
  read<TOutput = unknown>(
    slot: TReadableSlot<TResources>,
    operation: string,
    input: unknown,
  ): Promise<TOutput>;
}>;

export type TServerFunctionWriteResources<
  TResources extends TServerFunctionResourceDeclaration,
> = TServerFunctionReadResources<TResources> & Readonly<{
  write<TOutput = unknown>(
    slot: TWritableSlot<TResources>,
    operation: string,
    input: unknown,
  ): Promise<TOutput>;
}>;

type TServerFunctionResources<
  TEffect extends TWidgetServerFunctionEffect,
  TResources extends TServerFunctionResourceDeclaration,
> = TEffect extends 'fn'
  ? Readonly<Record<never, never>>
  : TEffect extends 'fx'
    ? TServerFunctionReadResources<TResources>
    : TServerFunctionWriteResources<TResources>;

export type TServerFunctionContext<
  TEffect extends TWidgetServerFunctionEffect = TWidgetServerFunctionEffect,
  TResources extends TServerFunctionResourceDeclaration = TServerFunctionResourceDeclaration,
> = Readonly<{
  identity: Readonly<{
    orgId: string;
    accountId: string;
    roles: readonly string[];
  }>;
  invocationId: string;
  widgetRevisionId: string;
  widgetInstanceId: string;
  attemptId: string;
  leaseEpoch: number;
  deadlineAtMs: number;
  signal: AbortSignal;
  resources: TServerFunctionResources<TEffect, TResources>;
  log: Readonly<{
    debug(fields: Readonly<Record<string, unknown>>, message?: string): void;
    info(fields: Readonly<Record<string, unknown>>, message?: string): void;
    warn(fields: Readonly<Record<string, unknown>>, message?: string): void;
    error(fields: Readonly<Record<string, unknown>>, message?: string): void;
  }>;
  metrics: Readonly<{
    increment(name: string, value?: number): void;
  }>;
}>;

type TResourcesConfig<
  TEffect extends TWidgetServerFunctionEffect,
  TResources extends TServerFunctionResourceDeclaration,
> = TEffect extends 'fn'
  ? Readonly<{ resources?: never }>
  : TEffect extends 'fx'
    ? Readonly<{ resources: TResources & Readonly<Record<keyof TResources, 'read'>> }>
    : Readonly<{ resources: TResources }>;

export type TServerFunctionConfig<
  TInputSchema extends TServerFunctionRuntimeSchema<unknown>,
  TOutputSchema extends TServerFunctionRuntimeSchema<unknown>,
  TEffect extends TWidgetServerFunctionEffect,
  TResources extends TServerFunctionResourceDeclaration,
> = Readonly<{
  effect: TEffect;
  input: TInputSchema;
  output: TOutputSchema;
  limits?: Partial<TWidgetServerFunctionLimits>;
  retry?: TWidgetServerFunctionRetry['mode'];
}> & TResourcesConfig<TEffect, TResources>;

type TServerFunctionRegistration = Omit<TWidgetServerFunctionDescriptor, 'exportName'>;

export type TDefinedServerFunction<
  TInput,
  TOutput,
  TEffect extends TWidgetServerFunctionEffect = TWidgetServerFunctionEffect,
  TResources extends TServerFunctionResourceDeclaration = TServerFunctionResourceDeclaration,
> = ((input: TInput) => Promise<TOutput>) & Readonly<{
  __vibecanvasServerFunction: 'vibecanvas.server-function.v1';
  __vibecanvasRegistration: TServerFunctionRegistration;
  __vibecanvasExecute(
    context: TServerFunctionContext<TEffect, TResources>,
    input: unknown,
  ): Promise<TOutput>;
}>;

const DEFAULT_LIMITS: TWidgetServerFunctionLimits = Object.freeze({
  timeoutMs: 5_000,
  memoryTier: 'small',
  outputByteLimit: 262_144,
  logByteLimit: 65_536,
});

const CONFIG_KEYS = new Set(['effect', 'input', 'output', 'resources', 'limits', 'retry']);
const LIMIT_KEYS = new Set(['timeoutMs', 'memoryTier', 'outputByteLimit', 'logByteLimit']);
const SLOT_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,199}$/;

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
}

function assertOnlyKeys(value: Record<string, unknown>, keys: ReadonlySet<string>, label: string): void {
  const unknown = Object.keys(value).find((key) => !keys.has(key));
  if (unknown !== undefined) {
    throw new TypeError(`${label} contains unsupported field '${unknown}'.`);
  }
}

function assertIntegerInRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
}

function runtimeJsonSchema(
  schema: TServerFunctionRuntimeSchema<unknown>,
  label: string,
): TWidgetSerializableJsonObject {
  const method = (schema as { toJSONSchema?: () => unknown }).toJSONSchema;
  if (typeof method !== 'function') {
    throw new TypeError(`${label} must expose toJSONSchema() for runtime validation.`);
  }
  const value = method.call(schema);
  assertPlainObject(value, `${label} JSON schema`);
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined || encoded.length > 262_144) {
      throw new TypeError(`${label} JSON schema exceeds the descriptor limit.`);
    }
    return JSON.parse(encoded) as TWidgetSerializableJsonObject;
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('descriptor limit')) throw error;
    throw new TypeError(`${label} must emit a serializable JSON schema.`);
  }
}

function normalizeLimits(value: Partial<TWidgetServerFunctionLimits> | undefined): TWidgetServerFunctionLimits {
  if (value === undefined) return DEFAULT_LIMITS;
  assertPlainObject(value, 'Server-function limits');
  assertOnlyKeys(value, LIMIT_KEYS, 'Server-function limits');
  const limits = { ...DEFAULT_LIMITS, ...value };
  assertIntegerInRange(limits.timeoutMs, 1, 30_000, 'timeoutMs');
  if (!['small', 'medium', 'large'].includes(limits.memoryTier)) {
    throw new TypeError('memoryTier must be small, medium, or large.');
  }
  assertIntegerInRange(limits.outputByteLimit, 1, 1_048_576, 'outputByteLimit');
  assertIntegerInRange(limits.logByteLimit, 0, 1_048_576, 'logByteLimit');
  return Object.freeze(limits);
}

function normalizeRetry(mode: TWidgetServerFunctionRetry['mode'] | undefined): TWidgetServerFunctionRetry {
  if (mode === undefined || mode === 'none') {
    return Object.freeze({
      mode: 'none',
      maxAttempts: 1,
      initialBackoffMs: 0,
      maxBackoffMs: 0,
    });
  }
  if (mode !== 'idempotent') throw new TypeError('retry must be none or idempotent.');
  return Object.freeze({
    mode: 'idempotent',
    maxAttempts: 2,
    initialBackoffMs: 100,
    maxBackoffMs: 1_000,
  });
}

function normalizeResources(
  effect: TWidgetServerFunctionEffect,
  value: TServerFunctionResourceDeclaration | undefined,
): readonly TWidgetServerFunctionResourceAccess[] {
  const resources = value ?? {};
  assertPlainObject(resources, 'Server-function resources');
  const result = Object.entries(resources)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([slot, resourceEffect]) => {
      if (!SLOT_PATTERN.test(slot)) throw new TypeError(`Invalid resource slot '${slot}'.`);
      if (!['read', 'write', 'read_write'].includes(resourceEffect)) {
        throw new TypeError(`Invalid resource effect for slot '${slot}'.`);
      }
      if (effect === 'fn') throw new TypeError('fn functions cannot declare resources.');
      if (effect === 'fx' && resourceEffect !== 'read') {
        throw new TypeError('fx functions may declare only read resources.');
      }
      return Object.freeze({ slot, effect: resourceEffect });
    });
  return Object.freeze(result);
}

export function defineServerFunction<
  TInputSchema extends TServerFunctionRuntimeSchema<unknown>,
  TOutputSchema extends TServerFunctionRuntimeSchema<unknown>,
  const TEffect extends TWidgetServerFunctionEffect,
  const TResources extends TServerFunctionResourceDeclaration,
>(
  config: TServerFunctionConfig<TInputSchema, TOutputSchema, TEffect, TResources>,
  handler: (
    context: TServerFunctionContext<TEffect, TResources>,
    input: TSchemaValue<TInputSchema>,
  ) => TSchemaValue<TOutputSchema> | Promise<TSchemaValue<TOutputSchema>>,
): TDefinedServerFunction<
  TSchemaValue<TInputSchema>,
  TSchemaValue<TOutputSchema>,
  TEffect,
  TResources
> {
  assertPlainObject(config, 'Server-function config');
  assertOnlyKeys(config, CONFIG_KEYS, 'Server-function config');
  if (!['fn', 'fx', 'tx'].includes(config.effect)) {
    throw new TypeError('effect must be fn, fx, or tx.');
  }
  if (typeof config.input?.parse !== 'function' || typeof config.output?.parse !== 'function') {
    throw new TypeError('input and output must be runtime schemas.');
  }

  const registration: TServerFunctionRegistration = Object.freeze({
    schemaVersion: 1,
    effect: config.effect,
    inputSchema: runtimeJsonSchema(config.input, 'input'),
    outputSchema: runtimeJsonSchema(config.output, 'output'),
    resources: normalizeResources(config.effect, config.resources),
    limits: normalizeLimits(config.limits),
    retry: normalizeRetry(config.retry),
  });

  const callable = (async () => {
    throw new Error('Server functions must be called through a generated widget client proxy.');
  }) as unknown as TDefinedServerFunction<
    TSchemaValue<TInputSchema>,
    TSchemaValue<TOutputSchema>,
    TEffect,
    TResources
  >;
  Object.defineProperties(callable, {
    __vibecanvasServerFunction: {
      enumerable: false,
      value: 'vibecanvas.server-function.v1',
    },
    __vibecanvasRegistration: {
      enumerable: false,
      value: registration,
    },
    __vibecanvasExecute: {
      enumerable: false,
      value: async (context: TServerFunctionContext<TEffect, TResources>, input: unknown) => {
        const parsedInput = config.input.parse(input) as TSchemaValue<TInputSchema>;
        const output = await handler(context, parsedInput);
        return config.output.parse(output) as TSchemaValue<TOutputSchema>;
      },
    },
  });
  return Object.freeze(callable);
}

export function isDefinedServerFunction(
  value: unknown,
): value is TDefinedServerFunction<unknown, unknown> {
  return typeof value === 'function'
    && (value as Partial<TDefinedServerFunction<unknown, unknown>>).__vibecanvasServerFunction
      === 'vibecanvas.server-function.v1';
}

/** Called only inside a registration sandbox after loading the built server entry. */
export function collectServerFunctionDescriptors(
  moduleExports: Readonly<Record<string, unknown>>,
): readonly TWidgetServerFunctionDescriptor[] {
  assertPlainObject(moduleExports, 'Server entry exports');
  const descriptors = Object.entries(moduleExports)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([exportName, value]) => {
      if (!isDefinedServerFunction(value)) {
        throw new TypeError(`Server export '${exportName}' is not a defined server function.`);
      }
      return Object.freeze({
        ...value.__vibecanvasRegistration,
        exportName,
      });
    });
  return Object.freeze(descriptors);
}
