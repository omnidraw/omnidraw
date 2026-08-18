/**
 * Deterministic, framework-neutral vectors for SDK host implementations.
 * These fixtures contain no executor and grant no authority.
 */

import {
  PORTABLE_RESOURCE_DB_EXECUTE_FORMAT,
  PORTABLE_RESOURCE_DB_ROWS_FORMAT,
  PORTABLE_RESOURCE_REQUEST_FORMAT,
  PORTABLE_RESOURCE_RESULT_FORMAT,
} from './contracts/core/fn.resource-wire';
import {
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnNormalizeWidgetServerFunctionDescriptors,
} from './contracts/core/fn.function-descriptor';
import type {
  TPortableResourceSqlClassification,
  TPortableResourceSqlEffect,
} from './contracts/core/fn.portable-resource-sql';
import type {
  TWidgetServerModuleArtifactValidation,
  TWidgetServerModulePolicyAdmission,
  TWidgetServerModulePolicyPhase,
} from './contracts/core/fn.server-module';
import {
  WIDGET_SERVER_MODULE_ABI,
  WIDGET_SERVER_MODULE_FORMAT,
  WIDGET_MANIFEST_V1_SCHEMA_URL,
} from './contracts/CONSTANTS';
import {
  fnCanonicalizeWidgetExecutableProjection,
  fnCanonicalizeWidgetManifestV1,
  fnProjectWidgetExecutableManifest,
} from './contracts/core/fn.filesystem-manifest';
import type {
  TWidgetManifestV1,
} from './contracts/filesystem/typed';
import type {
  TWidgetNotificationOutput,
  TWidgetFunctionInvocation,
  TWidgetLifecycleEvent,
  TWidgetServerFunctionDescriptor,
  TWidgetServerModuleArtifact,
  TWidgetResourceCall,
} from './contracts/types';
import type {
  TPortableResourceDbRowsWire,
  TPortableResourceRequestWire,
  TPortableResourceResponseWire,
  TPortableResourceWireErrorCode,
  TPortableResourceWireValue,
} from './contracts/core/fn.resource-wire';

export const WIDGET_SDK_CONFORMANCE_FIXTURE = Object.freeze({
  manifest: Object.freeze({
    $schema: WIDGET_MANIFEST_V1_SCHEMA_URL,
    schemaVersion: 1,
    name: 'Portable Counter',
    slug: 'portable-counter',
    description: 'Minimal framework-neutral SDK conformance widget.',
    tool: Object.freeze({
      label: 'Portable Counter',
      group: null,
      priority: 0,
    }),
    ui: Object.freeze({
      runtime: 'capsule',
      entry: 'ui/main.ts',
      apis: Object.freeze(['DOM'] as const),
      state: Object.freeze({ localStore: 'ephemeral' }),
    }),
    resources: Object.freeze([
      Object.freeze({
        slot: 'counter',
        kind: 'kv',
        effect: 'read_write',
        required: true,
      }),
      Object.freeze({
        slot: 'portableKv',
        kind: 'kv',
        effect: 'read_write',
        required: true,
      }),
      Object.freeze({
        slot: 'portableSecrets',
        kind: 'secretStore',
        effect: 'read_write',
        required: true,
      }),
      Object.freeze({
        slot: 'portableDb',
        kind: 'db',
        effect: 'read_write',
        required: true,
        arbitrarySql: true,
        operations: Object.freeze({
          readTyped: Object.freeze({
            effect: 'read',
            sql: 'SELECT big_value, blob_value, nullable_value, json_value FROM portability_values WHERE id = :id',
            parameters: Object.freeze({
              id: Object.freeze({ type: 'bigint' }),
            }),
            result: 'rows',
            jsonColumns: Object.freeze(['json_value']),
          }),
          echoJson: Object.freeze({
            effect: 'read',
            sql: 'SELECT :value AS json_value',
            parameters: Object.freeze({
              value: Object.freeze({ type: 'json' }),
            }),
            result: 'rows',
            jsonColumns: Object.freeze(['json_value']),
          }),
        }),
      }),
    ]),
  }) satisfies TWidgetManifestV1,
  files: Object.freeze([Object.freeze({
    path: 'ui/main.ts',
    text: [
      "import { emitWidgetOutput, getWidgetLocalState, setWidgetLocalState } from '@omnidraw/sdk/guest';",
      "const count = Number(getWidgetLocalState('count') ?? 0) + 1;",
      "setWidgetLocalState('count', count);",
      "emitWidgetOutput({ type: 'notification', tone: 'info', message: String(count) });",
      '',
    ].join('\n'),
  })]),
});

export const WIDGET_SDK_CONFORMANCE_TRANSCRIPT = Object.freeze({
  lifecycle: Object.freeze([
    Object.freeze({ state: 'active', generation: 1 }),
    Object.freeze({ state: 'frozen', generation: 1 }),
    Object.freeze({ state: 'active', generation: 2 }),
  ]) satisfies readonly TWidgetLifecycleEvent[],
  functionInvocation: Object.freeze({
    invocationId: 'invocation-1',
    subject: Object.freeze({
      canvasId: 'canvas-1',
      elementId: 'element-1',
      widgetInstanceId: 'widget-instance-1',
      widgetKey: 'portable-counter',
    }),
    functionName: 'increment',
    input: Object.freeze({ amount: 1 }),
    signal: undefined,
  }) satisfies TWidgetFunctionInvocation,
  resourceCall: Object.freeze({
    subject: Object.freeze({
      canvasId: 'canvas-1',
      elementId: 'element-1',
      widgetInstanceId: 'widget-instance-1',
      widgetKey: 'portable-counter',
    }),
    slot: 'counter',
    operation: 'set',
    effect: 'write',
    input: Object.freeze({ value: 1 }),
  }) satisfies TWidgetResourceCall,
  output: Object.freeze({
    type: 'notification',
    tone: 'info',
    message: '1',
  }) satisfies TWidgetNotificationOutput,
});

export type TWidgetSdkConformanceVector = Readonly<{
  name: string;
  input: unknown;
  expected: unknown;
}>;

const manifest = WIDGET_SDK_CONFORMANCE_FIXTURE.manifest;
export const WIDGET_SDK_CONFORMANCE_VECTORS: readonly TWidgetSdkConformanceVector[] = Object.freeze([
  Object.freeze({
    name: 'canonical-manifest',
    input: manifest,
    expected: fnCanonicalizeWidgetManifestV1(manifest),
  }),
  Object.freeze({
    name: 'canonical-executable-manifest',
    input: fnProjectWidgetExecutableManifest(manifest),
    expected: fnCanonicalizeWidgetExecutableProjection(
      fnProjectWidgetExecutableManifest(manifest),
    ),
  }),
  Object.freeze({
    name: 'guest-visible-transcript',
    input: null,
    expected: WIDGET_SDK_CONFORMANCE_TRANSCRIPT,
  }),
]);

const SERVER_FUNCTION_LIMITS = Object.freeze({
  timeoutMs: 1_000,
  memoryTier: 'small' as const,
  outputByteLimit: 1_024,
  logByteLimit: 1_024,
});

const NUMBER_INPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({ amount: Object.freeze({ type: 'number' }) }),
  required: Object.freeze(['amount']),
  additionalProperties: false,
});

const NUMBER_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({ value: Object.freeze({ type: 'number' }) }),
  required: Object.freeze(['value']),
  additionalProperties: false,
});

const KEY_INPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({ key: Object.freeze({ type: 'string' }) }),
  required: Object.freeze(['key']),
  additionalProperties: false,
});

const READ_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    value: Object.freeze({
      anyOf: Object.freeze([
        Object.freeze({ type: 'number' }),
        Object.freeze({ type: 'null' }),
      ]),
    }),
  }),
  required: Object.freeze(['value']),
  additionalProperties: false,
});

const WRITE_INPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    key: Object.freeze({ type: 'string' }),
    value: Object.freeze({ type: 'number' }),
  }),
  required: Object.freeze(['key', 'value']),
  additionalProperties: false,
});

const EMPTY_INPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({}),
  additionalProperties: false,
});

const CODE_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({ code: Object.freeze({ type: 'string' }) }),
  required: Object.freeze(['code']),
  additionalProperties: false,
});

const TEXT_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({ value: Object.freeze({ type: 'string' }) }),
  required: Object.freeze(['value']),
  additionalProperties: false,
});

const RESOURCE_PROBE_INPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    slot: Object.freeze({ type: 'string' }),
    operation: Object.freeze({ type: 'string' }),
    effect: Object.freeze({ type: 'string', enum: Object.freeze(['read', 'write']) }),
    input: Object.freeze({}),
  }),
  required: Object.freeze(['slot', 'operation', 'effect', 'input']),
  additionalProperties: false,
});

const RESOURCE_PROBE_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    status: Object.freeze({ type: 'string', enum: Object.freeze(['succeeded', 'failed']) }),
    value: Object.freeze({}),
  }),
  required: Object.freeze(['status', 'value']),
  additionalProperties: false,
});

