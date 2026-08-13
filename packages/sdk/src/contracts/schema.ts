/** Library-neutral strict validators for every portable SDK boundary. */

import {
  WIDGET_BUILD_FILE_MAX_BYTES,
  WIDGET_BUILD_RECEIPT_FORMAT,
  WIDGET_BUILD_RECEIPT_MAX_BYTES,
  WIDGET_BUILD_RECEIPT_OUTPUT_COUNT_MAX,
  WIDGET_BUILD_RECEIPT_PATH,
  WIDGET_BUILD_TOTAL_BYTES_MAX,
  WIDGET_RUNTIME_API_GROUPS,
  WIDGET_DESCRIPTION_MAX_CHARACTERS,
  WIDGET_MANIFEST_V1_SCHEMA_URL,
  WIDGET_NAME_MAX_CHARACTERS,
  WIDGET_RELEASE_FILE_COUNT_MAX,
  WIDGET_RELEASE_FILE_MAX_BYTES,
  WIDGET_RELEASE_FORMAT,
  WIDGET_SLUG_MAX_BYTES,
  WIDGET_TOOL_GROUP_MAX_BYTES,
  WIDGET_TOOL_LABEL_MAX_CHARACTERS,
} from './CONSTANTS';
import {
  fnNormalizeWidgetRuntimeApis,
  fnNormalizeWidgetRuntimeBudgetRequest,
  fnNormalizeWidgetRuntimeDescriptor,
} from './core/fn.capsule';
import {
  fnNormalizeWidgetBrowserFunctionDescriptors,
  fnNormalizeWidgetServerFunctionDescriptors,
} from './core/fn.function-descriptor';
import {
  fnNormalizeWidgetExecutableProjection,
  fnNormalizeWidgetManifestV1,
} from './core/fn.filesystem-manifest';
import {
  fnNormalizeWidgetFilesystemRelativePath,
  fnUtf8ByteLength,
  fnWidgetToolIconTextError,
} from './core/fn.filesystem-path';
import type {
  TWidgetBuildReceipt,
  TWidgetExecutableManifestProjection,
  TWidgetManifestV1,
  TWidgetReleaseDescriptor,
  TWidgetUnsignedReleaseDescriptor,
} from './filesystem/typed';
import type {
  TOmnidrawToolIcon,
  TWidgetBrowserFunctionDescriptor,
  TWidgetRuntimeApiGroup,
  TWidgetRuntimeBudgetRequest,
  TWidgetRuntimeBudgets,
  TWidgetCapabilityRequest,
  TWidgetChannelContract,
  TWidgetParkability,
  TWidgetSchemaReference,
  TWidgetRuntimeDescriptor,
  TWidgetDiagnostic,
  TWidgetResourceRequirement,
  TWidgetSerializableJsonObject,
  TWidgetServerFunctionDescriptor,
} from './types';
import { isLucideStaticIconKey } from './tool-icon';

export type TSdkValidationPath = readonly (string | number)[];
export type TSdkValidationIssue = Readonly<{
  code: 'invalid_type' | 'invalid_value' | 'unknown_key' | 'duplicate' | 'limit';
  message: string;
  path: TSdkValidationPath;
}>;
export type TSdkValidationResult<T> =
  | Readonly<{ success: true; data: T }>
  | Readonly<{ success: false; error: SdkValidationError }>;

/** Stable SDK error shape; it deliberately does not inherit a schema-library type. */
export class SdkValidationError extends TypeError {
  readonly issues: readonly TSdkValidationIssue[];

  constructor(issues: readonly TSdkValidationIssue[]) {
    super(issues[0]?.message ?? 'SDK boundary validation failed.');
    this.name = 'SdkValidationError';
    this.issues = Object.freeze([...issues]);
  }
}

export type TSdkValidator<T> = Readonly<{
  parse(value: unknown): T;
  safeParse(value: unknown): TSdkValidationResult<T>;
  is(value: unknown): value is T;
}>;

function validator<T>(decode: (value: unknown) => T): TSdkValidator<T> {
  const safeParse = (value: unknown): TSdkValidationResult<T> => {
    try {
      return Object.freeze({ success: true as const, data: decode(value) });
    } catch (error) {
      const validation = error instanceof SdkValidationError
        ? error
        : new SdkValidationError([issue([], error instanceof Error ? error.message : 'Validation failed.')]);
      return Object.freeze({ success: false as const, error: validation });
    }
  };
  return Object.freeze({
    parse: decode,
    safeParse,
    is(value: unknown): value is T {
      return safeParse(value).success;
    },
  });
}

function issue(
  path: TSdkValidationPath,
  message: string,
  code: TSdkValidationIssue['code'] = 'invalid_value',
): TSdkValidationIssue {
  return Object.freeze({ code, message, path: Object.freeze([...path]) });
}

function fail(path: TSdkValidationPath, message: string, code?: TSdkValidationIssue['code']): never {
  throw new SdkValidationError([issue(path, message, code)]);
}

function record(value: unknown, path: TSdkValidationPath): Record<string, unknown> {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).some((key) => typeof key !== 'string')
  ) {
    return fail(path, 'Expected an object.', 'invalid_type');
  }
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], path: TSdkValidationPath): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unknown !== undefined) fail([...path, unknown], `Unsupported field '${unknown}'.`, 'unknown_key');
}

function stringValue(
  value: unknown,
  path: TSdkValidationPath,
  options: Readonly<{ min?: number; max?: number; pattern?: RegExp; trim?: boolean }> = {},
): string {
  if (typeof value !== 'string') return fail(path, 'Expected a string.', 'invalid_type');
  const normalized = options.trim ? value.trim() : value;
  if (normalized.length < (options.min ?? 0) || normalized.length > (options.max ?? Number.MAX_SAFE_INTEGER)) {
    return fail(path, 'String length is outside the accepted range.', 'limit');
  }
  if (options.pattern !== undefined && !options.pattern.test(normalized)) {
    return fail(path, 'String has an invalid format.');
  }
  return normalized;
}

function booleanValue(value: unknown, path: TSdkValidationPath): boolean {
  if (typeof value !== 'boolean') return fail(path, 'Expected a boolean.', 'invalid_type');
  return value;
}

function integer(value: unknown, path: TSdkValidationPath, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    return fail(path, `Expected an integer from ${minimum} through ${maximum}.`);
  }
  return value as number;
}

function finiteNumber(value: unknown, path: TSdkValidationPath, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    return fail(path, `Expected a finite number from ${minimum} through ${maximum}.`);
  }
  return value;
}

