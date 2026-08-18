import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'bun:test';
import {
  WIDGET_SDK_ARTIFACT_ADMISSION_VECTORS,
  WIDGET_SDK_CONFORMANCE_FIXTURE,
  WIDGET_SDK_FUNCTION_SCENARIOS,
  WIDGET_SDK_MODULE_ADMISSION_VECTORS,
  WIDGET_SDK_RESOURCE_PROVIDER_SCENARIOS,
  WIDGET_SDK_RESOURCE_SCENARIOS,
  WIDGET_SDK_SERVER_FUNCTION_DESCRIPTORS,
  WIDGET_SDK_SERVER_MODULE_VECTOR,
  WIDGET_SDK_SERVER_MODULE_SOURCE,
  fnCreateWidgetSdkConformanceServerModuleArtifact,
  fnRunWidgetSdkArtifactAdmissionConformance,
  fnRunWidgetSdkFunctionConformance,
  fnRunWidgetSdkModuleAdmissionConformance,
  fnRunWidgetSdkResourceProviderConformance,
  fnRunWidgetSdkResourceConformance,
  type TWidgetSdkFunctionPort,
  type TWidgetSdkFunctionScenario,
  type TWidgetSdkResourceProviderPort,
  type TWidgetSdkResourceProviderScenario,
  type TWidgetSdkResourceScenario,
} from '@omnidraw/sdk/conformance';
import {
  fnEncodePortableResourceDbExecute,
  fnEncodePortableResourceDbRows,
  fnValidateWidgetServerModuleArtifact,
  fnWidgetServerModulePolicyAdmission,
  type TWidgetManifestV1,
  type TWidgetServerModuleArtifact,
} from '@omnidraw/sdk/contract';
import { Effect, ManagedRuntime } from 'effect';
import type {
  IResourceGateway,
  TResourceCall,
} from '#backend/shell/resources';
import {
  BunChildFunctionDescriptorExtractor,
  BunChildFunctionProcessDriver,
  DirectFunctionExecutor,
  DirectInvocationResourceGateway,
  EphemeralResourceWritePermitAuthority,
  JsonSchemaFunctionValidator,
} from '#backend/shell/function-execution/local';
import {
  createBunChildCage,
  liveBunChildProcessGroupController,
  readBunChildRssBytes,
  removeBunChildCage,
  terminateBunChild,
} from '#backend/shell/function-execution/local/BunChildLifecycle';
import {
  readBunChildCpuMs,
} from '#backend/shell/function-execution/local/BunChildFunctionProcessDriver';
import {
  fnRoutePortableResourceCall,
} from '#backend/shell/function-execution/local/DirectInvocationResourceGateway';
import {
  DbResource,
  KvResource,
  ResourceKeyValueStore,
  SecretStoreDatabaseKeyProvider,
  SecretStoreResource,
  type ILocalResourceProvider,
  type TDatabaseFactory,
  type TLocalResolvedResourceCall,
  type TResourceKeyValueDatabaseFactory,
  type TStoredEncryptionKey,
} from '#backend/shell/resources/local';
import { Database } from '#backend/shell/database/DbServiceTurso/turso-native';
import { fnResolveOmnidrawHome } from '#backend/shell/config/fn.resolve-omnidraw-home';
import type { ICliConfig } from '#backend/shell/cli/config';
import { layerLiveMechanics } from '#backend/shell/runtime/layer.live-mechanics';
import { LiveWidgetBuildGeneration } from '#backend/shell/runtime/service.live-mechanics';
import type { TOmnidrawDistributionBuild } from '#backend/shell/widget-runtime/builder';

const RESOURCE_ID = '00000000-0000-4000-8000-000000000146';
const SUBJECT = Object.freeze({
  canvasId: 'canvas-conformance',
  elementId: 'element-conformance',
  widgetInstanceId: 'instance-conformance',
});

const conformanceDistributionBuild: TOmnidrawDistributionBuild = async (request) => ({
  kind: 'external-distribution',
  snapshot: {
    files: [{
      path: 'main.js',
      bytes: new TextEncoder().encode(
        'const root=document.createElement("div");document.body.append(root);',
      ),
    }],
  },
  entry: 'main.js',
  producer: {
    name: 'omnidraw-conformance-build',
    version: '1',
    digest: `sha256:${'1'.repeat(64)}`,
  },
  sourceRevision: request.sourceRevision,
  dependencyLockDigest: `sha256:${'2'.repeat(64)}`,
  buildConfigurationDigest: `sha256:${'3'.repeat(64)}`,
});