/** Path-free registrations extracted from the same closed module on every host. */
const RAW_SERVER_FUNCTION_DESCRIPTORS = Object.freeze([
  Object.freeze({
    schemaVersion: 1,
    exportName: 'increment',
    effect: 'fn',
    inputSchema: NUMBER_INPUT_SCHEMA,
    outputSchema: NUMBER_OUTPUT_SCHEMA,
    resources: Object.freeze([]),
    limits: SERVER_FUNCTION_LIMITS,
  }),
  Object.freeze({
    schemaVersion: 1,
    exportName: 'readCounter',
    effect: 'fx',
    inputSchema: KEY_INPUT_SCHEMA,
    outputSchema: READ_OUTPUT_SCHEMA,
    resources: Object.freeze([
      Object.freeze({ slot: 'counter', effect: 'read' as const }),
    ]),
    limits: SERVER_FUNCTION_LIMITS,
  }),
  Object.freeze({
    schemaVersion: 1,
    exportName: 'writeCounter',
    effect: 'tx',
    inputSchema: WRITE_INPUT_SCHEMA,
    outputSchema: NUMBER_OUTPUT_SCHEMA,
    resources: Object.freeze([
      Object.freeze({ slot: 'counter', effect: 'read_write' as const }),
    ]),
    limits: SERVER_FUNCTION_LIMITS,
  }),
  Object.freeze({
    schemaVersion: 1,
    exportName: 'resourceProbe',
    effect: 'tx',
    inputSchema: RESOURCE_PROBE_INPUT_SCHEMA,
    outputSchema: RESOURCE_PROBE_OUTPUT_SCHEMA,
    resources: Object.freeze([
      Object.freeze({ slot: 'portableDb', effect: 'read_write' as const }),
      Object.freeze({ slot: 'portableKv', effect: 'read_write' as const }),
      Object.freeze({ slot: 'portableSecrets', effect: 'read_write' as const }),
    ]),
    limits: SERVER_FUNCTION_LIMITS,
  }),
  ...Object.freeze([
    ['undeclaredSlot', 'fx', CODE_OUTPUT_SCHEMA, [{ slot: 'counter', effect: 'read' }], SERVER_FUNCTION_LIMITS],
    ['effectEscalation', 'fx', CODE_OUTPUT_SCHEMA, [{ slot: 'counter', effect: 'read' }], SERVER_FUNCTION_LIMITS],
    ['handlerFailure', 'fn', NUMBER_OUTPUT_SCHEMA, [], SERVER_FUNCTION_LIMITS],
    ['timeoutFunction', 'fn', NUMBER_OUTPUT_SCHEMA, [], { ...SERVER_FUNCTION_LIMITS, timeoutMs: 40 }],
    ['cancelFunction', 'fn', NUMBER_OUTPUT_SCHEMA, [], SERVER_FUNCTION_LIMITS],
    ['invalidOutput', 'fn', NUMBER_OUTPUT_SCHEMA, [], SERVER_FUNCTION_LIMITS],
    ['outputLimit', 'fn', TEXT_OUTPUT_SCHEMA, [], { ...SERVER_FUNCTION_LIMITS, outputByteLimit: 64 }],
    ['logSuccess', 'fn', NUMBER_OUTPUT_SCHEMA, [], SERVER_FUNCTION_LIMITS],
    ['logLimit', 'fn', NUMBER_OUTPUT_SCHEMA, [], { ...SERVER_FUNCTION_LIMITS, logByteLimit: 32 }],
    ['resourceCallLimit', 'fx', CODE_OUTPUT_SCHEMA, [{ slot: 'counter', effect: 'read' }], SERVER_FUNCTION_LIMITS],
    ['ambiguousWrite', 'tx', CODE_OUTPUT_SCHEMA, [{ slot: 'counter', effect: 'read_write' }], SERVER_FUNCTION_LIMITS],
    ['runtimeDynamicCode', 'fn', CODE_OUTPUT_SCHEMA, [], SERVER_FUNCTION_LIMITS],
  ] as const).map(([exportName, effect, outputSchema, resources, limits]) => Object.freeze({
    schemaVersion: 1 as const,
    exportName,
    effect,
    inputSchema: EMPTY_INPUT_SCHEMA,
    outputSchema,
    resources: Object.freeze(resources.map((resource) => Object.freeze(resource))),
    limits: Object.freeze(limits),
  })),
] as const satisfies readonly TWidgetServerFunctionDescriptor[]);

export const WIDGET_SDK_SERVER_FUNCTION_DESCRIPTORS = Object.freeze(
  fnNormalizeWidgetServerFunctionDescriptors(RAW_SERVER_FUNCTION_DESCRIPTORS),
);

function registrationJson(descriptor: TWidgetServerFunctionDescriptor): string {
  const { exportName: _exportName, ...registration } = descriptor;
  return JSON.stringify(registration);
}

function registrationJsonFor(exportName: string): string {
  const descriptor = WIDGET_SDK_SERVER_FUNCTION_DESCRIPTORS.find(
    (candidate) => candidate.exportName === exportName,
  );
  if (descriptor === undefined) throw new Error(`Missing conformance descriptor '${exportName}'.`);
  return registrationJson(descriptor);
}

/** Minimal framework-free closed ES module used by every function adapter gate. */
export const WIDGET_SDK_SERVER_MODULE_SOURCE = [
  'const define = (registration, execute) => Object.freeze({',
  '  __omnidrawServerFunction: "omnidraw.server-function.v1",',
  '  __omnidrawRegistration: Object.freeze(registration),',
  '  __omnidrawExecute: execute,',
  '});',
  'const decodeProbeValue = (node) => {',
  '  if (node.type === "null") return null;',
  '  if (node.type === "boolean" || node.type === "number" || node.type === "string") return node.value;',
  '  if (node.type === "bigint") return BigInt(node.value);',
  '  if (node.type === "bytes") return Uint8Array.from(node.items);',
  '  if (node.type === "array") return node.items.map(decodeProbeValue);',
  '  return Object.fromEntries(node.entries.map(([key, value]) => [key, decodeProbeValue(value)]));',
  '};',
  'const encodeProbeValue = (value) => {',
  '  if (value === null) return { type: "null" };',
  '  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") return { type: typeof value, value };',
  '  if (typeof value === "bigint") return { type: "bigint", value: value.toString() };',
  '  if (Object.prototype.toString.call(value) === "[object Uint8Array]") return { type: "bytes", items: Array.from(value) };',
  '  if (Array.isArray(value)) return { type: "array", items: value.map(encodeProbeValue) };',
  '  return { type: "object", entries: Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => [key, encodeProbeValue(item)]) };',
  '};',
  `export const increment = define(${registrationJsonFor('increment')}, async (_context, input) => ({ value: input.amount + 1 }));`,
  `export const readCounter = define(${registrationJsonFor('readCounter')}, async (context, input) => {`,
  '  const entry = await context.resources.read("counter", "get", { key: input.key });',
  '  return { value: entry === null ? null : entry.value };',
  '});',
  `export const writeCounter = define(${registrationJsonFor('writeCounter')}, async (context, input) => {`,
  '  const entry = await context.resources.write("counter", "set", { key: input.key, value: input.value });',
  '  return { value: entry.value };',
  '});',
  `export const resourceProbe = define(${registrationJsonFor('resourceProbe')}, async (context, input) => {`,
  '  try {',
  '    const decoded = decodeProbeValue(input.input);',
  '    const value = input.effect === "read"',
  '      ? await context.resources.read(input.slot, input.operation, decoded)',
  '      : await context.resources.write(input.slot, input.operation, decoded);',
  '    return { status: "succeeded", value: encodeProbeValue(value) };',
  '  } catch (error) {',
  '    return { status: "failed", value: encodeProbeValue(String(error.code)) };',
  '  }',
  '});',
  `export const undeclaredSlot = define(${registrationJsonFor('undeclaredSlot')}, async (context) => {`,
  '  try { await context.resources.read("undeclared", "get", { key: "count" }); }',
  '  catch (error) { return { code: String(error.code) }; }',
  '  return { code: "MISSING_FAILURE" };',
  '});',
  `export const runtimeDynamicCode = define(${registrationJsonFor('runtimeDynamicCode')}, async () => {`,
  '  const key = ["con", "structor"].join("");',
  '  try { Math.sin[key]("return 1")(); }',
  '  catch { return { code: "DYNAMIC_CODE_BLOCKED" }; }',
  '  return { code: "MISSING_FAILURE" };',
  '});',
  `export const effectEscalation = define(${registrationJsonFor('effectEscalation')}, async (context) => {`,
  '  try { await context.resources.write("counter", "set", { key: "count", value: 1 }); }',
  '  catch (error) { return { code: String(error.code) }; }',
  '  return { code: "MISSING_FAILURE" };',
  '});',
  `export const handlerFailure = define(${registrationJsonFor('handlerFailure')}, async () => { throw new Error("fixture failure"); });`,
  `export const timeoutFunction = define(${registrationJsonFor('timeoutFunction')}, async () => new Promise(() => undefined));`,
  `export const cancelFunction = define(${registrationJsonFor('cancelFunction')}, async () => new Promise(() => undefined));`,
  `export const invalidOutput = define(${registrationJsonFor('invalidOutput')}, async () => ({ value: "wrong" }));`,
  `export const outputLimit = define(${registrationJsonFor('outputLimit')}, async () => ({ value: "x".repeat(256) }));`,
  `export const logSuccess = define(${registrationJsonFor('logSuccess')}, async (context) => { context.log.info({ event: "conformance" }); return { value: 1 }; });`,
  `export const logLimit = define(${registrationJsonFor('logLimit')}, async (context) => { context.log.info({ payload: "x".repeat(128) }); return { value: 1 }; });`,
  `export const resourceCallLimit = define(${registrationJsonFor('resourceCallLimit')}, async (context) => {`,
  '  for (let index = 0; index < 3; index += 1) {',
  '    try { await context.resources.read("counter", "get", { key: "count" }); }',
  '    catch (error) { return { code: String(error.code) }; }',
  '  }',
  '  return { code: "MISSING_FAILURE" };',
  '});',
  `export const ambiguousWrite = define(${registrationJsonFor('ambiguousWrite')}, async (context) => {`,
  '  try { await context.resources.write("counter", "set", { key: "ambiguous", value: 1 }); }',
  '  catch (error) { return { code: String(error.code) }; }',
  '  return { code: "MISSING_FAILURE" };',
  '});',
  '',
].join('\n');