function literal<T extends string | number | boolean>(value: unknown, expected: T, path: TSdkValidationPath): T {
  if (value !== expected) return fail(path, `Expected ${JSON.stringify(expected)}.`);
  return expected;
}

function optional<T>(value: unknown, decode: (value: unknown) => T): T | undefined {
  return value === undefined ? undefined : decode(value);
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CAPSULE_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,199}$/;
const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SLOT_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,199}$/;
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9._-]{0,127}$/;
const EXPORT_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/;
const BUILD_ENTRY_PATTERN = /\.(?:[cm]?[jt]sx?)$/;
const SDK_VERSION_PATTERN = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]{1,80})?$/;
const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*)+$/;
const OPERATION_PATTERN = /^[a-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*$/;
const VERSION_RANGE_PATTERN = /^(?:\*|[\^~]?(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))$/;
const MODULE_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\\)(?!.*\0)[^/]+(?:\/[^/]+)*\.(?:[cm]?[jt]sx?)$/;

function sha256(value: unknown, path: TSdkValidationPath): string {
  return stringValue(value, path, { pattern: SHA256_PATTERN });
}

function capsuleHash(value: unknown, path: TSdkValidationPath): `sha256:${string}` {
  return stringValue(value, path, { pattern: CAPSULE_HASH_PATTERN }) as `sha256:${string}`;
}

function buildEntry(value: unknown, path: TSdkValidationPath): string {
  const source = stringValue(value, path, { min: 1, max: 1_024 });
  const normalized = fnNormalizeWidgetFilesystemRelativePath(source);
  if (normalized === null || !BUILD_ENTRY_PATTERN.test(normalized)) {
    return fail(path, 'Expected a safe JavaScript or TypeScript widget entry path.');
  }
  return normalized;
}

function icon(value: unknown, path: TSdkValidationPath): TOmnidrawToolIcon {
  const input = record(value, path);
  onlyKeys(input, ['lucidIcon', 'svgIcon'], path);
  const lucidIcon = optional(input.lucidIcon, (entry) => stringValue(entry, [...path, 'lucidIcon'], {
    min: 1, max: 200, pattern: /^[A-Za-z][A-Za-z0-9]*$/,
  }));
  const svgIcon = optional(input.svgIcon, (entry) => stringValue(entry, [...path, 'svgIcon'], { min: 1 }));
  if (lucidIcon === undefined && svgIcon === undefined) fail(path, 'Tool icon must declare lucidIcon or svgIcon.');
  if (lucidIcon !== undefined && !isLucideStaticIconKey(lucidIcon)) {
    fail([...path, 'lucidIcon'], 'Unknown Lucide static icon key.');
  }
  if (svgIcon !== undefined) {
    const error = fnWidgetToolIconTextError(svgIcon);
    if (error !== null) fail([...path, 'svgIcon'], error);
  }
  return Object.freeze({ ...(lucidIcon === undefined ? {} : { lucidIcon }), ...(svgIcon === undefined ? {} : { svgIcon }) });
}

function allowedCapsuleApis(value: unknown, path: TSdkValidationPath): readonly TWidgetRuntimeApiGroup[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > WIDGET_RUNTIME_API_GROUPS.length) {
    return fail(path, 'Capsule API groups must be a non-empty bounded array.', 'invalid_type');
  }
  const allowed = new Set<string>(WIDGET_RUNTIME_API_GROUPS);
  const apis = value.map((entry, index) => {
    if (typeof entry !== 'string' || !allowed.has(entry)) fail([...path, index], 'Unknown Capsule API group.');
    return entry as TWidgetRuntimeApiGroup;
  });
  if (new Set(apis).size !== apis.length) fail(path, 'Capsule API groups must be unique.', 'duplicate');
  if (!apis.includes('DOM')) fail(path, 'Capsule API groups must explicitly include DOM.');
  return Object.freeze(WIDGET_RUNTIME_API_GROUPS.filter((api) => apis.includes(api)));
}

function capsuleApis(value: unknown, path: TSdkValidationPath): readonly TWidgetRuntimeApiGroup[] {
  try {
    return Object.freeze(fnNormalizeWidgetRuntimeApis(allowedCapsuleApis(value, path)));
  } catch (error) {
    return fail(path, error instanceof Error ? error.message : 'Invalid Capsule API group selection.');
  }
}

const BUDGET_KEYS = [
  'cpuMs', 'memoryBytes', 'domNodes', 'handles', 'messageBytes', 'streamBytes',
  'assetBytes', 'networkBytes', 'gpuBytes', 'lifecycleBytes',
] as const;

function budgets(value: unknown, path: TSdkValidationPath): TWidgetRuntimeBudgetRequest {
  const input = record(value, path);
  onlyKeys(input, BUDGET_KEYS, path);
  const result: Record<string, number> = {};
  for (const key of BUDGET_KEYS) {
    if (input[key] === undefined) continue;
    result[key] = key === 'cpuMs'
      ? finiteNumber(input[key], [...path, key], 0, Number.MAX_SAFE_INTEGER)
      : integer(input[key], [...path, key], 0, Number.MAX_SAFE_INTEGER);
  }
  return Object.freeze(fnNormalizeWidgetRuntimeBudgetRequest(result));
}

function completeBudgets(value: unknown, path: TSdkValidationPath): TWidgetRuntimeBudgets {
  const result = budgets(value, path);
  for (const key of BUDGET_KEYS) {
    if (result[key] === undefined) fail([...path, key], `Required budget '${key}' is missing.`);
  }
  return result as TWidgetRuntimeBudgets;
}

function resourceId(value: unknown, path: TSdkValidationPath): string {
  return stringValue(value, path, { min: 1, max: 128, pattern: RESOURCE_ID_PATTERN });
}