async function writeAcceptedBuildDraft(
  draftsRoot: string,
  manifest: TWidgetManifestV1,
): Promise<void> {
  const root = join(draftsRoot, manifest.slug);
  await Promise.all([
    mkdir(join(root, 'ui'), { recursive: true }),
    mkdir(join(root, 'server'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(root, 'omnidraw.json'), `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(join(root, 'ui', 'main.ts'), WIDGET_SDK_CONFORMANCE_FIXTURE.files[0]!.text),
    writeFile(join(root, 'server', 'main.ts'), WIDGET_SDK_SERVER_MODULE_SOURCE),
  ]);
}

function codedError(error: unknown): string {
  if (error !== null && typeof error === 'object') {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    if (descriptor?.get === undefined && typeof descriptor?.value === 'string') {
      return descriptor.value;
    }
  }
  return 'FUNCTION_EXECUTION_FAILED';
}

type TProbeTaggedValue =
  | Readonly<{ type: 'null' }>
  | Readonly<{ type: 'boolean'; value: boolean }>
  | Readonly<{ type: 'number'; value: number }>
  | Readonly<{ type: 'string'; value: string }>
  | Readonly<{ type: 'bigint'; value: string }>
  | Readonly<{ type: 'bytes'; items: readonly number[] }>
  | Readonly<{ type: 'array'; items: readonly TProbeTaggedValue[] }>
  | Readonly<{
      type: 'object';
      entries: readonly (readonly [string, TProbeTaggedValue])[];
    }>;

function encodeProbeValue(value: unknown): TProbeTaggedValue {
  if (value === null) return Object.freeze({ type: 'null' as const });
  if (typeof value === 'boolean') return Object.freeze({ type: 'boolean' as const, value });
  if (typeof value === 'number') return Object.freeze({ type: 'number' as const, value });
  if (typeof value === 'string') return Object.freeze({ type: 'string' as const, value });
  if (typeof value === 'bigint') {
    return Object.freeze({ type: 'bigint' as const, value: value.toString() });
  }
  if (value instanceof Uint8Array) {
    return Object.freeze({
      type: 'bytes' as const,
      items: Object.freeze([...value]),
    });
  }
  if (Array.isArray(value)) {
    return Object.freeze({
      type: 'array' as const,
      items: Object.freeze(value.map(encodeProbeValue)),
    });
  }
  if (value === undefined || typeof value !== 'object') {
    throw new TypeError('Resource probe values must be portable data.');
  }
  return Object.freeze({
    type: 'object' as const,
    entries: Object.freeze(Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => Object.freeze([key, encodeProbeValue(item)] as const))),
  });
}

function decodeProbeValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Resource probe returned a malformed tagged value.');
  }
  const node = value as Readonly<Record<string, unknown>>;
  if (node.type === 'null') return null;
  if (node.type === 'boolean') {
    if (typeof node.value !== 'boolean') throw new TypeError('Malformed probe boolean.');
    return node.value;
  }
  if (node.type === 'number') {
    if (typeof node.value !== 'number' || !Number.isFinite(node.value)) {
      throw new TypeError('Malformed probe number.');
    }
    return node.value;
  }
  if (node.type === 'string') {
    if (typeof node.value !== 'string') throw new TypeError('Malformed probe string.');
    return node.value;
  }
  if (node.type === 'bigint') {
    if (typeof node.value !== 'string' || !/^-?(?:0|[1-9][0-9]*)$/.test(node.value)) {
      throw new TypeError('Malformed probe bigint.');
    }
    return BigInt(node.value);
  }
  if (node.type === 'bytes') {
    if (
      !Array.isArray(node.items)
      || node.items.some((item) => !Number.isInteger(item) || item < 0 || item > 255)
    ) {
      throw new TypeError('Malformed probe bytes.');
    }
    return Uint8Array.from(node.items as readonly number[]);
  }
  if (node.type === 'array') {
    if (!Array.isArray(node.items)) throw new TypeError('Malformed probe array.');
    return Object.freeze(node.items.map(decodeProbeValue));
  }
  if (node.type !== 'object' || !Array.isArray(node.entries)) {
    throw new TypeError('Resource probe returned an unknown tagged value.');
  }
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const entry of node.entries) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') {
      throw new TypeError('Malformed probe object entry.');
    }
    output[entry[0]] = decodeProbeValue(entry[1]);
  }
  return Object.freeze(output);
}

function encodeDbProbeOutput(
  input: Parameters<TWidgetSdkResourceProviderPort['call']>[0],
  output: unknown,
): unknown {
  if (input.kind !== 'db') return output;
  const isRows = input.operation === 'query'
    || (input.operation === 'invoke' && input.declaredResult === 'rows');
  if (isRows) {
    const rows = output as Readonly<{
      columns: readonly string[];
      rows: readonly (readonly unknown[])[];
    }>;
    return fnEncodePortableResourceDbRows({
      columns: rows.columns,
      rows: rows.rows,
      ...(input.jsonColumns === undefined ? {} : { jsonColumns: input.jsonColumns }),
    });
  }
  const isExecute = input.operation === 'execute'
    || (input.operation === 'invoke' && input.declaredResult === 'execute');
  if (!isExecute) return output;
  const encode = (value: unknown) => {
    const result = value as Readonly<{ rowsAffected: number; lastInsertId: bigint | null }>;
    return fnEncodePortableResourceDbExecute({
      rowsAffected: result.rowsAffected,
      lastInsertId: result.lastInsertId,
    });
  };
  return Array.isArray(output)
    ? Object.freeze(output.map(encode))
    : encode(output);
}

async function createKvAdapter(
  scenario: Pick<TWidgetSdkResourceScenario | TWidgetSdkFunctionScenario, 'seed'>,
) {
  const root = await mkdtemp(join(tmpdir(), 'omnidraw-portability-kv-'));
  const dataRoot = join(root, 'data');
  await mkdir(dataRoot, { recursive: true });
  const databaseFactory: TResourceKeyValueDatabaseFactory = (databasePath, options) => (
    new Database(databasePath, options as ConstructorParameters<typeof Database>[1])
  );
  const store = new ResourceKeyValueStore({
    dataRoot,
    kind: 'kv',
    databaseFactory,
    nowMs: Date.now,
    scheduleIdleSweep: (callback, delayMs) => {
      const timer = setTimeout(() => { void callback(); }, delayMs);
      timer.unref();
      return () => clearTimeout(timer);
    },
  });
  const provider = new KvResource(store);
  const resource = Object.freeze({ id: RESOURCE_ID, kind: 'kv' as const });
  const context: TLocalResolvedResourceCall = Object.freeze({
    resource,
    requirement: Object.freeze({ kind: 'kv' as const, scope: Object.freeze(['read', 'write'] as const) }),
    binding: Object.freeze({ allowRead: true, allowWrite: true }),
    functionClass: 'tx',
    slot: 'counter',
    canRead: true,
    canWrite: true,
  });
  await provider.provision(resource, {});
  for (const entry of scenario.seed) {
    await provider.dispatch(context, 'set', { key: entry.key, value: entry.value });
  }
  const gateway: IResourceGateway = Object.freeze({
    async call(call: TResourceCall) {
      const output = await provider.dispatch(context, call.operation, call.input);
      return Object.freeze({
        output,
      });
    },
  });
  let disposed = false;
  return Object.freeze({
    gateway,
    binding: Object.freeze({
      slot: 'counter',
      resourceId: RESOURCE_ID,
      kind: 'kv' as const,
      allowRead: true,
      allowWrite: true,
    }),
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      try {
        await provider.close();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  });
}

function databaseFactory(): TResourceKeyValueDatabaseFactory {
  return (databasePath, options) => (
    new Database(databasePath, options as ConstructorParameters<typeof Database>[1])
  );
}

function secretKeyProvider(): SecretStoreDatabaseKeyProvider {
  let stored: TStoredEncryptionKey | null = null;
  return new SecretStoreDatabaseKeyProvider({
    encryptionKeys: Object.freeze({
      async get(): Promise<TStoredEncryptionKey | null> {
        return stored;
      },
      async getOrCreate(candidate): Promise<TStoredEncryptionKey> {
        stored ??= Object.freeze({
          id: candidate.keyId,
          purpose: candidate.purpose,
          algorithm: candidate.algorithm,
          keyHex: candidate.keyHex,
          createdAtSec: '0',
        });
        return stored;
      },
    }),
    randomBytes: (length) => new Uint8Array(length).fill(146),
    randomUUID: () => '00000000-0000-4000-8000-000000000146',
  });
}

function resourceProbeSlot(kind: TWidgetSdkResourceProviderScenario['kind']): string {
  if (kind === 'kv') return 'portableKv';
  if (kind === 'secretStore') return 'portableSecrets';
  return 'portableDb';
}

type TResourceProviderHarness = Readonly<{
  gateway: IResourceGateway;
  binding: Readonly<{
    slot: string;
    resourceId: string;
    kind: TWidgetSdkResourceProviderScenario['kind'];
    allowRead: boolean;
    allowWrite: boolean;
  }>;
  dispose(): Promise<void>;
}>;

async function createResourceProviderHarness(
  scenario: TWidgetSdkResourceProviderScenario,
): Promise<TResourceProviderHarness> {
  const root = await mkdtemp(join(tmpdir(), 'omnidraw-provider-conformance-'));
  const dataRoot = join(root, 'data');
  await mkdir(dataRoot, { recursive: true });
  const scheduleIdleSweep = (callback: () => void | Promise<void>, delayMs: number) => {
    const timer = setTimeout(() => { void callback(); }, delayMs);
    timer.unref();
    return () => clearTimeout(timer);
  };
  const provider: ILocalResourceProvider = scenario.kind === 'kv'
    ? new KvResource(new ResourceKeyValueStore({
        dataRoot,
        kind: 'kv',
        databaseFactory: databaseFactory(),
        nowMs: Date.now,
        scheduleIdleSweep,
      }))
    : scenario.kind === 'secretStore'
      ? new SecretStoreResource(new ResourceKeyValueStore({
          dataRoot,
          kind: 'secretStore',
          secretStoreKeyProvider: secretKeyProvider(),
          databaseFactory: databaseFactory(),
          nowMs: Date.now,
          scheduleIdleSweep,
        }))
      : new DbResource({
          db: { dbResource: { draft: { list: async () => [] } } },
          dataRoot,
          databaseFactory: databaseFactory() as unknown as TDatabaseFactory,
          nowMs: Date.now,
          scheduleIdleSweep,
        });
  const resource = Object.freeze({ id: RESOURCE_ID, kind: scenario.kind });
  const requirement = scenario.kind === 'db'
    ? Object.freeze({
        kind: 'db' as const,
        required: true,
        scope: Object.freeze(['read', 'write'] as const),
        arbitrarySql: true,
        operations: Object.freeze({
          readTyped: Object.freeze({
            effect: 'read' as const,
            sql: 'SELECT big_value, blob_value, nullable_value, json_value FROM portability_values WHERE id = :id',
            parameters: Object.freeze({
              id: Object.freeze({ type: 'bigint' as const }),
            }),
            result: 'rows' as const,
            jsonColumns: Object.freeze(['json_value']),
          }),
          echoJson: Object.freeze({
            effect: 'read' as const,
            sql: 'SELECT :value AS json_value',
            parameters: Object.freeze({
              value: Object.freeze({ type: 'json' as const, nullable: false }),
            }),
            result: 'rows' as const,
            jsonColumns: Object.freeze(['json_value']),
          }),
          echoNullableJson: Object.freeze({
            effect: 'read' as const,
            sql: 'SELECT :value AS json_value',
            parameters: Object.freeze({
              value: Object.freeze({ type: 'json' as const, nullable: true }),
            }),
            result: 'rows' as const,
            jsonColumns: Object.freeze(['json_value']),
          }),
          echoNullableAll: Object.freeze({
            effect: 'read' as const,
            sql: 'SELECT :stringValue AS string_value, :numberValue AS number_value, :booleanValue AS boolean_value, :bigintValue AS bigint_value, :bytesValue AS bytes_value, :jsonValue AS json_value',
            parameters: Object.freeze({
              stringValue: Object.freeze({ type: 'string' as const, nullable: true }),
              numberValue: Object.freeze({ type: 'number' as const, nullable: true }),
              booleanValue: Object.freeze({ type: 'boolean' as const, nullable: true }),
              bigintValue: Object.freeze({ type: 'bigint' as const, nullable: true }),
              bytesValue: Object.freeze({ type: 'bytes' as const, nullable: true }),
              jsonValue: Object.freeze({ type: 'json' as const, nullable: true }),
            }),
            result: 'rows' as const,
            jsonColumns: Object.freeze(['json_value']),
          }),
          requiredString: Object.freeze({
            effect: 'read' as const,
            sql: 'SELECT :value AS value',
            parameters: Object.freeze({ value: Object.freeze({ type: 'string' as const, nullable: false }) }),
            result: 'rows' as const,
          }),
          requiredNumber: Object.freeze({
            effect: 'read' as const,
            sql: 'SELECT :value AS value',
            parameters: Object.freeze({ value: Object.freeze({ type: 'number' as const, nullable: false }) }),
            result: 'rows' as const,
          }),
          requiredBoolean: Object.freeze({
            effect: 'read' as const,
            sql: 'SELECT :value AS value',
            parameters: Object.freeze({ value: Object.freeze({ type: 'boolean' as const, nullable: false }) }),
            result: 'rows' as const,
          }),
          requiredBigint: Object.freeze({
            effect: 'read' as const,
            sql: 'SELECT :value AS value',
            parameters: Object.freeze({ value: Object.freeze({ type: 'bigint' as const, nullable: false }) }),
            result: 'rows' as const,
          }),
          requiredBytes: Object.freeze({
            effect: 'read' as const,
            sql: 'SELECT :value AS value',
            parameters: Object.freeze({ value: Object.freeze({ type: 'bytes' as const, nullable: false }) }),
            result: 'rows' as const,
          }),
        }),
      })
    : Object.freeze({
        kind: scenario.kind,
        required: true,
        scope: Object.freeze(['read', 'write'] as const),
      });
  const slot = resourceProbeSlot(scenario.kind);
  const context: TLocalResolvedResourceCall = Object.freeze({
    resource,
    requirement,
    binding: Object.freeze({ allowRead: true, allowWrite: true }),
    functionClass: 'tx',
    slot,
    canRead: true,
    canWrite: true,
  });
  await provider.provision(resource, {});
  let disposed = false;
  return Object.freeze({
    gateway: Object.freeze({
      async call(call: TResourceCall) {
        const output = await provider.dispatch(context, call.operation, call.input);
        return Object.freeze({ output });
      },
    }),
    binding: Object.freeze({
      slot,
      resourceId: RESOURCE_ID,
      kind: scenario.kind,
      allowRead: true,
      allowWrite: true,
    }),
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      try {
        await provider.close?.();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  });
}

async function createArtifactResourceProviderAdapter(
  scenario: TWidgetSdkResourceProviderScenario,
  serverModule: TWidgetServerModuleArtifact,
): Promise<TWidgetSdkResourceProviderPort> {
  const descriptor = serverModule.functionDescriptors.find(
    (candidate) => candidate.exportName === 'resourceProbe',
  );
  if (descriptor === undefined) {
    throw new Error('Conformance server artifact omitted resourceProbe.');
  }
  const harness = await createResourceProviderHarness(scenario);
  const tempRoot = await mkdtemp(join(tmpdir(), 'omnidraw-provider-probe-'));
  let identifier = 0;
  const nextId = (prefix: string): string => `${prefix}-${identifier++}`;
  const driver = new BunChildFunctionProcessDriver({
    executable: process.execPath,
    workerPath: fileURLToPath(new URL(
      '../shell/function-execution/local/function-worker.ts',
      import.meta.url,
    )),
    tempRoot,
    spawn: Bun.spawn,
    nowMs: Date.now,
    createId: () => nextId('provider-driver'),
    timers: Object.freeze({
      setTimeout: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
      clearTimeout: (timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>),
      setInterval: (callback: () => void, delayMs: number) => setInterval(callback, delayMs),
      clearInterval: (timer: unknown) => clearInterval(timer as ReturnType<typeof setInterval>),
    }),
    readRssBytes: readBunChildRssBytes,
    readCpuMs: readBunChildCpuMs,
    createCage: createBunChildCage,
    removeCage: removeBunChildCage,
    terminateChild: terminateBunChild,
    processGroups: liveBunChildProcessGroupController,
    maxResourceCalls: 1,
  });
  const executor = new DirectFunctionExecutor({
    driver,
    schemas: new JsonSchemaFunctionValidator(),
    nowMs: Date.now,
    createId: () => nextId('provider-call'),
  });
  const writePermits = new EphemeralResourceWritePermitAuthority({
    secret: new Uint8Array(32).fill(146),
    nowMs: Date.now,
    createId: () => nextId('provider-permit'),
    createNonce: () => nextId('provider-nonce'),
  });
  let disposed = false;
  return Object.freeze({
    async call(input) {
      try {
        const result = await executor.invoke({
          subject: SUBJECT,
          definition: Object.freeze({
            widgetKey: 'portable-counter',
            catalogGeneration: 1,
            serverModule: Object.freeze({
              format: serverModule.format,
              abi: serverModule.abi,
              moduleDigestSha256: serverModule.moduleDigestSha256,
              functionDescriptors: serverModule.functionDescriptors,
              functionDescriptorsDigestSha256:
                serverModule.functionDescriptorsDigestSha256,
            }),
            descriptor,
          }),
          artifact: serverModule.moduleBytes,
          input: Object.freeze({
            slot: harness.binding.slot,
            operation: input.operation,
            effect: input.effect,
            input: encodeProbeValue(input.input),
          }),
          createResources: (call) => new DirectInvocationResourceGateway({
            call,
            gateway: harness.gateway,
            bindings: Object.freeze({
              resolveBinding: async (slot: string) => (
                slot === harness.binding.slot ? harness.binding : null
              ),
            }),
            writePermits,
            nowMs: Date.now,
          }),
        });
        if (result.status !== 'succeeded') {
          return Object.freeze({ status: 'failed' as const, code: result.failure.code });
        }
        if (result.output === null || typeof result.output !== 'object') {
          throw new TypeError('Resource probe returned a malformed outcome.');
        }
        const probe = result.output as Readonly<Record<string, unknown>>;
        const value = decodeProbeValue(probe.value);
        if (probe.status === 'failed') {
          if (typeof value !== 'string') {
            throw new TypeError('Resource probe returned a malformed failure code.');
          }
          return Object.freeze({ status: 'failed' as const, code: value });
        }
        if (probe.status !== 'succeeded') {
          throw new TypeError('Resource probe returned an unknown outcome status.');
        }
        return Object.freeze({
          status: 'succeeded' as const,
          output: encodeDbProbeOutput(input, value),
        });
      } catch (error) {
        return Object.freeze({ status: 'failed' as const, code: codedError(error) });
      }
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      try {
        expect(executor.diagnostics().activeCalls).toBe(0);
        expect(driver.diagnostics().activeGuestCount).toBe(0);
      } finally {
        try {
          await harness.dispose();
        } finally {
          await rm(tempRoot, { recursive: true, force: true });
        }
      }
    },
  });
}

async function createArtifactAdmissionAdapter() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'omnidraw-artifact-admission-'));
  let identifier = 0;
  const extractor = new BunChildFunctionDescriptorExtractor({
    executable: process.execPath,
    workerPath: fileURLToPath(new URL(
      '../shell/function-execution/local/function-worker.ts',
      import.meta.url,
    )),
    tempRoot,
    spawn: Bun.spawn,
    nowMs: Date.now,
    createId: () => `artifact-${identifier++}`,
    timers: Object.freeze({
      setTimeout: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
      clearTimeout: (timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>),
      setInterval: (callback: () => void, delayMs: number) => setInterval(callback, delayMs),
      clearInterval: (timer: unknown) => clearInterval(timer as ReturnType<typeof setInterval>),
    }),
    readRssBytes: readBunChildRssBytes,
    createCage: createBunChildCage,
    removeCage: removeBunChildCage,
    terminateChild: terminateBunChild,
    processGroups: liveBunChildProcessGroupController,
  });
  let disposed = false;
  return Object.freeze({
    async admit(artifact: TWidgetServerModuleArtifact) {
      const validation = fnValidateWidgetServerModuleArtifact({
        artifact,
        digestSha256: (value) => createHash('sha256').update(value).digest('hex'),
      });
      if (!validation.valid) return validation;
      const descriptors = await extractor.extractServerFunctionDescriptors({
        serverModule: artifact,
      });
      expect(descriptors).toEqual(artifact.functionDescriptors);
      return Object.freeze({ valid: true as const });
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      try {
        expect(extractor.diagnostics().activeGuestCount).toBe(0);
      } finally {
        await rm(tempRoot, { recursive: true, force: true });
      }
    },
  });
}

async function createFunctionAdapter(
  scenario: TWidgetSdkFunctionScenario,
  acceptedServerModule?: TWidgetServerModuleArtifact,
) {
  const resources = await createKvAdapter(scenario);
  const tempRoot = await mkdtemp(join(tmpdir(), 'omnidraw-portability-function-'));
  let identifier = 0;
  const nextId = (prefix: string): string => `${prefix}-${identifier++}`;
  const driver = new BunChildFunctionProcessDriver({
    executable: process.execPath,
    workerPath: fileURLToPath(new URL(
      '../shell/function-execution/local/function-worker.ts',
      import.meta.url,
    )),
    tempRoot,
    spawn: Bun.spawn,
    nowMs: Date.now,
    createId: () => nextId('driver'),
    timers: Object.freeze({
      setTimeout: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
      clearTimeout: (timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>),
      setInterval: (callback: () => void, delayMs: number) => setInterval(callback, delayMs),
      clearInterval: (timer: unknown) => clearInterval(timer as ReturnType<typeof setInterval>),
    }),
    readRssBytes: readBunChildRssBytes,
    readCpuMs: readBunChildCpuMs,
    createCage: createBunChildCage,
    removeCage: removeBunChildCage,
    terminateChild: terminateBunChild,
    processGroups: liveBunChildProcessGroupController,
    maxResourceCalls: 2,
  });
  const executor = new DirectFunctionExecutor({
    driver,
    schemas: new JsonSchemaFunctionValidator(),
    nowMs: Date.now,
    createId: () => nextId('call'),
  });
  const writePermits = new EphemeralResourceWritePermitAuthority({
    secret: new Uint8Array(32).fill(146),
    nowMs: Date.now,
    createId: () => nextId('permit'),
    createNonce: () => nextId('nonce'),
  });
  let disposed = false;
  return Object.freeze({
    async invoke(input: Parameters<TWidgetSdkFunctionPort['invoke']>[0]) {
      const serverModule = acceptedServerModule ?? input.serverModule;
      const descriptor = serverModule.functionDescriptors.find(
        (candidate) => candidate.exportName === input.functionName,
      );
      if (descriptor === undefined) {
        return Object.freeze({ status: 'failed' as const, code: 'FUNCTION_NOT_FOUND' });
      }
      const controller = scenario.control === 'cancel' ? new AbortController() : null;
      const cancelTimer = controller === null
        ? null
        : setTimeout(() => controller.abort('conformance cancellation'), 20);
      try {
        const gateway: IResourceGateway = scenario.control === 'ambiguous_write'
          ? Object.freeze({
              async call(call: TResourceCall) {
                await resources.gateway.call(call);
                throw new Error('Acknowledgement intentionally lost.');
              },
            })
          : resources.gateway;
        const result = await executor.invoke({
          subject: SUBJECT,
          definition: Object.freeze({
            widgetKey: 'portable-counter',
            catalogGeneration: 1,
            serverModule: Object.freeze({
              format: serverModule.format,
              abi: serverModule.abi,
              moduleDigestSha256: serverModule.moduleDigestSha256,
              functionDescriptors: serverModule.functionDescriptors,
              functionDescriptorsDigestSha256:
                serverModule.functionDescriptorsDigestSha256,
            }),
            descriptor,
          }),
          artifact: serverModule.moduleBytes,
          input: input.input,
          ...(controller === null ? {} : { signal: controller.signal }),
          createResources: (call) => new DirectInvocationResourceGateway({
            call,
            gateway,
            bindings: Object.freeze({
              resolveBinding: async (slot: string) => (
                slot === resources.binding.slot ? resources.binding : null
              ),
            }),
            writePermits,
            nowMs: Date.now,
          }),
        });
        return result.status === 'succeeded'
          ? Object.freeze({ status: 'succeeded' as const, output: result.output })
          : Object.freeze({ status: 'failed' as const, code: result.failure.code });
      } catch (error) {
        return Object.freeze({ status: 'failed' as const, code: codedError(error) });
      } finally {
        if (cancelTimer !== null) clearTimeout(cancelTimer);
      }
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      try {
        expect(executor.diagnostics().activeCalls).toBe(0);
        expect(driver.diagnostics().activeGuestCount).toBe(0);
      } finally {
        await resources.dispose();
        await rm(tempRoot, { recursive: true, force: true });
      }
    },
  });
}

describe('widget portability live conformance', () => {
  test('runs the canonical admission inventory through the OSS policy surface', async () => {
    let disposed = 0;
    const transcript = await fnRunWidgetSdkModuleAdmissionConformance(() => ({
      admit: fnWidgetServerModulePolicyAdmission,
      dispose: () => { disposed += 1; },
    }));
    expect(transcript).toHaveLength(WIDGET_SDK_MODULE_ADMISSION_VECTORS.length);
    expect(disposed).toBe(WIDGET_SDK_MODULE_ADMISSION_VECTORS.length);
  });

  test('admits exact canonical artifacts through bounded OSS descriptor children', async () => {
    const transcript = await fnRunWidgetSdkArtifactAdmissionConformance(
      createArtifactAdmissionAdapter,
    );
    expect(transcript).toHaveLength(WIDGET_SDK_ARTIFACT_ADMISSION_VECTORS.length);
  }, 30_000);

  test('routes canonical and malformed wire through the OSS KV provider bridge', async () => {
    const transcript = await fnRunWidgetSdkResourceConformance(async (scenario) => {
      const adapter = await createKvAdapter(scenario);
      return Object.freeze({
        route: (request: unknown) => fnRoutePortableResourceCall(adapter.gateway, request),
        dispose: adapter.dispose,
      });
    });
    expect(transcript).toEqual(WIDGET_SDK_RESOURCE_SCENARIOS.map(({ expected }) => expected));
  });

  test('runs every provider scenario through the canonical module and real OSS composition', async () => {
    const serverModule = fnCreateWidgetSdkConformanceServerModuleArtifact();
    const transcript = await fnRunWidgetSdkResourceProviderConformance(
      (scenario) => createArtifactResourceProviderAdapter(scenario, serverModule),
    );
    expect(transcript).toHaveLength(WIDGET_SDK_RESOURCE_PROVIDER_SCENARIOS.reduce(
      (count, scenario) => count + scenario.steps.length,
      0,
    ));
  }, 90_000);

  test('executes fn/fx/tx and invalid input through disposable OSS children', async () => {
    const transcript = await fnRunWidgetSdkFunctionConformance(createFunctionAdapter);
    expect(transcript).toEqual(WIDGET_SDK_FUNCTION_SCENARIOS.map(({ expected }) => expected));
  }, 30_000);

  test('executes the same scenarios from a real accepted-generation server artifact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnidraw-accepted-portability-'));
    const home = fnResolveOmnidrawHome({ join, resolve }, {
      cwd: root,
      dataDir: root,
      env: {},
      homedir: root,
    });
    await Promise.all([
      home.homeDir,
      home.cacheRoot,
      home.tempRoot,
      home.widgetDraftsRoot,
      home.widgetPublishedRoot,
      home.widgetStagingRoot,
      home.widgetPreviewRoot,
      home.widgetTrashRoot,
      home.widgetQuarantineRoot,
    ].map((path) => mkdir(path, { recursive: true })));
    const manifest: TWidgetManifestV1 = WIDGET_SDK_SERVER_MODULE_VECTOR.manifest;
    await writeAcceptedBuildDraft(home.widgetDraftsRoot, manifest);
    const config: ICliConfig = {
      cwd: root,
      dev: false,
      version: '0.0.0-conformance',
      command: 'serve',
      rawArgv: ['omnidraw', 'serve'],
      argv: [],
      port: 0,
      home,
      helpRequested: false,
      versionRequested: false,
    };
    const runtime = ManagedRuntime.make(layerLiveMechanics({
      config,
      piAuthSourcePath: join(root, 'missing-pi-auth.json'),
      options: { distributionBuild: conformanceDistributionBuild },
    }));
    try {
      const buildGeneration = await runtime.runPromise(
        Effect.gen(function*() {
          return yield* LiveWidgetBuildGeneration;
        }),
      );
      const accepted = await buildGeneration.ensureCurrent(manifest.slug);
      const serverArtifact = accepted.construction.construction.serverArtifact;
      if (serverArtifact === null) throw new Error('Accepted build omitted its server artifact.');
      expect(fnValidateWidgetServerModuleArtifact({
        artifact: serverArtifact,
        digestSha256: (value) => createHash('sha256').update(value).digest('hex'),
      })).toEqual({ valid: true });
      expect(serverArtifact.functionDescriptors).toEqual(
        WIDGET_SDK_SERVER_FUNCTION_DESCRIPTORS,
      );
      expect(serverArtifact.moduleDigestSha256).toBe(
        createHash('sha256').update(serverArtifact.moduleBytes).digest('hex'),
      );
      expect(serverArtifact.functionDescriptorsDigestSha256).toBe(
        WIDGET_SDK_SERVER_MODULE_VECTOR.functionDescriptorsDigestSha256,
      );
      expect(accepted.construction.construction.functionDescriptorsDigestSha256).toBe(
        WIDGET_SDK_SERVER_MODULE_VECTOR.functionDescriptorsDigestSha256,
      );
      expect(accepted.signed.build.functionDescriptorsDigestSha256).toBe(
        WIDGET_SDK_SERVER_MODULE_VECTOR.functionDescriptorsDigestSha256,
      );
      expect(accepted.signed.build.constructionContractDigestSha256).toBe(
        accepted.construction.construction.constructionContractDigestSha256,
      );
      expect(accepted.signed.build.serverArtifact).toBe(serverArtifact);
      expect(accepted.signed.build.serverArtifact?.moduleBytes).toBe(
        serverArtifact.moduleBytes,
      );

      const transcript = await fnRunWidgetSdkFunctionConformance(
        (scenario) => createFunctionAdapter(scenario, serverArtifact),
      );
      expect(transcript).toEqual(WIDGET_SDK_FUNCTION_SCENARIOS.map(({ expected }) => expected));

      const providerTranscript = await fnRunWidgetSdkResourceProviderConformance(
        (scenario) => createArtifactResourceProviderAdapter(scenario, serverArtifact),
      );
      expect(providerTranscript).toHaveLength(WIDGET_SDK_RESOURCE_PROVIDER_SCENARIOS.reduce(
        (count, scenario) => count + scenario.steps.length,
        0,
      ));
    } finally {
      await runtime.dispose();
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});