const SERVER_MODULE_BYTES = Object.freeze([
  ...new TextEncoder().encode(WIDGET_SDK_SERVER_MODULE_SOURCE),
]);
const SERVER_FUNCTION_DESCRIPTORS_CANONICAL_JSON =
  fnCanonicalizeWidgetServerFunctionDescriptors(WIDGET_SDK_SERVER_FUNCTION_DESCRIPTORS);
const SERVER_FUNCTION_DESCRIPTORS_BYTES = Object.freeze([
  ...new TextEncoder().encode(SERVER_FUNCTION_DESCRIPTORS_CANONICAL_JSON),
]);
const SERVER_MANIFEST = Object.freeze({
  ...WIDGET_SDK_CONFORMANCE_FIXTURE.manifest,
  server: Object.freeze({ entry: 'server/main.ts' }),
}) satisfies TWidgetManifestV1;
const SERVER_MANIFEST_CANONICAL_JSON = fnCanonicalizeWidgetManifestV1(SERVER_MANIFEST);
const SERVER_MODULE_ARTIFACT_IDENTITY_CANONICAL_JSON = JSON.stringify({
  kind: 'server_module',
  format: WIDGET_SERVER_MODULE_FORMAT,
  abi: WIDGET_SERVER_MODULE_ABI,
  moduleDigestSha256: 'be80f150daf58bf8dd28b905029d011931b8cc209fe9a2bb989905423e2e2892',
  functionDescriptorsDigestSha256:
    '5a3609fd051e15701e0e366501f077cfb7b5ec97ed48ee87dce2ad13dee365c7',
});

/**
 * Canonical module identity. Digests are literals so an adapter cannot derive
 * its expected answer from the implementation it is qualifying.
 */
export const WIDGET_SDK_SERVER_MODULE_VECTOR = Object.freeze({
  format: WIDGET_SERVER_MODULE_FORMAT,
  abi: WIDGET_SERVER_MODULE_ABI,
  moduleSource: WIDGET_SDK_SERVER_MODULE_SOURCE,
  moduleBytes: SERVER_MODULE_BYTES,
  moduleDigestSha256: 'be80f150daf58bf8dd28b905029d011931b8cc209fe9a2bb989905423e2e2892',
  manifest: SERVER_MANIFEST,
  canonicalManifestJson: SERVER_MANIFEST_CANONICAL_JSON,
  functionDescriptors: WIDGET_SDK_SERVER_FUNCTION_DESCRIPTORS,
  functionDescriptorsCanonicalJson: SERVER_FUNCTION_DESCRIPTORS_CANONICAL_JSON,
  functionDescriptorsBytes: SERVER_FUNCTION_DESCRIPTORS_BYTES,
  functionDescriptorsDigestSha256:
    '5a3609fd051e15701e0e366501f077cfb7b5ec97ed48ee87dce2ad13dee365c7',
  artifactIdentityCanonicalJson: SERVER_MODULE_ARTIFACT_IDENTITY_CANONICAL_JSON,
  artifactDigestSha256: 'af8cb0a9089260cf40b01c876c96bc859bdb9e0f3d34dc57449349c6b1293956',
  buildIdentityInputs: Object.freeze({
    format: WIDGET_SERVER_MODULE_FORMAT,
    abi: WIDGET_SERVER_MODULE_ABI,
    moduleDigestSha256:
      'be80f150daf58bf8dd28b905029d011931b8cc209fe9a2bb989905423e2e2892',
    functionDescriptorsDigestSha256:
      '5a3609fd051e15701e0e366501f077cfb7b5ec97ed48ee87dce2ad13dee365c7',
  }),
});

/** Returns fresh bytes so one adapter cannot mutate the next adapter's vector. */
export function fnCreateWidgetSdkConformanceServerModuleArtifact(): TWidgetServerModuleArtifact {
  return Object.freeze({
    kind: 'server_module',
    format: WIDGET_SDK_SERVER_MODULE_VECTOR.format,
    abi: WIDGET_SDK_SERVER_MODULE_VECTOR.abi,
    moduleBytes: Uint8Array.from(WIDGET_SDK_SERVER_MODULE_VECTOR.moduleBytes),
    moduleDigestSha256: WIDGET_SDK_SERVER_MODULE_VECTOR.moduleDigestSha256,
    functionDescriptors: WIDGET_SDK_SERVER_MODULE_VECTOR.functionDescriptors,
    functionDescriptorsDigestSha256:
      WIDGET_SDK_SERVER_MODULE_VECTOR.functionDescriptorsDigestSha256,
  });
}

export type TWidgetSdkArtifactAdmissionVector = Readonly<{
  name: string;
  mutation: 'none' | 'module_bytes' | 'descriptor_digest' | 'contract';
  expected: TWidgetServerModuleArtifactValidation;
}>;

export const WIDGET_SDK_ARTIFACT_ADMISSION_VECTORS = Object.freeze([
  Object.freeze({ name: 'canonical-artifact', mutation: 'none', expected: Object.freeze({ valid: true }) }),
  Object.freeze({ name: 'module-byte-drift', mutation: 'module_bytes', expected: Object.freeze({ valid: false, reason: 'module_digest_mismatch' }) }),
  Object.freeze({ name: 'descriptor-digest-drift', mutation: 'descriptor_digest', expected: Object.freeze({ valid: false, reason: 'function_digest_mismatch' }) }),
  Object.freeze({ name: 'contract-drift', mutation: 'contract', expected: Object.freeze({ valid: false, reason: 'contract_mismatch' }) }),
] as const satisfies readonly TWidgetSdkArtifactAdmissionVector[]);

export function fnCreateWidgetSdkArtifactAdmissionCandidate(
  vector: TWidgetSdkArtifactAdmissionVector,
): TWidgetServerModuleArtifact {
  const artifact = fnCreateWidgetSdkConformanceServerModuleArtifact();
  if (vector.mutation === 'none') return artifact;
  if (vector.mutation === 'module_bytes') {
    artifact.moduleBytes[0] = artifact.moduleBytes[0] === 0 ? 1 : 0;
    return artifact;
  }
  if (vector.mutation === 'descriptor_digest') {
    return Object.freeze({ ...artifact, functionDescriptorsDigestSha256: '0'.repeat(64) });
  }
  return Object.freeze({
    ...artifact,
    abi: 'omnidraw.widget-server-abi.invalid',
  }) as unknown as TWidgetServerModuleArtifact;
}

export type TWidgetSdkModuleAdmissionVector = Readonly<{
  name: string;
  phase: TWidgetServerModulePolicyPhase;
  source: string;
  expected: TWidgetServerModulePolicyAdmission;
}>;

/** Complete stable capability-token inventory for the fixed server profile. */
export const WIDGET_SDK_MODULE_ADMISSION_VECTORS = Object.freeze([
  Object.freeze({
    name: 'authored-sdk-import',
    phase: 'authored_source',
    source: 'import { defineServerFunction } from "@omnidraw/sdk/server"; export { defineServerFunction };',
    expected: Object.freeze({ allowed: true }),
  }),
  Object.freeze({
    name: 'closed-module',
    phase: 'closed_bundle',
    source: WIDGET_SDK_SERVER_MODULE_SOURCE,
    expected: Object.freeze({ allowed: true }),
  }),
  Object.freeze({
    name: 'typescript-erased-types',
    phase: 'authored_source',
    source: 'const f = (value: Readonly<{ x: number }>): Promise<number> => Promise.resolve(value.x); export { f };',
    expected: Object.freeze({ allowed: true }),
  }),
  ...Object.freeze([
    ['adapter-module', 'authored_source', 'import value from "bun:sqlite";', 'adapter_module'],
    ['commonjs-loader', 'authored_source', 'const value = require("portable");', 'commonjs_loader'],
    ['dynamic-code', 'authored_source', 'const value = eval("1");', 'dynamic_code_generation'],
    ['dynamic-code-computed-constructor', 'authored_source', '([]["filter"]["constructor"])("return Date.now()")();', 'dynamic_code_generation'],
    ['dynamic-code-concatenated-constructor', 'authored_source', '([]["filter"]["con" + "structor"])("return Date.now()")();', 'dynamic_code_generation'],
    ['dynamic-code-escaped-constructor', 'authored_source', '([]["filter"]["constr\\u0075ctor"])("return Date.now()")();', 'dynamic_code_generation'],
    ['dynamic-code-escaped-identifier-constructor', 'authored_source', '([]).filter.constr\\u0075ctor("return 1")();', 'dynamic_code_generation'],
    ['dynamic-code-aliased-constructor', 'authored_source', 'const k = "constructor"; ([]).filter[k]("return 1")();', 'dynamic_code_generation'],
    ['dynamic-code-destructured-constructor', 'authored_source', 'const { constructor: C } = []; C("return Date.now()")();', 'dynamic_code_generation'],
    ['dynamic-import', 'authored_source', 'const value = import("portable");', 'dynamic_import'],
    ['environment', 'authored_source', 'const value = process.env.SECRET;', 'environment'],
    ['environment-escaped-process', 'authored_source', 'const value = pr\\u006fcess.env.SECRET;', 'environment'],
    ['filesystem', 'authored_source', 'import value from "fs";', 'filesystem'],
    ['filesystem-comment-obfuscated-import', 'authored_source', 'import/**/{readFile}from"node:fs";', 'filesystem'],
    ['filesystem-escaped-specifier', 'authored_source', 'import value from "node:\\u0066s";', 'filesystem'],
    ['import-attributes', 'authored_source', 'import value from "data.json" with { type: "json" };', 'import_attributes'],
    ['module-loader', 'authored_source', 'const value = import.meta.url;', 'module_loader'],
    ['native-addon', 'authored_source', 'import value from "./binding.node";', 'native_addon'],
    ['network', 'authored_source', 'const value = fetch("https://example.invalid");', 'network'],
    ['os', 'authored_source', 'import value from "os";', 'os'],
    ['process', 'authored_source', 'const value = process.pid;', 'process'],
    ['shared-memory', 'authored_source', 'const value = new SharedArrayBuffer(8);', 'shared_memory'],
    ['socket', 'authored_source', 'const value = new WebSocket("wss://example.invalid");', 'socket'],
    ['socket-module', 'authored_source', 'import value from "net";', 'socket'],
    ['dns-module', 'authored_source', 'import value from "dns";', 'socket'],
    ['static-import', 'closed_bundle', 'import value from "portable";', 'static_import'],
    ['static-import-compact', 'closed_bundle', 'import{x}from"pure";', 'static_import'],
    ['subprocess', 'authored_source', 'import value from "child_process";', 'subprocess'],
    ['timer', 'authored_source', 'setTimeout(() => undefined, 1);', 'timer'],
    ['timer-template-expression', 'authored_source', '`${Date.now()}`;', 'timer'],
    ['webassembly', 'authored_source', 'const value = WebAssembly.Module;', 'webassembly'],
    ['worker-global', 'authored_source', 'const value = navigator.userAgent;', 'worker_adapter_global'],
    ['worker-global-node-buffer', 'authored_source', 'Buffer.from("conformance");', 'worker_adapter_global'],
    ['worker-global-node-global', 'authored_source', 'global["pro" + "cess"]', 'worker_adapter_global'],
    ['worker-global-computed-self', 'authored_source', 'self["fetch"]("https://example.invalid");', 'worker_adapter_global'],
    ['worker-global-closed-fetch', 'closed_bundle', 'globalThis["fet" + "ch"]("https://example.invalid");', 'worker_adapter_global'],
    ['worker-global-closed-crypto', 'closed_bundle', 'globalThis["cr" + "ypto"].randomUUID();', 'worker_adapter_global'],
    ['worker-global-closed-dynamic-property', 'closed_bundle', 'const key = "fetch"; globalThis[key]("https://example.invalid");', 'worker_adapter_global'],
  ] as const).map(([name, phase, source, token]) => Object.freeze({
    name,
    phase,
    source,
    expected: Object.freeze({ allowed: false, phase, token }),
  })),
] as const satisfies readonly TWidgetSdkModuleAdmissionVector[]);