function resourceRequirement(
  value: unknown,
  path: TSdkValidationPath,
  executable: boolean,
): TWidgetResourceRequirement {
  const input = record(value, path);
  onlyKeys(input, ['slot', 'resourceId', 'kind', 'effect', 'required', 'arbitrarySql', 'operations'], path);
  const slot = stringValue(input.slot, [...path, 'slot'], { pattern: SLOT_PATTERN });
  const resourceId = optional(input.resourceId, (entry) => stringValue(entry, [...path, 'resourceId'], {
    min: 1, max: 128, pattern: RESOURCE_ID_PATTERN,
  }));
  if (executable && resourceId !== undefined) fail([...path, 'resourceId'], 'Executable projections cannot contain resource IDs.');
  if (!['kv', 'secretStore', 'db'].includes(String(input.kind))) fail([...path, 'kind'], 'Unknown resource kind.');
  if (!['read', 'write', 'read_write'].includes(String(input.effect))) fail([...path, 'effect'], 'Unknown resource effect.');
  const kind = input.kind as TWidgetResourceRequirement['kind'];
  const effect = input.effect as TWidgetResourceRequirement['effect'];
  const required = optional(input.required, (entry) => booleanValue(entry, [...path, 'required']));
  const arbitrarySql = optional(input.arbitrarySql, (entry) => booleanValue(entry, [...path, 'arbitrarySql']));
  let operations: TWidgetResourceRequirement['operations'];
  if (input.operations !== undefined) {
    const operationInput = record(input.operations, [...path, 'operations']);
    const operationEntries = Object.entries(operationInput).sort(([left], [right]) => left.localeCompare(right));
    const normalized: Record<string, NonNullable<TWidgetResourceRequirement['operations']>[string]> = {};
    for (const [name, operationValue] of operationEntries) {
      if (!NAME_PATTERN.test(name)) fail([...path, 'operations', name], 'Invalid resource operation name.');
      const operation = record(operationValue, [...path, 'operations', name]);
      onlyKeys(operation, ['effect', 'sql', 'parameters', 'result'], [...path, 'operations', name]);
      if (!['read', 'write'].includes(String(operation.effect))) fail([...path, 'operations', name, 'effect'], 'Invalid operation effect.');
      if (effect !== 'read_write' && operation.effect !== effect) {
        fail([...path, 'operations', name, 'effect'], 'Operation exceeds the resource effect ceiling.');
      }
      const parametersInput = operation.parameters === undefined
        ? undefined
        : record(operation.parameters, [...path, 'operations', name, 'parameters']);
      const parameters = parametersInput === undefined ? undefined : Object.fromEntries(
        Object.entries(parametersInput).sort(([left], [right]) => left.localeCompare(right)).map(([parameter, declarationValue]) => {
          if (!NAME_PATTERN.test(parameter)) fail([...path, 'operations', name, 'parameters', parameter], 'Invalid operation parameter name.');
          const declaration = record(declarationValue, [...path, 'operations', name, 'parameters', parameter]);
          onlyKeys(declaration, ['type', 'required', 'nullable'], [...path, 'operations', name, 'parameters', parameter]);
          if (!['string', 'number', 'boolean', 'bigint', 'bytes', 'json'].includes(String(declaration.type))) {
            fail([...path, 'operations', name, 'parameters', parameter, 'type'], 'Invalid operation parameter type.');
          }
          return [parameter, Object.freeze({
            type: declaration.type as 'string',
            ...(declaration.required === undefined ? {} : { required: booleanValue(declaration.required, [...path, 'operations', name, 'parameters', parameter, 'required']) }),
            ...(declaration.nullable === undefined ? {} : { nullable: booleanValue(declaration.nullable, [...path, 'operations', name, 'parameters', parameter, 'nullable']) }),
          })];
        }),
      );
      if (!['rows', 'execute'].includes(String(operation.result))) fail([...path, 'operations', name, 'result'], 'Invalid operation result kind.');
      normalized[name] = Object.freeze({
        effect: operation.effect as 'read' | 'write',
        sql: stringValue(operation.sql, [...path, 'operations', name, 'sql'], { min: 1, max: 100_000 }),
        ...(parameters === undefined ? {} : { parameters }),
        result: operation.result as 'rows' | 'execute',
      });
    }
    operations = Object.freeze(normalized);
  }
  if (kind !== 'db' && (arbitrarySql !== undefined || operations !== undefined)) {
    fail(path, 'Only database requirements may declare SQL operations.');
  }
  return Object.freeze({
    slot,
    ...(resourceId === undefined ? {} : { resourceId }),
    kind,
    effect,
    ...(required === undefined ? {} : { required }),
    ...(arbitrarySql === undefined ? {} : { arbitrarySql }),
    ...(operations === undefined ? {} : { operations }),
  });
}

function resources(value: unknown, path: TSdkValidationPath, executable: boolean): readonly TWidgetResourceRequirement[] {
  if (!Array.isArray(value) || value.length > 64) return fail(path, 'Resource declarations must be a bounded array.', 'invalid_type');
  const seen = new Set<string>();
  const result = value.map((entry, index) => {
    const requirement = resourceRequirement(entry, [...path, index], executable);
    if (seen.has(requirement.slot)) fail([...path, index, 'slot'], `Duplicate resource slot: ${requirement.slot}`, 'duplicate');
    seen.add(requirement.slot);
    return requirement;
  });
  return Object.freeze(result);
}

function ui(value: unknown, path: TSdkValidationPath): TWidgetManifestV1['ui'] {
  const input = record(value, path);
  onlyKeys(input, ['runtime', 'entry', 'apis', 'budgets', 'state', 'parkability'], path);
  literal(input.runtime, 'capsule', [...path, 'runtime']);
  const stateInput = input.state === undefined ? undefined : record(input.state, [...path, 'state']);
  if (stateInput !== undefined) onlyKeys(stateInput, ['collaborative', 'localStore'], [...path, 'state']);
  const parkInput = input.parkability === undefined ? undefined : record(input.parkability, [...path, 'parkability']);
  if (parkInput !== undefined) onlyKeys(parkInput, ['enabled'], [...path, 'parkability']);
  return Object.freeze({
    runtime: 'capsule',
    entry: buildEntry(input.entry, [...path, 'entry']),
    apis: capsuleApis(input.apis, [...path, 'apis']),
    ...(input.budgets === undefined ? {} : { budgets: budgets(input.budgets, [...path, 'budgets']) }),
    ...(stateInput === undefined ? {} : {
      state: Object.freeze({
        collaborative: booleanValue(stateInput.collaborative, [...path, 'state', 'collaborative']),
        localStore: literal(
          stateInput.localStore,
          stateInput.localStore === 'none' ? 'none' : 'ephemeral',
          [...path, 'state', 'localStore'],
        ),
      }),
    }),
    ...(parkInput === undefined ? {} : {
      parkability: Object.freeze({ enabled: literal(parkInput.enabled, false, [...path, 'parkability', 'enabled']) }),
    }),
  });
}