export type TWidgetSdkResourceWireCodecVector =
  | Readonly<{
      name: string;
      operation: 'encode_value';
      input: unknown;
      expected: TPortableResourceWireValue;
    }>
  | Readonly<{
      name: string;
      operation: 'decode_db_rows';
      input: TPortableResourceDbRowsWire;
      expected: Readonly<{
        columns: readonly string[];
        rows: readonly (readonly unknown[])[];
      }>;
    }>
  | Readonly<{
      name: string;
      operation: 'decode_db_rows_error';
      input: TPortableResourceDbRowsWire;
      expectedErrorCode: TPortableResourceWireErrorCode;
    }>
  | Readonly<{
      name: string;
      operation: 'decode_request_error';
      input: unknown;
      expectedErrorCode: TPortableResourceWireErrorCode;
    }>;

/** Canonical tagged values, database cells, and malformed-wire failures. */
export const WIDGET_SDK_RESOURCE_WIRE_VECTORS = Object.freeze([
  Object.freeze({
    name: 'tagged-value',
    operation: 'encode_value',
    input: Object.freeze({
      z: null,
      a: Object.freeze([
        -9_223_372_036_854_775_808n,
        new Uint8Array([0, 1, 254, 255]),
      ]),
    }),
    expected: Object.freeze({
      type: 'object',
      entries: Object.freeze([
        Object.freeze(['a', Object.freeze({
          type: 'array',
          items: Object.freeze([
            Object.freeze({ type: 'bigint', value: '-9223372036854775808' }),
            Object.freeze({ type: 'bytes', base64: 'AAH+/w==' }),
          ]),
        })] as const),
        Object.freeze(['z', Object.freeze({ type: 'null' })] as const),
      ]),
    }),
  }),
  Object.freeze({
    name: 'database-row-codec-all-cell-types',
    operation: 'decode_db_rows',
    input: Object.freeze({
      format: PORTABLE_RESOURCE_DB_ROWS_FORMAT,
      columns: Object.freeze(['integer', 'blob', 'nullable', 'json']),
      rows: Object.freeze([Object.freeze({
        cells: Object.freeze([
          Object.freeze({ type: 'integer', value: '9223372036854775807' }),
          Object.freeze({ type: 'blob', base64: 'AQID' }),
          Object.freeze({ type: 'null' }),
          Object.freeze({
            type: 'json',
            value: Object.freeze({
              type: 'object',
              entries: Object.freeze([
                Object.freeze(['ok', Object.freeze({ type: 'boolean', value: true })] as const),
              ]),
            }),
          }),
        ]),
      })]),
    }),
    expected: Object.freeze({
      columns: Object.freeze(['integer', 'blob', 'nullable', 'json']),
      rows: Object.freeze([Object.freeze([
        9_223_372_036_854_775_807n,
        new Uint8Array([1, 2, 3]),
        null,
        Object.freeze({ ok: true }),
      ])]),
    }),
  }),
  Object.freeze({
    name: 'database-json-cell-bigint-rejected',
    operation: 'decode_db_rows_error',
    input: Object.freeze({
      format: PORTABLE_RESOURCE_DB_ROWS_FORMAT,
      columns: Object.freeze(['json']),
      rows: Object.freeze([Object.freeze({
        cells: Object.freeze([Object.freeze({
          type: 'json',
          value: Object.freeze({ type: 'bigint', value: '1' }),
        })]),
      })]),
    }),
    expectedErrorCode: 'MALFORMED_WIRE',
  }),
  Object.freeze({
    name: 'database-json-cell-bytes-rejected',
    operation: 'decode_db_rows_error',
    input: Object.freeze({
      format: PORTABLE_RESOURCE_DB_ROWS_FORMAT,
      columns: Object.freeze(['json']),
      rows: Object.freeze([Object.freeze({
        cells: Object.freeze([Object.freeze({
          type: 'json',
          value: Object.freeze({ type: 'bytes', base64: 'AQID' }),
        })]),
      })]),
    }),
    expectedErrorCode: 'MALFORMED_WIRE',
  }),
  Object.freeze({
    name: 'database-json-cell-nested-bytes-rejected',
    operation: 'decode_db_rows_error',
    input: Object.freeze({
      format: PORTABLE_RESOURCE_DB_ROWS_FORMAT,
      columns: Object.freeze(['json']),
      rows: Object.freeze([Object.freeze({
        cells: Object.freeze([Object.freeze({
          type: 'json',
          value: Object.freeze({
            type: 'object',
            entries: Object.freeze([Object.freeze(['nested', Object.freeze({
              type: 'array',
              items: Object.freeze([Object.freeze({ type: 'bytes', base64: 'AQID' })]),
            })] as const)]),
          }),
        })]),
      })]),
    }),
    expectedErrorCode: 'MALFORMED_WIRE',
  }),
  Object.freeze({
    name: 'malformed-request',
    operation: 'decode_request_error',
    input: Object.freeze({
      format: PORTABLE_RESOURCE_REQUEST_FORMAT,
      correlationId: 'wire-malformed',
      slot: 'counter',
      operation: 'get',
      effect: 'read',
      input: Object.freeze({ type: 'bigint', value: '01' }),
    }),
    expectedErrorCode: 'MALFORMED_WIRE',
  }),
] as const satisfies readonly TWidgetSdkResourceWireCodecVector[]);

export type TWidgetSdkResourceScenario = Readonly<{
  name: string;
  seed: readonly Readonly<{ key: string; value: unknown }>[];
  request: unknown;
  expected: TPortableResourceResponseWire;
}>;

/** Resource routes compare only the public wire transcript, never provider metadata. */
export const WIDGET_SDK_RESOURCE_SCENARIOS = Object.freeze([
  Object.freeze({
    name: 'kv-get',
    seed: Object.freeze([Object.freeze({ key: 'theme', value: 'dark' })]),
    request: Object.freeze({
      format: PORTABLE_RESOURCE_REQUEST_FORMAT,
      correlationId: 'resource-get',
      slot: 'counter',
      operation: 'get',
      effect: 'read',
      input: Object.freeze({
        type: 'object',
        entries: Object.freeze([
          Object.freeze(['key', Object.freeze({ type: 'string', value: 'theme' })] as const),
        ]),
      }),
    }) satisfies TPortableResourceRequestWire,
    expected: Object.freeze({
      format: PORTABLE_RESOURCE_RESULT_FORMAT,
      correlationId: 'resource-get',
      output: Object.freeze({
        type: 'object',
        entries: Object.freeze([
          Object.freeze(['revision', Object.freeze({ type: 'number', value: 1 })] as const),
          Object.freeze(['value', Object.freeze({ type: 'string', value: 'dark' })] as const),
        ]),
      }),
    }),
  }),
  Object.freeze({
    name: 'malformed-safe-failure',
    seed: Object.freeze([]),
    request: Object.freeze({
      format: PORTABLE_RESOURCE_REQUEST_FORMAT,
      correlationId: 'resource-malformed',
      slot: 'counter',
      operation: 'get',
      effect: 'read',
      input: Object.freeze({ type: 'bigint', value: '01' }),
    }),
    expected: Object.freeze({
      format: 'omnidraw.resource.failure.v1',
      correlationId: 'resource-malformed',
      failure: Object.freeze({
        code: 'RESOURCE_MALFORMED_INPUT',
        message: 'Resource request is malformed.',
      }),
    }),
  }),
] as const satisfies readonly TWidgetSdkResourceScenario[]);