function server(value: unknown, path: TSdkValidationPath): NonNullable<TWidgetManifestV1['server']> {
  const input = record(value, path);
  onlyKeys(input, ['entry', 'runtimeAbi'], path);
  return Object.freeze({
    entry: buildEntry(input.entry, [...path, 'entry']),
    runtimeAbi: stringValue(input.runtimeAbi, [...path, 'runtimeAbi'], { min: 1, max: 100, pattern: IDENTIFIER_PATTERN }),
  });
}

function decodeManifest(value: unknown): TWidgetManifestV1 {
  const input = record(value, []);
  onlyKeys(input, ['$schema', 'schemaVersion', 'name', 'slug', 'description', 'tool', 'ui', 'server', 'resources'], []);
  const tool = record(input.tool, ['tool']);
  onlyKeys(tool, ['label', 'icon', 'group', 'priority'], ['tool']);
  const name = stringValue(input.name, ['name'], { trim: true, min: 1, max: WIDGET_NAME_MAX_CHARACTERS });
  const slug = stringValue(input.slug, ['slug'], { min: 1, max: WIDGET_SLUG_MAX_BYTES, pattern: SLUG_PATTERN });
  if (fnUtf8ByteLength(slug) > WIDGET_SLUG_MAX_BYTES) fail(['slug'], 'Widget slug exceeds its UTF-8 byte limit.', 'limit');
  const group = tool.group === null ? null : stringValue(tool.group, ['tool', 'group'], {
    min: 1, max: WIDGET_TOOL_GROUP_MAX_BYTES, pattern: SLUG_PATTERN,
  });
  if (group !== null && fnUtf8ByteLength(group) > WIDGET_TOOL_GROUP_MAX_BYTES) fail(['tool', 'group'], 'Tool group exceeds its UTF-8 byte limit.', 'limit');
  const manifest: TWidgetManifestV1 = {
    $schema: literal(input.$schema, WIDGET_MANIFEST_V1_SCHEMA_URL, ['$schema']),
    schemaVersion: literal(input.schemaVersion, 1, ['schemaVersion']),
    name,
    slug,
    description: stringValue(input.description, ['description'], { trim: true, min: 1, max: WIDGET_DESCRIPTION_MAX_CHARACTERS }),
    tool: Object.freeze({
      label: stringValue(tool.label, ['tool', 'label'], { trim: true, min: 1, max: WIDGET_TOOL_LABEL_MAX_CHARACTERS }),
      ...(tool.icon === undefined ? {} : { icon: icon(tool.icon, ['tool', 'icon']) }),
      group,
      priority: integer(tool.priority, ['tool', 'priority'], -1_000, 1_000),
    }),
    ui: ui(input.ui, ['ui']),
    ...(input.server === undefined ? {} : { server: server(input.server, ['server']) }),
    ...(input.resources === undefined ? {} : { resources: resources(input.resources, ['resources'], false) }),
  };
  return Object.freeze(fnNormalizeWidgetManifestV1(manifest));
}

function decodeExecutableManifest(value: unknown): TWidgetExecutableManifestProjection {
  const input = record(value, []);
  onlyKeys(input, ['schemaVersion', 'ui', 'server', 'resources'], []);
  const projection: TWidgetExecutableManifestProjection = {
    schemaVersion: literal(input.schemaVersion, 1, ['schemaVersion']),
    ui: ui(input.ui, ['ui']),
    server: input.server === null ? null : server(input.server, ['server']),
    resources: resources(input.resources, ['resources'], true).map(({ resourceId: _resourceId, ...entry }) => entry),
  };
  return Object.freeze(fnNormalizeWidgetExecutableProjection(projection));
}

function jsonValue(
  value: unknown,
  path: TSdkValidationPath,
  state: { nodes: number },
  depth = 0,
): import('./types').TWidgetSerializableJsonValue {
  state.nodes += 1;
  if (state.nodes > 10_000 || depth > 64) return fail(path, 'JSON value exceeds the structural limit.', 'limit');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return fail(path, 'JSON numbers must be finite.');
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry, index) => jsonValue(entry, [...path, index], state, depth + 1)));
  }
  const input = record(value, path);
  const result: Record<string, import('./types').TWidgetSerializableJsonValue> = {};
  for (const key of Object.keys(input).sort()) {
    result[key] = jsonValue(input[key], [...path, key], state, depth + 1);
  }
  return Object.freeze(result);
}

function jsonObject(value: unknown, path: TSdkValidationPath): TWidgetSerializableJsonObject {
  const result = jsonValue(value, path, { nodes: 0 });
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    return fail(path, 'Runtime schemas must be JSON objects.');
  }
  return result as TWidgetSerializableJsonObject;
}

function functionDescriptor(value: unknown, path: TSdkValidationPath, browser: boolean): TWidgetServerFunctionDescriptor {
  const input = record(value, path);
  onlyKeys(input, browser
    ? ['schemaVersion', 'exportName', 'effect', 'inputSchema', 'outputSchema', 'resources', 'limits']
    : ['schemaVersion', 'exportName', 'modulePath', 'effect', 'inputSchema', 'outputSchema', 'resources', 'limits'], path);
  const effect = String(input.effect);
  if (!['fn', 'fx', 'tx'].includes(effect)) fail([...path, 'effect'], 'Invalid server-function effect.');
  if (!Array.isArray(input.resources) || input.resources.length > 64) fail([...path, 'resources'], 'Function resources must be a bounded array.', 'invalid_type');
  const seen = new Set<string>();
  const functionResources = input.resources.map((entry, index) => {
    const resource = record(entry, [...path, 'resources', index]);
    onlyKeys(resource, ['slot', 'effect'], [...path, 'resources', index]);
    const slot = stringValue(resource.slot, [...path, 'resources', index, 'slot'], { pattern: SLOT_PATTERN });
    if (seen.has(slot)) fail([...path, 'resources', index, 'slot'], 'Duplicate function resource slot.', 'duplicate');
    seen.add(slot);
    if (!['read', 'write', 'read_write'].includes(String(resource.effect))) fail([...path, 'resources', index, 'effect'], 'Invalid function resource effect.');
    if (effect === 'fn') fail([...path, 'resources', index], 'fn functions cannot declare resources.');
    if (effect === 'fx' && resource.effect !== 'read') fail([...path, 'resources', index, 'effect'], 'fx functions may declare only read resources.');
    return Object.freeze({ slot, effect: resource.effect as 'read' | 'write' | 'read_write' });
  });
  const limits = record(input.limits, [...path, 'limits']);
  onlyKeys(limits, ['timeoutMs', 'memoryTier', 'outputByteLimit', 'logByteLimit'], [...path, 'limits']);
  if (!['small', 'medium', 'large'].includes(String(limits.memoryTier))) fail([...path, 'limits', 'memoryTier'], 'Invalid function memory tier.');
  return {
    schemaVersion: literal(input.schemaVersion, 1, [...path, 'schemaVersion']),
    exportName: stringValue(input.exportName, [...path, 'exportName'], { pattern: EXPORT_NAME_PATTERN }),
    ...(!browser && input.modulePath !== undefined ? {
      modulePath: stringValue(input.modulePath, [...path, 'modulePath'], { max: 500, pattern: MODULE_PATH_PATTERN }),
    } : {}),
    effect: effect as 'fn' | 'fx' | 'tx',
    inputSchema: jsonObject(input.inputSchema, [...path, 'inputSchema']),
    outputSchema: jsonObject(input.outputSchema, [...path, 'outputSchema']),
    resources: Object.freeze(functionResources),
    limits: Object.freeze({
      timeoutMs: integer(limits.timeoutMs, [...path, 'limits', 'timeoutMs'], 1, 30_000),
      memoryTier: limits.memoryTier as 'small' | 'medium' | 'large',
      outputByteLimit: integer(limits.outputByteLimit, [...path, 'limits', 'outputByteLimit'], 1, 1_048_576),
      logByteLimit: integer(limits.logByteLimit, [...path, 'limits', 'logByteLimit'], 0, 1_048_576),
    }),
  };
}