export type TWidgetSdkResourceProviderOutcome =
  | Readonly<{ status: 'succeeded'; output: unknown }>
  | Readonly<{ status: 'failed'; code: string }>;

export type TWidgetSdkResourceProviderStep = Readonly<{
  name: string;
  operation: string;
  effect: 'read' | 'write';
  input: unknown;
  declaredResult?: 'rows' | 'execute';
  jsonColumns?: readonly string[];
  expected: TWidgetSdkResourceProviderOutcome;
}>;

export type TWidgetSdkResourceProviderScenario = Readonly<{
  name: string;
  kind: 'kv' | 'secretStore' | 'db';
  steps: readonly TWidgetSdkResourceProviderStep[];
}>;

const DB_EXECUTE_ZERO = Object.freeze({
  format: PORTABLE_RESOURCE_DB_EXECUTE_FORMAT,
  rowsAffected: 0,
  lastInsertId: null,
});

/** Arbitrary SQLite queries preserve JSON storage as TEXT unless an operation declares JSON columns. */
const DB_SQL_TYPED_ROWS = Object.freeze({
  format: PORTABLE_RESOURCE_DB_ROWS_FORMAT,
  columns: Object.freeze(['big_value', 'blob_value', 'nullable_value', 'json_value']),
  rows: Object.freeze([Object.freeze({
    cells: Object.freeze([
      Object.freeze({ type: 'integer', value: '9223372036854775807' }),
      Object.freeze({ type: 'blob', base64: 'AQL/' }),
      Object.freeze({ type: 'null' }),
      Object.freeze({ type: 'text', value: '{"ok":true}' }),
    ]),
  })]),
});

const DB_NAMED_TYPED_ROWS = Object.freeze({
  format: PORTABLE_RESOURCE_DB_ROWS_FORMAT,
  columns: Object.freeze(['big_value', 'blob_value', 'nullable_value', 'json_value']),
  rows: Object.freeze([Object.freeze({
    cells: Object.freeze([
      Object.freeze({ type: 'integer', value: '9223372036854775807' }),
      Object.freeze({ type: 'blob', base64: 'AQL/' }),
      Object.freeze({ type: 'null' }),
      Object.freeze({
        type: 'json',
        value: Object.freeze({
          type: 'object',
          entries: Object.freeze([
            Object.freeze(['ok', Object.freeze({ type: 'boolean', value: true })] as const),
          ]),
        }),
      }),
    ]),
  })]),
});

const DB_NAMED_JSON_ROWS = Object.freeze({
  format: PORTABLE_RESOURCE_DB_ROWS_FORMAT,
  columns: Object.freeze(['json_value']),
  rows: Object.freeze([Object.freeze({
    cells: Object.freeze([
      Object.freeze({
        type: 'json',
        value: Object.freeze({
          type: 'object',
          entries: Object.freeze([
            Object.freeze(['nested', Object.freeze({
              type: 'object',
              entries: Object.freeze([
                Object.freeze(['ok', Object.freeze({ type: 'boolean', value: true })] as const),
              ]),
            })] as const),
          ]),
        }),
      }),
    ]),
  })]),
});

function namedJsonRows(value: TPortableResourceWireValue): TPortableResourceDbRowsWire {
  return Object.freeze({
    format: PORTABLE_RESOURCE_DB_ROWS_FORMAT,
    columns: Object.freeze(['json_value']),
    rows: Object.freeze([Object.freeze({
      cells: Object.freeze([Object.freeze({ type: 'json' as const, value })]),
    })]),
  });
}

const DB_NAMED_JSON_STRING_ROWS = namedJsonRows(Object.freeze({
  type: 'string',
  value: 'portable',
}));
const DB_NAMED_JSON_NUMBER_ROWS = namedJsonRows(Object.freeze({
  type: 'number',
  value: 42,
}));
const DB_NAMED_JSON_BOOLEAN_ROWS = namedJsonRows(Object.freeze({
  type: 'boolean',
  value: true,
}));
const DB_NAMED_JSON_NULL_ROWS = namedJsonRows(Object.freeze({ type: 'null' }));
const DB_NAMED_JSON_ARRAY_ROWS = namedJsonRows(Object.freeze({
  type: 'array',
  items: Object.freeze([
    Object.freeze({ type: 'string', value: 'portable' }),
    Object.freeze({ type: 'number', value: 42 }),
    Object.freeze({ type: 'boolean', value: true }),
    Object.freeze({ type: 'null' }),
  ]),
}));

const DB_NAMED_NULLABLE_ROWS = Object.freeze({
  format: PORTABLE_RESOURCE_DB_ROWS_FORMAT,
  columns: Object.freeze([
    'string_value',
    'number_value',
    'boolean_value',
    'bigint_value',
    'bytes_value',
    'json_value',
  ]),
  rows: Object.freeze([Object.freeze({
    cells: Object.freeze([
      Object.freeze({ type: 'null' }),
      Object.freeze({ type: 'null' }),
      Object.freeze({ type: 'null' }),
      Object.freeze({ type: 'null' }),
      Object.freeze({ type: 'null' }),
      Object.freeze({
        type: 'json',
        value: Object.freeze({ type: 'null' }),
      }),
    ]),
  })]),
});

const DB_LIMIT_INSERT_SQL = `INSERT INTO limit_values (n) VALUES ${Array.from(
  { length: 1_001 },
  (_, index) => `(${index + 1})`,
).join(',')}`;