function descriptorArray(value: unknown, browser: boolean): readonly TWidgetServerFunctionDescriptor[] {
  if (!Array.isArray(value) || value.length > 128) fail([], 'Function descriptors must be a bounded array.', 'invalid_type');
  const seen = new Set<string>();
  const descriptors = value.map((entry, index) => {
    const descriptor = functionDescriptor(entry, [index], browser);
    if (seen.has(descriptor.exportName)) fail([index, 'exportName'], 'Duplicate server-function export.', 'duplicate');
    seen.add(descriptor.exportName);
    return descriptor;
  });
  return browser
    ? fnNormalizeWidgetBrowserFunctionDescriptors(descriptors)
    : fnNormalizeWidgetServerFunctionDescriptors(descriptors);
}

function capabilityRequest(value: unknown, path: TSdkValidationPath): TWidgetCapabilityRequest {
  const input = record(value, path);
  onlyKeys(input, ['id', 'versionRange', 'contractHash', 'required', 'operations'], path);
  if (!Array.isArray(input.operations) || input.operations.length > 256) fail([...path, 'operations'], 'Capability operations must be a bounded array.', 'invalid_type');
  const seen = new Set<string>();
  const operations = input.operations.map((entry, index) => {
    const operation = stringValue(entry, [...path, 'operations', index], { max: 128, pattern: OPERATION_PATTERN });
    if (seen.has(operation)) fail([...path, 'operations', index], 'Duplicate capability operation.', 'duplicate');
    seen.add(operation);
    return operation;
  });
  return Object.freeze({
    id: stringValue(input.id, [...path, 'id'], { max: 255, pattern: CAPABILITY_ID_PATTERN }),
    versionRange: stringValue(input.versionRange, [...path, 'versionRange'], { max: 64, pattern: VERSION_RANGE_PATTERN }),
    contractHash: capsuleHash(input.contractHash, [...path, 'contractHash']),
    required: booleanValue(input.required, [...path, 'required']),
    operations: Object.freeze(operations.sort()),
  });
}

function schemaReference(value: unknown, path: TSdkValidationPath): Readonly<{ format: 'capsule-schema-v1'; hash: `sha256:${string}` }> {
  const input = record(value, path);
  onlyKeys(input, ['format', 'hash'], path);
  return Object.freeze({
    format: literal(input.format, 'capsule-schema-v1', [...path, 'format']),
    hash: capsuleHash(input.hash, [...path, 'hash']),
  });
}

function channelContract(value: unknown, path: TSdkValidationPath): TWidgetRuntimeDescriptor['channels'] {
  if (value === null) return null;
  const input = record(value, path);
  onlyKeys(input, ['format', 'lifecycle', 'props', 'theme', 'output', 'store'], path);
  const store = input.store === undefined ? undefined : record(input.store, [...path, 'store']);
  if (store !== undefined) onlyKeys(store, ['schema', 'maxEntries'], [...path, 'store']);
  const result = {
    format: literal(input.format, 'capsule-guest-channels-v1', [...path, 'format']),
    ...(input.lifecycle === undefined ? {} : { lifecycle: literal(input.lifecycle, true, [...path, 'lifecycle']) }),
    ...(input.props === undefined ? {} : { props: schemaReference(input.props, [...path, 'props']) }),
    ...(input.theme === undefined ? {} : { theme: schemaReference(input.theme, [...path, 'theme']) }),
    ...(input.output === undefined ? {} : { output: schemaReference(input.output, [...path, 'output']) }),
    ...(store === undefined ? {} : { store: Object.freeze({
      schema: schemaReference(store.schema, [...path, 'store', 'schema']),
      maxEntries: integer(store.maxEntries, [...path, 'store', 'maxEntries'], 1, 1_024),
    }) }),
  } as const;
  if (Object.keys(result).length === 1) fail(path, 'A channel contract must declare at least one channel.');
  return Object.freeze(result);
}

function parkability(value: unknown, path: TSdkValidationPath): TWidgetParkability {
  const input = record(value, path);
  onlyKeys(input, ['parkable'], path);
  return Object.freeze({ parkable: literal(input.parkable, false, [...path, 'parkable']) });
}