/** Complete stable provider transcripts; each scenario runs in one fresh resource. */
export const WIDGET_SDK_RESOURCE_PROVIDER_SCENARIOS = Object.freeze([
  Object.freeze({
    name: 'kv-all-operations-and-conflict',
    kind: 'kv',
    steps: Object.freeze([
      Object.freeze({ name: 'set', operation: 'set', effect: 'write', input: Object.freeze({ key: 'alpha', value: Object.freeze({ count: 1 }) }), expected: Object.freeze({ status: 'succeeded', output: Object.freeze({ value: Object.freeze({ count: 1 }), revision: 1 }) }) }),
      Object.freeze({ name: 'get', operation: 'get', effect: 'read', input: Object.freeze({ key: 'alpha' }), expected: Object.freeze({ status: 'succeeded', output: Object.freeze({ value: Object.freeze({ count: 1 }), revision: 1 }) }) }),
      Object.freeze({ name: 'has', operation: 'has', effect: 'read', input: Object.freeze({ key: 'alpha' }), expected: Object.freeze({ status: 'succeeded', output: true }) }),
      Object.freeze({ name: 'list', operation: 'list', effect: 'read', input: Object.freeze({ prefix: 'a', limit: 10 }), expected: Object.freeze({ status: 'succeeded', output: Object.freeze({ items: Object.freeze([Object.freeze({ key: 'alpha', value: Object.freeze({ count: 1 }), revision: 1 })]) }) }) }),
      Object.freeze({ name: 'compare-and-set-conflict', operation: 'compareAndSet', effect: 'write', input: Object.freeze({ key: 'alpha', expectedRevision: 9, value: Object.freeze({ count: 2 }) }), expected: Object.freeze({ status: 'succeeded', output: Object.freeze({ ok: false, currentRevision: 1 }) }) }),
      Object.freeze({ name: 'compare-and-set', operation: 'compareAndSet', effect: 'write', input: Object.freeze({ key: 'alpha', expectedRevision: 1, value: Object.freeze({ count: 2 }) }), expected: Object.freeze({ status: 'succeeded', output: Object.freeze({ ok: true, entry: Object.freeze({ value: Object.freeze({ count: 2 }), revision: 2 }) }) }) }),
      Object.freeze({ name: 'delete', operation: 'delete', effect: 'write', input: Object.freeze({ key: 'alpha', expectedRevision: 2 }), expected: Object.freeze({ status: 'succeeded', output: Object.freeze({ deleted: true }) }) }),
    ]),
  }),
  Object.freeze({
    name: 'kv-limit',
    kind: 'kv',
    steps: Object.freeze([
      Object.freeze({ name: 'list-limit', operation: 'list', effect: 'read', input: Object.freeze({ limit: 501 }), expected: Object.freeze({ status: 'failed', code: 'RESOURCE_MALFORMED_INPUT' }) }),
    ]),
  }),
  Object.freeze({
    name: 'secret-store-all-operations-and-conflict',
    kind: 'secretStore',
    steps: Object.freeze([
      Object.freeze({ name: 'set', operation: 'set', effect: 'write', input: Object.freeze({ name: 'api-key', value: 'secret-one' }), expected: Object.freeze({ status: 'succeeded', output: Object.freeze({ name: 'api-key', revision: 1 }) }) }),
      Object.freeze({ name: 'get', operation: 'get', effect: 'read', input: Object.freeze({ name: 'api-key' }), expected: Object.freeze({ status: 'succeeded', output: Object.freeze({ value: 'secret-one', revision: 1 }) }) }),
      Object.freeze({ name: 'has', operation: 'has', effect: 'read', input: Object.freeze({ name: 'api-key' }), expected: Object.freeze({ status: 'succeeded', output: true }) }),
      Object.freeze({ name: 'list', operation: 'list', effect: 'read', input: Object.freeze({ prefix: 'api', limit: 10 }), expected: Object.freeze({ status: 'succeeded', output: Object.freeze({ items: Object.freeze([Object.freeze({ name: 'api-key', revision: 1 })]) }) }) }),
      Object.freeze({ name: 'compare-and-set-conflict', operation: 'compareAndSet', effect: 'write', input: Object.freeze({ name: 'api-key', expectedRevision: 9, value: 'secret-two' }), expected: Object.freeze({ status: 'succeeded', output: Object.freeze({ ok: false, currentRevision: 1 }) }) }),
      Object.freeze({ name: 'compare-and-set', operation: 'compareAndSet', effect: 'write', input: Object.freeze({ name: 'api-key', expectedRevision: 1, value: 'secret-two' }), expected: Object.freeze({ status: 'succeeded', output: Object.freeze({ ok: true, entry: Object.freeze({ name: 'api-key', revision: 2 }) }) }) }),
      Object.freeze({ name: 'delete', operation: 'delete', effect: 'write', input: Object.freeze({ name: 'api-key', expectedRevision: 2 }), expected: Object.freeze({ status: 'succeeded', output: Object.freeze({ deleted: true }) }) }),
    ]),
  }),
  Object.freeze({
    name: 'secret-store-limit',
    kind: 'secretStore',
    steps: Object.freeze([
      Object.freeze({ name: 'list-limit', operation: 'list', effect: 'read', input: Object.freeze({ limit: 501 }), expected: Object.freeze({ status: 'failed', code: 'RESOURCE_MALFORMED_INPUT' }) }),
    ]),
  }),
  Object.freeze({
    name: 'db-operations-sql-cells-and-json-parameter',
    kind: 'db',
    steps: Object.freeze([
      Object.freeze({ name: 'single-execute-create', operation: 'execute', effect: 'write', input: Object.freeze({ sql: 'CREATE TABLE portability_values (id INTEGER PRIMARY KEY, big_value INTEGER, blob_value BLOB, nullable_value TEXT, json_value TEXT)' }), expected: Object.freeze({ status: 'succeeded', output: DB_EXECUTE_ZERO }) }),
      Object.freeze({ name: 'single-execute-insert', operation: 'execute', effect: 'write', input: Object.freeze({ sql: 'INSERT INTO portability_values (big_value, blob_value, nullable_value, json_value) VALUES (:big, :blob, :nullable, :json)', parameters: Object.freeze({ big: 9_223_372_036_854_775_807n, blob: new Uint8Array([1, 2, 255]), nullable: null, json: Object.freeze({ ok: true }) }) }), expected: Object.freeze({ status: 'succeeded', output: Object.freeze({ format: PORTABLE_RESOURCE_DB_EXECUTE_FORMAT, rowsAffected: 1, lastInsertId: '1' }) }) }),
      Object.freeze({ name: 'query-bigint-blob-null-and-json-text', operation: 'query', effect: 'read', input: Object.freeze({ sql: 'SELECT big_value, blob_value, nullable_value, json_value FROM portability_values WHERE id = 1' }), expected: Object.freeze({ status: 'succeeded', output: DB_SQL_TYPED_ROWS }) }),
      Object.freeze({ name: 'named-invoke', operation: 'invoke', effect: 'read', declaredResult: 'rows', input: Object.freeze({ operation: 'readTyped', parameters: Object.freeze({ id: 1n }) }), expected: Object.freeze({ status: 'succeeded', output: DB_NAMED_TYPED_ROWS }) }),
      Object.freeze({ name: 'named-json-parameter', operation: 'invoke', effect: 'read', declaredResult: 'rows', input: Object.freeze({ operation: 'echoJson', parameters: Object.freeze({ value: Object.freeze({ nested: Object.freeze({ ok: true }) }) }) }), expected: Object.freeze({ status: 'succeeded', output: DB_NAMED_JSON_ROWS }) }),
      Object.freeze({ name: 'single-execute-update', operation: 'execute', effect: 'write', input: Object.freeze({ sql: 'UPDATE portability_values SET nullable_value = :value WHERE id = 1', parameters: Object.freeze({ value: 'present' }) }), expected: Object.freeze({ status: 'succeeded', output: Object.freeze({ format: PORTABLE_RESOURCE_DB_EXECUTE_FORMAT, rowsAffected: 1, lastInsertId: null }) }) }),
      Object.freeze({ name: 'execute-batch', operation: 'execute', effect: 'write', input: Object.freeze({ operations: Object.freeze([Object.freeze({ sql: 'INSERT INTO portability_values (big_value) VALUES (2)' }), Object.freeze({ sql: 'INSERT INTO portability_values (big_value) VALUES (3)' })]) }), expected: Object.freeze({ status: 'succeeded', output: Object.freeze([Object.freeze({ format: PORTABLE_RESOURCE_DB_EXECUTE_FORMAT, rowsAffected: 1, lastInsertId: '2' }), Object.freeze({ format: PORTABLE_RESOURCE_DB_EXECUTE_FORMAT, rowsAffected: 1, lastInsertId: '3' })]) }) }),
      Object.freeze({ name: 'rejected-sql', operation: 'query', effect: 'read', input: Object.freeze({ sql: 'PRAGMA journal_mode' }), expected: Object.freeze({ status: 'failed', code: 'RESOURCE_MALFORMED_INPUT' }) }),
    ]),
  }),
  Object.freeze({
    name: 'db-named-json-and-nullability',
    kind: 'db',
    steps: Object.freeze([
      Object.freeze({ name: 'json-string', operation: 'invoke', effect: 'read', declaredResult: 'rows', jsonColumns: Object.freeze(['json_value']), input: Object.freeze({ operation: 'echoJson', parameters: Object.freeze({ value: 'portable' }) }), expected: Object.freeze({ status: 'succeeded', output: DB_NAMED_JSON_STRING_ROWS }) }),
      Object.freeze({ name: 'json-number', operation: 'invoke', effect: 'read', declaredResult: 'rows', jsonColumns: Object.freeze(['json_value']), input: Object.freeze({ operation: 'echoJson', parameters: Object.freeze({ value: 42 }) }), expected: Object.freeze({ status: 'succeeded', output: DB_NAMED_JSON_NUMBER_ROWS }) }),
      Object.freeze({ name: 'json-boolean', operation: 'invoke', effect: 'read', declaredResult: 'rows', jsonColumns: Object.freeze(['json_value']), input: Object.freeze({ operation: 'echoJson', parameters: Object.freeze({ value: true }) }), expected: Object.freeze({ status: 'succeeded', output: DB_NAMED_JSON_BOOLEAN_ROWS }) }),
      Object.freeze({ name: 'json-array', operation: 'invoke', effect: 'read', declaredResult: 'rows', jsonColumns: Object.freeze(['json_value']), input: Object.freeze({ operation: 'echoJson', parameters: Object.freeze({ value: Object.freeze(['portable', 42, true, null]) }) }), expected: Object.freeze({ status: 'succeeded', output: DB_NAMED_JSON_ARRAY_ROWS }) }),
      Object.freeze({ name: 'json-null', operation: 'invoke', effect: 'read', declaredResult: 'rows', jsonColumns: Object.freeze(['json_value']), input: Object.freeze({ operation: 'echoNullableJson', parameters: Object.freeze({ value: null }) }), expected: Object.freeze({ status: 'succeeded', output: DB_NAMED_JSON_NULL_ROWS }) }),
      Object.freeze({ name: 'all-types-nullable', operation: 'invoke', effect: 'read', declaredResult: 'rows', jsonColumns: Object.freeze(['json_value']), input: Object.freeze({ operation: 'echoNullableAll', parameters: Object.freeze({ stringValue: null, numberValue: null, booleanValue: null, bigintValue: null, bytesValue: null, jsonValue: null }) }), expected: Object.freeze({ status: 'succeeded', output: DB_NAMED_NULLABLE_ROWS }) }),
      Object.freeze({ name: 'string-null-rejected', operation: 'invoke', effect: 'read', declaredResult: 'rows', input: Object.freeze({ operation: 'requiredString', parameters: Object.freeze({ value: null }) }), expected: Object.freeze({ status: 'failed', code: 'RESOURCE_MALFORMED_INPUT' }) }),
      Object.freeze({ name: 'number-null-rejected', operation: 'invoke', effect: 'read', declaredResult: 'rows', input: Object.freeze({ operation: 'requiredNumber', parameters: Object.freeze({ value: null }) }), expected: Object.freeze({ status: 'failed', code: 'RESOURCE_MALFORMED_INPUT' }) }),
      Object.freeze({ name: 'boolean-null-rejected', operation: 'invoke', effect: 'read', declaredResult: 'rows', input: Object.freeze({ operation: 'requiredBoolean', parameters: Object.freeze({ value: null }) }), expected: Object.freeze({ status: 'failed', code: 'RESOURCE_MALFORMED_INPUT' }) }),
      Object.freeze({ name: 'bigint-null-rejected', operation: 'invoke', effect: 'read', declaredResult: 'rows', input: Object.freeze({ operation: 'requiredBigint', parameters: Object.freeze({ value: null }) }), expected: Object.freeze({ status: 'failed', code: 'RESOURCE_MALFORMED_INPUT' }) }),
      Object.freeze({ name: 'bytes-null-rejected', operation: 'invoke', effect: 'read', declaredResult: 'rows', input: Object.freeze({ operation: 'requiredBytes', parameters: Object.freeze({ value: null }) }), expected: Object.freeze({ status: 'failed', code: 'RESOURCE_MALFORMED_INPUT' }) }),
      Object.freeze({ name: 'json-null-rejected', operation: 'invoke', effect: 'read', declaredResult: 'rows', input: Object.freeze({ operation: 'echoJson', parameters: Object.freeze({ value: null }) }), expected: Object.freeze({ status: 'failed', code: 'RESOURCE_MALFORMED_INPUT' }) }),
      Object.freeze({ name: 'bigint-as-json-rejected', operation: 'invoke', effect: 'read', declaredResult: 'rows', input: Object.freeze({ operation: 'echoJson', parameters: Object.freeze({ value: 1n }) }), expected: Object.freeze({ status: 'failed', code: 'RESOURCE_MALFORMED_INPUT' }) }),
      Object.freeze({ name: 'bytes-as-json-rejected', operation: 'invoke', effect: 'read', declaredResult: 'rows', input: Object.freeze({ operation: 'echoJson', parameters: Object.freeze({ value: new Uint8Array([1]) }) }), expected: Object.freeze({ status: 'failed', code: 'RESOURCE_MALFORMED_INPUT' }) }),
    ]),
  }),
  Object.freeze({
    name: 'db-result-limit',
    kind: 'db',
    steps: Object.freeze([
      Object.freeze({ name: 'create-limit-table', operation: 'execute', effect: 'write', input: Object.freeze({ sql: 'CREATE TABLE limit_values (n INTEGER)' }), expected: Object.freeze({ status: 'succeeded', output: DB_EXECUTE_ZERO }) }),
      Object.freeze({ name: 'fill-limit-table', operation: 'execute', effect: 'write', input: Object.freeze({ sql: DB_LIMIT_INSERT_SQL }), expected: Object.freeze({ status: 'succeeded', output: Object.freeze({ format: PORTABLE_RESOURCE_DB_EXECUTE_FORMAT, rowsAffected: 1001, lastInsertId: '1001' }) }) }),
      Object.freeze({ name: 'row-limit', operation: 'query', effect: 'read', input: Object.freeze({ sql: 'SELECT n FROM limit_values ORDER BY n' }), expected: Object.freeze({ status: 'failed', code: 'RESOURCE_LIMIT_EXCEEDED' }) }),
    ]),
  }),
] as const satisfies readonly TWidgetSdkResourceProviderScenario[]);

export type TWidgetSdkSqlProfileVector = Readonly<{
  name: string;
  sql: string;
  expectedEffect?: TPortableResourceSqlEffect;
  expected:
    | Readonly<{
        allowed: true;
        effect: TPortableResourceSqlEffect;
        statement: string;
        hasReturning: boolean;
        hasCte: boolean;
      }>
    | Readonly<{ allowed: false; code: string }>;
}>;

export const WIDGET_SDK_SQL_PROFILE_VECTORS = Object.freeze([
  Object.freeze({
    name: 'select',
    sql: 'SELECT id, value FROM counters WHERE id = 1',
    expectedEffect: 'read',
    expected: Object.freeze({
      allowed: true,
      effect: 'read',
      statement: 'select',
      hasReturning: false,
      hasCte: false,
    }),
  }),
  Object.freeze({
    name: 'cte-write',
    sql: 'WITH selected AS (SELECT id FROM counters) UPDATE counters SET value = 2 WHERE id IN (SELECT id FROM selected) RETURNING id',
    expectedEffect: 'write',
    expected: Object.freeze({
      allowed: true,
      effect: 'write',
      statement: 'update',
      hasReturning: true,
      hasCte: true,
    }),
  }),
  ...Object.freeze([
    ['transaction', 'BEGIN IMMEDIATE', undefined, 'SQL_TRANSACTION_CONTROL'],
    ['attachment', 'ATTACH DATABASE \'other.db\' AS other', undefined, 'SQL_ATTACHMENT_FORBIDDEN'],
    ['pragma', 'PRAGMA journal_mode = WAL', undefined, 'SQL_PRAGMA_FORBIDDEN'],
    ['vacuum', 'VACUUM INTO \'copy.db\'', undefined, 'SQL_VACUUM_FORBIDDEN'],
    ['extension', 'SELECT load_extension(\'native\')', undefined, 'SQL_EXTENSION_FORBIDDEN'],
    ['host-file', 'SELECT readfile(\'/etc/passwd\')', undefined, 'SQL_HOST_FILE_FORBIDDEN'],
    ['temp-object', 'CREATE TEMP TABLE scratch(id INTEGER)', undefined, 'SQL_TEMP_OBJECT_FORBIDDEN'],
    [
      'trigger',
      'CREATE TRIGGER audit AFTER UPDATE ON counters BEGIN INSERT INTO audit_log(value) VALUES (NEW.value); END',
      undefined,
      'SQL_TRIGGER_FORBIDDEN',
    ],
    ['internal-write', 'UPDATE sqlite_schema SET name = \'x\'', undefined, 'SQL_INTERNAL_NAMESPACE_WRITE_FORBIDDEN'],
    ['multiple-statements', 'SELECT 1; SELECT 2', undefined, 'SQL_MULTIPLE_STATEMENTS'],
    ['effect-mismatch', 'SELECT id FROM counters', 'write', 'SQL_EFFECT_MISMATCH'],
  ] as const).map(([name, sql, expectedEffect, code]) => Object.freeze({
    name,
    sql,
    ...(expectedEffect === undefined ? {} : { expectedEffect }),
    expected: Object.freeze({ allowed: false, code }),
  })),
] as const satisfies readonly TWidgetSdkSqlProfileVector[]);

export type TWidgetSdkFunctionOutcome =
  | Readonly<{ status: 'succeeded'; output: unknown }>
  | Readonly<{ status: 'failed'; code: string }>;

export type TWidgetSdkFunctionScenario = Readonly<{
  name: string;
  functionName: string;
  input: unknown;
  seed: readonly Readonly<{ key: string; value: unknown }>[];
  control?: 'cancel' | 'ambiguous_write';
  expected: TWidgetSdkFunctionOutcome;
}>;

export const WIDGET_SDK_FUNCTION_SCENARIOS = Object.freeze([
  Object.freeze({
    name: 'fn-success',
    functionName: 'increment',
    input: Object.freeze({ amount: 1 }),
    seed: Object.freeze([]),
    expected: Object.freeze({ status: 'succeeded', output: Object.freeze({ value: 2 }) }),
  }),
  Object.freeze({
    name: 'fx-read',
    functionName: 'readCounter',
    input: Object.freeze({ key: 'count' }),
    seed: Object.freeze([Object.freeze({ key: 'count', value: 4 })]),
    expected: Object.freeze({ status: 'succeeded', output: Object.freeze({ value: 4 }) }),
  }),
  Object.freeze({
    name: 'tx-write',
    functionName: 'writeCounter',
    input: Object.freeze({ key: 'count', value: 9 }),
    seed: Object.freeze([]),
    expected: Object.freeze({ status: 'succeeded', output: Object.freeze({ value: 9 }) }),
  }),
  Object.freeze({
    name: 'invalid-input',
    functionName: 'increment',
    input: Object.freeze({ amount: 'one' }),
    seed: Object.freeze([]),
    expected: Object.freeze({ status: 'failed', code: 'FUNCTION_INPUT_SCHEMA_INVALID' }),
  }),
  Object.freeze({
    name: 'invalid-output',
    functionName: 'invalidOutput',
    input: Object.freeze({}),
    seed: Object.freeze([]),
    expected: Object.freeze({ status: 'failed', code: 'FUNCTION_OUTPUT_SCHEMA_INVALID' }),
  }),
  Object.freeze({
    name: 'undeclared-slot',
    functionName: 'undeclaredSlot',
    input: Object.freeze({}),
    seed: Object.freeze([]),
    expected: Object.freeze({
      status: 'succeeded',
      output: Object.freeze({ code: 'RESOURCE_SLOT_UNDECLARED' }),
    }),
  }),
  Object.freeze({
    name: 'effect-escalation',
    functionName: 'effectEscalation',
    input: Object.freeze({}),
    seed: Object.freeze([]),
    expected: Object.freeze({
      status: 'succeeded',
      output: Object.freeze({ code: 'RESOURCE_EFFECT_DENIED' }),
    }),
  }),
  Object.freeze({
    name: 'handler-failure',
    functionName: 'handlerFailure',
    input: Object.freeze({}),
    seed: Object.freeze([]),
    expected: Object.freeze({ status: 'failed', code: 'FUNCTION_HANDLER_FAILED' }),
  }),
  Object.freeze({
    name: 'timeout',
    functionName: 'timeoutFunction',
    input: Object.freeze({}),
    seed: Object.freeze([]),
    expected: Object.freeze({ status: 'failed', code: 'FUNCTION_TIMED_OUT' }),
  }),
  Object.freeze({
    name: 'cancellation',
    functionName: 'cancelFunction',
    input: Object.freeze({}),
    seed: Object.freeze([]),
    control: 'cancel',
    expected: Object.freeze({ status: 'failed', code: 'FUNCTION_CANCELLED' }),
  }),
  Object.freeze({
    name: 'output-limit',
    functionName: 'outputLimit',
    input: Object.freeze({}),
    seed: Object.freeze([]),
    expected: Object.freeze({ status: 'failed', code: 'FUNCTION_OUTPUT_LIMIT' }),
  }),
  Object.freeze({
    name: 'log-success',
    functionName: 'logSuccess',
    input: Object.freeze({}),
    seed: Object.freeze([]),
    expected: Object.freeze({ status: 'succeeded', output: Object.freeze({ value: 1 }) }),
  }),
  Object.freeze({
    name: 'log-limit',
    functionName: 'logLimit',
    input: Object.freeze({}),
    seed: Object.freeze([]),
    expected: Object.freeze({ status: 'failed', code: 'FUNCTION_LOG_LIMIT' }),
  }),
  Object.freeze({
    name: 'runtime-dynamic-code',
    functionName: 'runtimeDynamicCode',
    input: Object.freeze({}),
    seed: Object.freeze([]),
    expected: Object.freeze({
      status: 'succeeded',
      output: Object.freeze({ code: 'DYNAMIC_CODE_BLOCKED' }),
    }),
  }),
  Object.freeze({
    name: 'resource-call-limit',
    functionName: 'resourceCallLimit',
    input: Object.freeze({}),
    seed: Object.freeze([Object.freeze({ key: 'count', value: 1 })]),
    expected: Object.freeze({
      status: 'succeeded',
      output: Object.freeze({ code: 'RESOURCE_LIMIT_EXCEEDED' }),
    }),
  }),
  Object.freeze({
    name: 'ambiguous-write',
    functionName: 'ambiguousWrite',
    input: Object.freeze({}),
    seed: Object.freeze([]),
    control: 'ambiguous_write',
    expected: Object.freeze({
      status: 'succeeded',
      output: Object.freeze({ code: 'RESOURCE_WRITE_OUTCOME_AMBIGUOUS' }),
    }),
  }),
] as const satisfies readonly TWidgetSdkFunctionScenario[]);