function diagnostic(value: unknown): TWidgetDiagnostic {
  const input = record(value, []);
  onlyKeys(input, [
    'formatVersion', 'fingerprint', 'origin', 'phase', 'code', 'severity', 'message',
    'trust', 'draftRevision', 'previewRevisionId', 'buildId', 'buildSequence',
    'occurrenceCount', 'retryability', 'timestampMs', 'file', 'line', 'column',
    'capability', 'operation', 'budgetDimension', 'causeFingerprint', 'remediation',
  ], []);
  const oneOf = <T extends string>(candidate: unknown, values: readonly T[], path: TSdkValidationPath): T => {
    if (typeof candidate !== 'string' || !values.includes(candidate as T)) fail(path, 'Unexpected enum value.');
    return candidate as T;
  };
  const file = optional(input.file, (entry) => stringValue(entry, ['file'], {
    max: 1_000,
    pattern: /^widget:\/\/(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\\)[^\u0000-\u001f\u007f]+$/,
  }));
  const line = optional(input.line, (entry) => integer(entry, ['line'], 1, 10_000_000));
  const column = optional(input.column, (entry) => integer(entry, ['column'], 1, 10_000_000));
  if ((line !== undefined || column !== undefined) && file === undefined) fail(['file'], 'A diagnostic location requires a widget file.');
  if (column !== undefined && line === undefined) fail(['line'], 'A diagnostic column requires a line.');
  const id = (entry: unknown, path: TSdkValidationPath) => stringValue(entry, path, {
    max: 300, pattern: /^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,299}$/,
  });
  return Object.freeze({
    formatVersion: literal(input.formatVersion, 1, ['formatVersion']),
    fingerprint: sha256(input.fingerprint, ['fingerprint']),
    origin: oneOf(input.origin, ['source', 'install', 'build', 'server', 'capsule', 'host', 'guest', 'capability', 'channel', 'budget', 'lifecycle'], ['origin']),
    phase: stringValue(input.phase, ['phase'], { pattern: /^[a-z][a-z0-9-]{0,63}$/ }),
    code: stringValue(input.code, ['code'], { pattern: /^[A-Z][A-Z0-9_]{1,127}$/ }),
    severity: oneOf(input.severity, ['error', 'warning', 'info'], ['severity']),
    message: stringValue(input.message, ['message'], { trim: true, min: 1, max: 2_000, pattern: /^[^\u0000-\u001f\u007f]*$/ }),
    trust: oneOf(input.trust, ['trusted', 'untrusted'], ['trust']),
    draftRevision: sha256(input.draftRevision, ['draftRevision']),
    previewRevisionId: input.previewRevisionId === null ? null : id(input.previewRevisionId, ['previewRevisionId']),
    buildId: id(input.buildId, ['buildId']),
    buildSequence: integer(input.buildSequence, ['buildSequence'], 1, Number.MAX_SAFE_INTEGER),
    occurrenceCount: integer(input.occurrenceCount, ['occurrenceCount'], 1, 1_000_000),
    retryability: oneOf(input.retryability, ['retryable', 'non-retryable', 'unknown'], ['retryability']),
    timestampMs: integer(input.timestampMs, ['timestampMs'], 0, Number.MAX_SAFE_INTEGER),
    ...(file === undefined ? {} : { file }),
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
    ...(input.capability === undefined ? {} : { capability: id(input.capability, ['capability']) }),
    ...(input.operation === undefined ? {} : { operation: id(input.operation, ['operation']) }),
    ...(input.budgetDimension === undefined ? {} : { budgetDimension: id(input.budgetDimension, ['budgetDimension']) }),
    ...(input.causeFingerprint === undefined ? {} : { causeFingerprint: sha256(input.causeFingerprint, ['causeFingerprint']) }),
    ...(input.remediation === undefined ? {} : { remediation: oneOf(input.remediation, ['widget-source', 'generated-binding', 'platform', 'budget'], ['remediation']) }),
  });
}

function decodeRuntimeDescriptor(value: unknown): TWidgetRuntimeDescriptor {
  const input = record(value, []);
  onlyKeys(input, ['format', 'artifactHash', 'apiContract', 'budgets', 'capabilityRequests', 'channels', 'parkability', 'signatureKeyIds'], []);
  const apiContract = record(input.apiContract, ['apiContract']);
  onlyKeys(apiContract, ['format', 'groups', 'bundleDigest'], ['apiContract']);
  if (!Array.isArray(input.capabilityRequests) || input.capabilityRequests.length > 256) fail(['capabilityRequests'], 'Capability requests must be a bounded array.', 'invalid_type');
  const ids = new Set<string>();
  const capabilityRequests = input.capabilityRequests.map((entry, index) => {
    const request = capabilityRequest(entry, ['capabilityRequests', index]);
    if (ids.has(request.id)) fail(['capabilityRequests', index, 'id'], 'Duplicate capability request.', 'duplicate');
    ids.add(request.id);
    return request;
  });
  if (!Array.isArray(input.signatureKeyIds) || input.signatureKeyIds.length < 1 || input.signatureKeyIds.length > 32) {
    fail(['signatureKeyIds'], 'Signature key IDs must be a non-empty bounded array.', 'invalid_type');
  }
  const keyIds = input.signatureKeyIds.map((entry, index) => stringValue(entry, ['signatureKeyIds', index], { min: 1, max: 200, pattern: IDENTIFIER_PATTERN }));
  if (new Set(keyIds).size !== keyIds.length) fail(['signatureKeyIds'], 'Signature key IDs must be unique.', 'duplicate');
  const parkability = record(input.parkability, ['parkability']);
  onlyKeys(parkability, ['parkable'], ['parkability']);
  return fnNormalizeWidgetRuntimeDescriptor({
    format: literal(input.format, 'omnidraw.capsule-runtime.v2', ['format']),
    artifactHash: capsuleHash(input.artifactHash, ['artifactHash']),
    apiContract: Object.freeze({
      format: literal(apiContract.format, 'capsule-api-groups-v1', ['apiContract', 'format']),
      groups: capsuleApis(apiContract.groups, ['apiContract', 'groups']),
      bundleDigest: capsuleHash(apiContract.bundleDigest, ['apiContract', 'bundleDigest']),
    }),
    budgets: budgets(input.budgets, ['budgets']),
    capabilityRequests: Object.freeze(capabilityRequests),
    channels: channelContract(input.channels, ['channels']),
    parkability: Object.freeze({ parkable: literal(parkability.parkable, false, ['parkability', 'parkable']) }),
    signatureKeyIds: Object.freeze(keyIds),
  });
}

function releaseFile(value: unknown, path: TSdkValidationPath): Readonly<{ path: string; byteSize: number; sha256: string }> {
  const input = record(value, path);
  onlyKeys(input, ['path', 'byteSize', 'sha256'], path);
  const filePath = stringValue(input.path, [...path, 'path'], { min: 1, max: 1_024 });
  const normalized = fnNormalizeWidgetFilesystemRelativePath(filePath);
  if (normalized === null || !(normalized === 'capsule.artifact' || normalized === 'functions.json' || normalized.startsWith('dist/') || normalized.startsWith('server-dist/'))) {
    fail([...path, 'path'], 'Expected a managed published runtime path.');
  }
  return Object.freeze({
    path: normalized,
    byteSize: integer(input.byteSize, [...path, 'byteSize'], 0, WIDGET_RELEASE_FILE_MAX_BYTES),
    sha256: sha256(input.sha256, [...path, 'sha256']),
  });
}

function unsignedRelease(value: unknown, includeAttestation: boolean): TWidgetUnsignedReleaseDescriptor | TWidgetReleaseDescriptor {
  const input = record(value, []);
  onlyKeys(input, includeAttestation
    ? ['format', 'complete', 'executableManifestDigestSha256', 'files', 'capsule', 'server', 'releaseAttestation']
    : ['format', 'complete', 'executableManifestDigestSha256', 'files', 'capsule', 'server'], []);
  if (!Array.isArray(input.files) || input.files.length < 2 || input.files.length > WIDGET_RELEASE_FILE_COUNT_MAX) fail(['files'], 'Release files must be a bounded array.', 'invalid_type');
  const files = input.files.map((entry, index) => releaseFile(entry, ['files', index]));
  const capsule = record(input.capsule, ['capsule']);
  onlyKeys(capsule, ['path', 'artifactHash', 'runtime'], ['capsule']);
  const serverInput = input.server === null ? null : record(input.server, ['server']);
  if (serverInput !== null) onlyKeys(serverInput, ['entry', 'runtimeAbi', 'functionsPath', 'serverDistDigestSha256', 'functionsDigestSha256'], ['server']);
  const base: TWidgetUnsignedReleaseDescriptor = {
    format: literal(input.format, WIDGET_RELEASE_FORMAT, ['format']),
    complete: literal(input.complete, true, ['complete']),
    executableManifestDigestSha256: sha256(input.executableManifestDigestSha256, ['executableManifestDigestSha256']),
    files: Object.freeze(files),
    capsule: Object.freeze({
      path: literal(capsule.path, 'capsule.artifact', ['capsule', 'path']),
      artifactHash: capsuleHash(capsule.artifactHash, ['capsule', 'artifactHash']),
      runtime: decodeRuntimeDescriptor(capsule.runtime),
    }),
    server: serverInput === null ? null : Object.freeze({
      entry: (() => {
        const entry = stringValue(serverInput.entry, ['server', 'entry'], { min: 1, max: 1_024 });
        if (!entry.startsWith('server-dist/') || fnNormalizeWidgetFilesystemRelativePath(entry) !== entry) fail(['server', 'entry'], 'Invalid server release entry.');
        return entry;
      })(),
      runtimeAbi: stringValue(serverInput.runtimeAbi, ['server', 'runtimeAbi'], { min: 1, max: 100, pattern: IDENTIFIER_PATTERN }),
      functionsPath: literal(serverInput.functionsPath, 'functions.json', ['server', 'functionsPath']),
      serverDistDigestSha256: sha256(serverInput.serverDistDigestSha256, ['server', 'serverDistDigestSha256']),
      functionsDigestSha256: sha256(serverInput.functionsDigestSha256, ['server', 'functionsDigestSha256']),
    }),
  };
  if (!includeAttestation) return Object.freeze(base);
  const attestation = record(input.releaseAttestation, ['releaseAttestation']);
  onlyKeys(attestation, ['algorithm', 'keyId', 'signatureBase64'], ['releaseAttestation']);
  return Object.freeze({
    ...base,
    releaseAttestation: Object.freeze({
      algorithm: literal(attestation.algorithm, 'Ed25519', ['releaseAttestation', 'algorithm']),
      keyId: stringValue(attestation.keyId, ['releaseAttestation', 'keyId'], { min: 1, max: 170, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ }),
      signatureBase64: stringValue(attestation.signatureBase64, ['releaseAttestation', 'signatureBase64'], { min: 88, max: 88, pattern: /^[A-Za-z0-9+/]{86}==$/ }),
    }),
  });
}

function decodeReceipt(value: unknown): TWidgetBuildReceipt {
  const input = record(value, []);
  onlyKeys(input, ['format', 'schemaVersion', 'sourceDigestSha256', 'manifestDigestSha256', 'executableInputDigestSha256', 'sdkVersion', 'buildIdentity', 'outputs'], []);
  if (!Array.isArray(input.outputs) || input.outputs.length < 1 || input.outputs.length > WIDGET_BUILD_RECEIPT_OUTPUT_COUNT_MAX) fail(['outputs'], 'Build receipt outputs must be a non-empty bounded array.', 'invalid_type');
  let totalBytes = 0;
  const paths = new Set<string>();
  const outputs = input.outputs.map((entry, index) => {
    const output = record(entry, ['outputs', index]);
    onlyKeys(output, ['path', 'byteSize', 'sha256'], ['outputs', index]);
    const path = stringValue(output.path, ['outputs', index, 'path'], { min: 1, max: 1_024 });
    const normalized = fnNormalizeWidgetFilesystemRelativePath(path);
    if (normalized === null || normalized !== path || !path.startsWith('dist/') || path === WIDGET_BUILD_RECEIPT_PATH) fail(['outputs', index, 'path'], 'Expected a safe generated dist output path.');
    const key = path.toLowerCase();
    if (paths.has(key)) fail(['outputs', index, 'path'], 'Duplicate build output path.', 'duplicate');
    paths.add(key);
    const byteSize = integer(output.byteSize, ['outputs', index, 'byteSize'], 0, WIDGET_BUILD_FILE_MAX_BYTES);
    totalBytes += byteSize;
    if (totalBytes > WIDGET_BUILD_TOTAL_BYTES_MAX) fail(['outputs'], 'Build receipt output bytes exceed the limit.', 'limit');
    return Object.freeze({ path, byteSize, sha256: sha256(output.sha256, ['outputs', index, 'sha256']) });
  });
  return Object.freeze({
    format: literal(input.format, WIDGET_BUILD_RECEIPT_FORMAT, ['format']),
    schemaVersion: literal(input.schemaVersion, 1, ['schemaVersion']),
    sourceDigestSha256: sha256(input.sourceDigestSha256, ['sourceDigestSha256']),
    manifestDigestSha256: sha256(input.manifestDigestSha256, ['manifestDigestSha256']),
    executableInputDigestSha256: sha256(input.executableInputDigestSha256, ['executableInputDigestSha256']),
    sdkVersion: stringValue(input.sdkVersion, ['sdkVersion'], { min: 5, max: 100, pattern: SDK_VERSION_PATTERN }),
    buildIdentity: sha256(input.buildIdentity, ['buildIdentity']),
    outputs: Object.freeze(outputs),
  });
}