type TMaybePromise<T> = T | Promise<T>;

export type TWidgetSdkConformanceDisposable = Readonly<{
  dispose(): TMaybePromise<void>;
}>;

export type TWidgetSdkModuleAdmissionPort = TWidgetSdkConformanceDisposable & Readonly<{
  admit(input: Readonly<{
    phase: TWidgetServerModulePolicyPhase;
    source: string;
  }>): TMaybePromise<TWidgetServerModulePolicyAdmission>;
}>;

export type TWidgetSdkArtifactAdmissionPort = TWidgetSdkConformanceDisposable & Readonly<{
  admit(artifact: TWidgetServerModuleArtifact): TMaybePromise<TWidgetServerModuleArtifactValidation>;
}>;

export type TWidgetSdkResourcePort = TWidgetSdkConformanceDisposable & Readonly<{
  route(request: unknown): TMaybePromise<TPortableResourceResponseWire>;
}>;

export type TWidgetSdkResourceProviderPort = TWidgetSdkConformanceDisposable & Readonly<{
  call(input: Readonly<{
    kind: TWidgetSdkResourceProviderScenario['kind'];
    operation: string;
    effect: 'read' | 'write';
    input: unknown;
    declaredResult?: 'rows' | 'execute';
    jsonColumns?: readonly string[];
  }>): TMaybePromise<TWidgetSdkResourceProviderOutcome>;
}>;

export type TWidgetSdkSqlProfilePort = TWidgetSdkConformanceDisposable & Readonly<{
  classify(input: Readonly<{
    sql: string;
    expectedEffect?: TPortableResourceSqlEffect;
  }>): TMaybePromise<TPortableResourceSqlClassification>;
}>;

export type TWidgetSdkFunctionPort = TWidgetSdkConformanceDisposable & Readonly<{
  invoke(input: Readonly<{
    serverModule: TWidgetServerModuleArtifact;
    functionName: string;
    input: unknown;
  }>): TMaybePromise<TWidgetSdkFunctionOutcome>;
}>;

export type TWidgetSdkConformancePortFactory<TVector, TPort> = (
  vector: TVector,
) => TMaybePromise<TPort>;

function canonicalComparable(value: unknown): unknown {
  if (typeof value === 'bigint') return Object.freeze(['bigint', value.toString()]);
  if (value instanceof Uint8Array) return Object.freeze(['bytes', ...value]);
  if (Array.isArray(value)) return Object.freeze(value.map(canonicalComparable));
  if (value === null || typeof value !== 'object') return value;
  return Object.freeze(Object.fromEntries(Object.keys(value as object)
    .sort()
    .map((key) => [
      key,
      canonicalComparable((value as Readonly<Record<string, unknown>>)[key]),
    ])));
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalComparable(left))
    === JSON.stringify(canonicalComparable(right));
}

function assertConformance(name: string, actual: unknown, expected: unknown): void {
  if (!sameCanonicalValue(actual, expected)) {
    throw new Error(
      `Widget SDK conformance scenario '${name}' diverged: expected ${JSON.stringify(canonicalComparable(expected))}, received ${JSON.stringify(canonicalComparable(actual))}.`,
    );
  }
}

async function runFresh<TVector, TPort extends TWidgetSdkConformanceDisposable, TResult>(
  factory: TWidgetSdkConformancePortFactory<TVector, TPort>,
  vector: TVector,
  run: (port: TPort) => TMaybePromise<TResult>,
): Promise<TResult> {
  const port = await factory(vector);
  try {
    return await run(port);
  } finally {
    await port.dispose();
  }
}

export async function fnRunWidgetSdkModuleAdmissionConformance(
  factory: TWidgetSdkConformancePortFactory<
    TWidgetSdkModuleAdmissionVector,
    TWidgetSdkModuleAdmissionPort
  >,
): Promise<readonly TWidgetServerModulePolicyAdmission[]> {
  const transcript: TWidgetServerModulePolicyAdmission[] = [];
  for (const vector of WIDGET_SDK_MODULE_ADMISSION_VECTORS) {
    const actual = await runFresh(factory, vector, (port) => port.admit({
      phase: vector.phase,
      source: vector.source,
    }));
    assertConformance(vector.name, actual, vector.expected);
    transcript.push(actual);
  }
  return Object.freeze(transcript);
}

export async function fnRunWidgetSdkArtifactAdmissionConformance(
  factory: TWidgetSdkConformancePortFactory<
    TWidgetSdkArtifactAdmissionVector,
    TWidgetSdkArtifactAdmissionPort
  >,
): Promise<readonly TWidgetServerModuleArtifactValidation[]> {
  const transcript: TWidgetServerModuleArtifactValidation[] = [];
  for (const vector of WIDGET_SDK_ARTIFACT_ADMISSION_VECTORS) {
    const actual = await runFresh(factory, vector, (port) => port.admit(
      fnCreateWidgetSdkArtifactAdmissionCandidate(vector),
    ));
    assertConformance(vector.name, actual, vector.expected);
    transcript.push(actual);
  }
  return Object.freeze(transcript);
}

export async function fnRunWidgetSdkResourceConformance(
  factory: TWidgetSdkConformancePortFactory<TWidgetSdkResourceScenario, TWidgetSdkResourcePort>,
): Promise<readonly TPortableResourceResponseWire[]> {
  const transcript: TPortableResourceResponseWire[] = [];
  for (const vector of WIDGET_SDK_RESOURCE_SCENARIOS) {
    const actual = await runFresh(factory, vector, (port) => port.route(vector.request));
    assertConformance(vector.name, actual, vector.expected);
    transcript.push(actual);
  }
  return Object.freeze(transcript);
}

export type TWidgetSdkResourceProviderTranscriptEntry = Readonly<{
  scenario: string;
  step: string;
  outcome: TWidgetSdkResourceProviderOutcome;
}>;

export async function fnRunWidgetSdkResourceProviderConformance(
  factory: TWidgetSdkConformancePortFactory<
    TWidgetSdkResourceProviderScenario,
    TWidgetSdkResourceProviderPort
  >,
): Promise<readonly TWidgetSdkResourceProviderTranscriptEntry[]> {
  const transcript: TWidgetSdkResourceProviderTranscriptEntry[] = [];
  for (const scenario of WIDGET_SDK_RESOURCE_PROVIDER_SCENARIOS) {
    const entries = await runFresh(factory, scenario, async (port) => {
      const scenarioEntries: TWidgetSdkResourceProviderTranscriptEntry[] = [];
      for (const scenarioStep of scenario.steps) {
        const step: TWidgetSdkResourceProviderStep = scenarioStep;
        const actual = await port.call({
          kind: scenario.kind,
          operation: step.operation,
          effect: step.effect,
          input: step.input,
          ...(step.declaredResult === undefined
            ? {}
            : { declaredResult: step.declaredResult }),
          ...(step.jsonColumns === undefined
            ? {}
            : { jsonColumns: step.jsonColumns }),
        });
        assertConformance(`${scenario.name}/${step.name}`, actual, step.expected);
        scenarioEntries.push(Object.freeze({
          scenario: scenario.name,
          step: step.name,
          outcome: actual,
        }));
      }
      return scenarioEntries;
    });
    transcript.push(...entries);
  }
  return Object.freeze(transcript);
}

function sqlObservation(
  value: TPortableResourceSqlClassification,
): TWidgetSdkSqlProfileVector['expected'] {
  return value.allowed
    ? Object.freeze({
        allowed: true,
        effect: value.effect,
        statement: value.statement,
        hasReturning: value.hasReturning,
        hasCte: value.hasCte,
      })
    : Object.freeze({ allowed: false, code: value.code });
}

export async function fnRunWidgetSdkSqlProfileConformance(
  factory: TWidgetSdkConformancePortFactory<
    TWidgetSdkSqlProfileVector,
    TWidgetSdkSqlProfilePort
  >,
): Promise<readonly TWidgetSdkSqlProfileVector['expected'][]> {
  const transcript: TWidgetSdkSqlProfileVector['expected'][] = [];
  for (const vector of WIDGET_SDK_SQL_PROFILE_VECTORS) {
    const classified = await runFresh(factory, vector, (port) => port.classify({
      sql: vector.sql,
      ...(
        vector.expectedEffect === undefined
          ? {}
          : { expectedEffect: vector.expectedEffect }
      ),
    }));
    const actual = sqlObservation(classified);
    assertConformance(vector.name, actual, vector.expected);
    transcript.push(actual);
  }
  return Object.freeze(transcript);
}

export async function fnRunWidgetSdkFunctionConformance(
  factory: TWidgetSdkConformancePortFactory<TWidgetSdkFunctionScenario, TWidgetSdkFunctionPort>,
): Promise<readonly TWidgetSdkFunctionOutcome[]> {
  const transcript: TWidgetSdkFunctionOutcome[] = [];
  for (const vector of WIDGET_SDK_FUNCTION_SCENARIOS) {
    const actual = await runFresh(factory, vector, (port) => port.invoke({
      serverModule: fnCreateWidgetSdkConformanceServerModuleArtifact(),
      functionName: vector.functionName,
      input: vector.input,
    }));
    assertConformance(vector.name, actual, vector.expected);
    transcript.push(actual);
  }
  return Object.freeze(transcript);
}