export const WidgetManifestValidator = validator<TWidgetManifestV1>(decodeManifest);
export const WidgetExecutableManifestValidator = validator<TWidgetExecutableManifestProjection>(decodeExecutableManifest);
export const WidgetBuildReceiptValidator = validator<TWidgetBuildReceipt>(decodeReceipt);
export const WidgetRuntimeDescriptorValidator = validator<TWidgetRuntimeDescriptor>(decodeRuntimeDescriptor);
export const WidgetServerFunctionDescriptorValidator = validator<TWidgetServerFunctionDescriptor>((value) => functionDescriptor(value, [], false));
export const WidgetBrowserFunctionDescriptorValidator = validator<TWidgetBrowserFunctionDescriptor>((value) => functionDescriptor(value, [], true) as TWidgetBrowserFunctionDescriptor);
export const WidgetServerFunctionDescriptorsValidator = validator<readonly TWidgetServerFunctionDescriptor[]>((value) => descriptorArray(value, false));
export const WidgetBrowserFunctionDescriptorsValidator = validator<readonly TWidgetBrowserFunctionDescriptor[]>((value) => descriptorArray(value, true) as readonly TWidgetBrowserFunctionDescriptor[]);
export const WidgetReleaseDescriptorValidator = validator<TWidgetReleaseDescriptor>((value) => unsignedRelease(value, true) as TWidgetReleaseDescriptor);
export const WidgetUnsignedReleaseDescriptorValidator = validator<TWidgetUnsignedReleaseDescriptor>((value) => unsignedRelease(value, false));
export const WidgetResourceRequirementValidator = validator<TWidgetResourceRequirement>((value) => resourceRequirement(value, [], false));
export const WidgetExecutableResourceRequirementValidator = validator<Omit<TWidgetResourceRequirement, 'resourceId'>>((value) => {
  const { resourceId: _resourceId, ...requirement } = resourceRequirement(value, [], true);
  return Object.freeze(requirement);
});
export const WidgetRuntimeApisValidator = validator<readonly TWidgetRuntimeApiGroup[]>((value) => capsuleApis(value, []));
export const WidgetRuntimeAllowedApisValidator = validator<readonly TWidgetRuntimeApiGroup[]>((value) => allowedCapsuleApis(value, []));
export const WidgetRuntimeBudgetRequestValidator = validator<TWidgetRuntimeBudgetRequest>((value) => budgets(value, []));
export const WidgetRuntimeBudgetsValidator = validator<TWidgetRuntimeBudgets>((value) => completeBudgets(value, []));
export const WidgetSchemaReferenceValidator = validator<TWidgetSchemaReference>((value) => schemaReference(value, []));
export const WidgetCapabilityRequestValidator = validator<TWidgetCapabilityRequest>((value) => capabilityRequest(value, []));
export const WidgetChannelContractValidator = validator<TWidgetChannelContract>((value) => {
  const result = channelContract(value, []);
  if (result === null) return fail([], 'Expected a widget channel contract.');
  return result;
});
export const WidgetParkabilityValidator = validator<TWidgetParkability>((value) => parkability(value, []));
export const WidgetResourceIdValidator = validator<string>((value) => resourceId(value, []));
export const OmnidrawToolIconValidator = validator<TOmnidrawToolIcon>((value) => icon(value, []));
export const WidgetDiagnosticValidator = validator<TWidgetDiagnostic>(diagnostic);

/** Source-compatible aliases whose values and types are SDK-owned, not Zod-owned. */
export const ZWidgetManifestV1 = WidgetManifestValidator;
export const ZWidgetExecutableManifest = WidgetExecutableManifestValidator;
export const ZWidgetBuildReceipt = WidgetBuildReceiptValidator;
export const ZWidgetRuntimeDescriptor = WidgetRuntimeDescriptorValidator;
export const ZWidgetServerFunctionDescriptor = WidgetServerFunctionDescriptorValidator;
export const ZWidgetBrowserFunctionDescriptor = WidgetBrowserFunctionDescriptorValidator;
export const ZWidgetServerFunctionDescriptors = WidgetServerFunctionDescriptorsValidator;
export const ZWidgetBrowserFunctionDescriptors = WidgetBrowserFunctionDescriptorsValidator;
export const ZWidgetReleaseDescriptor = WidgetReleaseDescriptorValidator;
export const ZWidgetUnsignedReleaseDescriptor = WidgetUnsignedReleaseDescriptorValidator;
export const ZWidgetResourceRequirement = WidgetResourceRequirementValidator;
export const ZWidgetExecutableResourceRequirement = WidgetExecutableResourceRequirementValidator;
export const ZWidgetRuntimeAllowedApis = WidgetRuntimeAllowedApisValidator;
export const ZWidgetRuntimeApis = WidgetRuntimeApisValidator;
export const ZWidgetRuntimeBudgetRequest = WidgetRuntimeBudgetRequestValidator;
export const ZWidgetRuntimeBudgets = WidgetRuntimeBudgetsValidator;
export const ZWidgetSchemaReference = WidgetSchemaReferenceValidator;
export const ZWidgetCapabilityRequest = WidgetCapabilityRequestValidator;
export const ZWidgetChannelContract = WidgetChannelContractValidator;
export const ZWidgetParkability = WidgetParkabilityValidator;
export const ZWidgetResourceId = WidgetResourceIdValidator;
export const ZOmnidrawToolIcon = OmnidrawToolIconValidator;
export const ZWidgetDiagnostic = WidgetDiagnosticValidator;
export const WIDGET_DIAGNOSTIC_FORMAT_VERSION = 1 as const;

export function parseWidgetManifestV1Json(value: string): TWidgetManifestV1 {
  if (fnUtf8ByteLength(value) > 128 * 1_024) fail([], 'omnidraw.json exceeds the 128 KiB manifest limit.', 'limit');
  return WidgetManifestValidator.parse(JSON.parse(value));
}

export function parseWidgetReleaseJson(value: string): TWidgetReleaseDescriptor {
  if (fnUtf8ByteLength(value) > 2 * 1_024 * 1_024) fail([], 'release.json exceeds the 2 MiB descriptor limit.', 'limit');
  return WidgetReleaseDescriptorValidator.parse(JSON.parse(value));
}

export function parseWidgetBuildReceiptJson(value: string): TWidgetBuildReceipt {
  if (fnUtf8ByteLength(value) > WIDGET_BUILD_RECEIPT_MAX_BYTES) fail([], 'omnidraw.build.json exceeds the 2 MiB receipt limit.', 'limit');
  return WidgetBuildReceiptValidator.parse(JSON.parse(value));
}
