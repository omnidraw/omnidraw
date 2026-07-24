import { afterEach, describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IResourceGateway } from '@vibecanvas/resource-runtime';
import type {
  IFunctionControlStore,
  ISandboxDriver,
  IScheduler,
  TFunctionAttempt,
  TFunctionDefinition,
  TFunctionInvocationEnvelope,
  TInvocationLease,
  TInvocationRecord,
  TResourceWritePermit,
  TSandboxExecutionResult,
  TUsageMetrics,
} from '../src';
import {
  BunChildFunctionDescriptorExtractor,
  BunChildSandboxDriver,
  FunctionExecutor,
  InvocationResourceGateway,
  ResourceWriteCapabilityAuthority,
  JsonSchemaFunctionValidator,
  LocalFunctionDispatcher,
  type TBunChildProcessGroupController,
  fnCanonicalJson,
  fnFunctionArtifactAdmission,
  fnParseServerArtifactEnvelope,
} from '../src/local';
import { createBunChildCage } from '../src/local/BunChildLifecycle';

const roots: string[] = [];

const NO_DESCENDANT_PROCESS_GROUPS: TBunChildProcessGroupController = Object.freeze({
  signal: () => undefined,
  exists: () => false,
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const registration = {
  schemaVersion: 1 as const,
  effect: 'fn' as const,
  inputSchema: { type: 'object', required: ['value'], properties: { value: { type: 'string' } }, additionalProperties: false },
  outputSchema: { type: 'object', required: ['echo'], properties: { echo: { type: 'string' } }, additionalProperties: false },
  resources: [],
  limits: { timeoutMs: 500, memoryTier: 'small' as const, outputByteLimit: 1_024, logByteLimit: 1_024 },
  retry: { mode: 'none' as const, maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 },
};

function guestSource(extraExport = ''): string {
  return `
const registration = Object.freeze(${JSON.stringify(registration)});
const echo = async () => { throw new Error('use host entry'); };
Object.defineProperties(echo, {
  __vibecanvasServerFunction: { value: 'vibecanvas.server-function.v1', enumerable: false },
  __vibecanvasRegistration: { value: registration, enumerable: false },
  __vibecanvasExecute: { value: async (_context, input) => ({ echo: input.value }), enumerable: false },
});
Object.freeze(echo);
export { echo };
${extraExport}
`;
}

function subjectGuestSource(): string {
  return `
const registration = Object.freeze(${JSON.stringify(registration)});
const echo = async () => { throw new Error('use host entry'); };
Object.defineProperties(echo, {
  __vibecanvasServerFunction: { value: 'vibecanvas.server-function.v1', enumerable: false },
  __vibecanvasRegistration: { value: registration, enumerable: false },
  __vibecanvasExecute: {
    value: async (context) => ({
      echo: context.subject.widgetInstanceId,
    }),
    enumerable: false,
  },
});
Object.freeze(echo);
export { echo };
`;
}

function computedEscapeGuestSource(): string {
  return `
const registration = Object.freeze(${JSON.stringify(registration)});
const echo = async () => { throw new Error('use host entry'); };
Object.defineProperties(echo, {
  __vibecanvasServerFunction: { value: 'vibecanvas.server-function.v1', enumerable: false },
  __vibecanvasRegistration: { value: registration, enumerable: false },
  __vibecanvasExecute: {
    value: async () => {
      try {
        const AsyncConstructor = (async () => {}).constructor;
        const root = await AsyncConstructor('return this')();
        const ambientName = ['B', 'un'].join('');
        return { echo: typeof root[ambientName] };
      } catch (error) {
        return { echo: error instanceof Error ? error.name : 'blocked' };
      }
    },
    enumerable: false,
  },
});
Object.freeze(echo);
export { echo };
`;
}

function ambientAuthorityGuestSource(): string {
  return `
const registration = Object.freeze(${JSON.stringify(registration)});
const echo = async () => { throw new Error('use host entry'); };
Object.defineProperties(echo, {
  __vibecanvasServerFunction: { value: 'vibecanvas.server-function.v1', enumerable: false },
  __vibecanvasRegistration: { value: registration, enumerable: false },
  __vibecanvasExecute: {
    value: async () => {
      const failureName = async (run) => {
        try {
          await run();
          return 'escaped';
        } catch (error) {
          return error instanceof Error ? error.name : 'blocked';
        }
      };
      return { echo: [
        await failureName(() => Bun.file('/private/data.db')),
        await failureName(() => process.getBuiltinModule('node:fs')),
        await failureName(() => globalThis[['B', 'un'].join('')].spawn(['sh'])),
        await failureName(() => eval('1 + 1')),
        await failureName(() => Function('return this')()),
        typeof __vibecanvasHostBridge,
        typeof fetch,
      ].join('|') };
    },
    enumerable: false,
  },
});
Object.freeze(echo);
export { echo };
`;
}

function topLevelAllocationGuestSource(): string {
  return `
const topLevelAllocation = new Uint8Array(64 * 1024 * 1024);
topLevelAllocation.fill(1);
${guestSource()}
`;
}

function artifact(sourceText = guestSource()) {
  const source = Buffer.from(sourceText);
  const sourceDigest = createHash('sha256').update(source).digest('hex');
  const bytes = Buffer.from(JSON.stringify({
    format: 'vibecanvas.server-artifact.v1',
    kind: 'server',
    entry: 'server.ts',
    sourceDigestSha256: 'a'.repeat(64),
    builderIdentity: 'test-builder',
    runtimeAbi: 'bun-test-v1',
    outputs: [{
      path: 'output-0.js',
      loader: 'js',
      kind: 'entry-point',
      digestSha256: sourceDigest,
      bytesBase64: source.toString('base64'),
    }],
  }));
  return {
    sourceDigest,
    buildArtifact: {
      kind: 'server' as const,
      digestSha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: new Uint8Array(bytes),
      runtimeAbi: 'bun-test-v1',
    },
  };
}

const tenant = {
  orgId: 'org-a',
  accountId: 'account-a',
  cellId: 'cell-a',
  placementEpoch: 1,
  roles: ['member'],
  capabilities: [],
  requestId: 'request-a',
  invocationId: 'invocation-a',
} as const;

function definition(artifactDigestSha256: string): TFunctionDefinition {
  return {
    orgId: tenant.orgId,
    id: 'function-a',
    widgetDefinitionId: 'definition-a',
    widgetRevisionId: 'revision-a',
    name: 'echo',
    effect: 'fn',
    definitionRevision: 1,
    serverArtifactId: 'artifact-a',
    artifactDigestSha256,
    contractDigestSha256: 'b'.repeat(64),
    descriptorDigestSha256: 'c'.repeat(64),
    runtimeAbi: 'bun-test-v1',
    inputSchema: registration.inputSchema,
    outputSchema: registration.outputSchema,
    resources: [],
    limits: registration.limits,
    retry: registration.retry,
  };
}

function attempt(): TFunctionAttempt {
  return {
    id: 'attempt-a',
    invocationId: 'invocation-a',
    attemptNumber: 1,
    leaseEpoch: 1,
    status: 'starting',
    sandboxDriver: 'bun-child',
    memoryTier: 'small',
    failureOwner: null,
    failure: null,
    metrics: {
      activeWallMs: 0, cpuMs: 0, allocatedMemoryByteMs: 0, peakRssBytes: 0,
      diskReadBytes: 0, diskWriteBytes: 0, networkRxBytes: 0, networkTxBytes: 0,
    },
    outputByteSize: 0,
    logByteSize: 0,
    coldStart: true,
    billable: false,
    createdAtMs: 1,
    startedAtMs: null,
    guestCodeEnteredAtMs: null,
    finishedAtMs: null,
  };
}

function sandboxStartRequest(deadlineAtMs = Date.now() + 2_000) {
  return {
    deadlineAtMs,
    observeMetrics: () => undefined,
    enterGuestCode: async () => undefined,
  };
}

function envelope(definitionValue: TFunctionDefinition): TFunctionInvocationEnvelope {
  return {
    id: 'invocation-a',
    tenant,
    widgetDefinitionId: definitionValue.widgetDefinitionId,
    widgetRevisionId: definitionValue.widgetRevisionId,
    subject: {
      kind: 'widget_instance',
      canvasId: 'canvas-a',
      widgetInstanceId: 'instance-a',
    },
    functionId: definitionValue.id,
    functionName: definitionValue.name,
    definitionRevision: definitionValue.definitionRevision,
    artifactDigestSha256: definitionValue.artifactDigestSha256,
    contractDigestSha256: definitionValue.contractDigestSha256,
    runtimeAbi: definitionValue.runtimeAbi,
    input: { value: 'hello' },
    inputDigestSha256: 'd'.repeat(64),
    idempotencyKey: 'key-a',
    policyVersion: 1,
    priority: 0,
    limits: definitionValue.limits,
    retry: definitionValue.retry,
    createdAtMs: Date.now(),
    deadlineAtMs: Date.now() + 2_000,
  };
}

function invocationRecord(value: TFunctionInvocationEnvelope): TInvocationRecord {
  return {
    envelope: value,
    status: 'queued',
    output: null,
    failure: null,
    resultDigestSha256: null,
    outputByteSize: 0,
    logByteSize: 0,
    bodyState: 'full',
    retainsRevision: true,
    cancelRequestedAtMs: null,
    availableAtMs: value.createdAtMs,
    startedAtMs: null,
    finishedAtMs: null,
    bodiesCompactedAtMs: null,
  };
}

type TFaultWorkerMode =
  | 'crash-before-start'
  | 'crash-during-code'
  | 'hang'
  | 'large-output'
  | 'large-log';

function faultWorkerSpawn(
  mode: TFaultWorkerMode,
  hooks: Readonly<{ execute?(): void }> = {},
): typeof Bun.spawn {
  return ((_command: unknown, options: { ipc(message: unknown): void }) => {
    let settleExit!: (code: number) => void;
    let settled = false;
    const exited = new Promise<number>((resolve) => { settleExit = resolve; });
    const exit = (code: number) => {
      if (settled) return;
      settled = true;
      settleExit(code);
    };
    const process = {
      pid: 60_001,
      stdout: new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }),
      stderr: new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }),
      exited,
      send(message: { type: string; requestId?: string }) {
        if (message.type === 'load') {
          options.ipc({ type: 'loaded', requestId: message.requestId });
          return;
        }
        if (message.type !== 'execute') return;
        hooks.execute?.();
        if (mode === 'crash-during-code') {
          queueMicrotask(() => exit(17));
        } else if (mode === 'large-output') {
          options.ipc({
            type: 'result',
            requestId: message.requestId,
            output: { echo: 'x'.repeat(256) },
            outputByteSize: 1,
            metrics: {},
          });
        } else if (mode === 'large-log') {
          options.ipc({
            type: 'log',
            requestId: message.requestId,
            level: 'info',
            values: [{ message: 'x'.repeat(256) }],
            byteSize: 1,
          });
        }
      },
      kill() { exit(0); },
    };
    queueMicrotask(() => {
      if (mode === 'crash-before-start') exit(17);
      else options.ipc({ type: 'ready' });
    });
    return process;
  }) as unknown as typeof Bun.spawn;
}

function moduleEvaluationWorkerSpawn(hooks: Readonly<{
  evaluating(): void;
  killed(): void;
}>): typeof Bun.spawn {
  return ((_command: unknown, options: { ipc(message: unknown): void }) => {
    let settleExit!: (code: number) => void;
    let settled = false;
    const exited = new Promise<number>((resolve) => { settleExit = resolve; });
    const process = {
      pid: 60_002,
      stdout: new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }),
      stderr: new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }),
      exited,
      send(message: { type: string }) {
        if (message.type === 'load' || message.type === 'inspect') hooks.evaluating();
      },
      kill() {
        hooks.killed();
        if (!settled) {
          settled = true;
          settleExit(0);
        }
      },
    };
    queueMicrotask(() => options.ipc({ type: 'ready' }));
    return process;
  }) as unknown as typeof Bun.spawn;
}

function deadlineWorkerSpawn(hooks: Readonly<{
  afterSpawn?(): void;
  beforeReady?(): void;
  onSend?(message: Readonly<{ type: string; requestId?: string }>, emit: (message: unknown) => void): void;
  killed?(): void;
}>): typeof Bun.spawn {
  return ((_command: unknown, options: { ipc(message: unknown): void }) => {
    let settleExit!: (code: number) => void;
    let settled = false;
    const exited = new Promise<number>((resolve) => { settleExit = resolve; });
    const process = {
      pid: 60_003,
      stdout: new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }),
      stderr: new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }),
      exited,
      send(message: Readonly<{ type: string; requestId?: string }>) {
        hooks.onSend?.(message, options.ipc);
      },
      kill() {
        hooks.killed?.();
        if (settled) return;
        settled = true;
        settleExit(0);
      },
    };
    hooks.afterSpawn?.();
    queueMicrotask(() => {
      if (settled) return;
      hooks.beforeReady?.();
      options.ipc({ type: 'ready' });
    });
    return process;
  }) as unknown as typeof Bun.spawn;
}

async function runDriverFault(
  mode: Exclude<TFaultWorkerMode, 'crash-before-start'>,
  options: Readonly<{
    timeoutMs?: number;
    outputByteLimit?: number;
    logByteLimit?: number;
    readRssBytes?: () => Promise<number>;
    memoryLimitBytes?: number;
  }> = {},
): Promise<TSandboxExecutionResult> {
  const tempRoot = await mkdtemp(join(tmpdir(), `vibecanvas-driver-${mode}-`));
  roots.push(tempRoot);
  const built = artifact();
  const baseDefinition = definition(built.buildArtifact.digestSha256);
  const definitionValue: TFunctionDefinition = {
    ...baseDefinition,
    limits: {
      ...baseDefinition.limits,
      timeoutMs: options.timeoutMs ?? baseDefinition.limits.timeoutMs,
      outputByteLimit: options.outputByteLimit ?? baseDefinition.limits.outputByteLimit,
      logByteLimit: options.logByteLimit ?? baseDefinition.limits.logByteLimit,
    },
  };
  let executing = false;
  const readRssBytes = options.readRssBytes ?? (async () => 0);
  const driver = new BunChildSandboxDriver({
    tempRoot,
    spawn: faultWorkerSpawn(mode, { execute: () => { executing = true; } }),
    processGroups: NO_DESCENDANT_PROCESS_GROUPS,
    memorySampleMs: 1,
    memoryTierBytes: {
      small: options.memoryLimitBytes ?? 1_024,
      medium: 2_048,
      large: 4_096,
    },
    readRssBytes: async () => executing ? readRssBytes() : 0,
    readCpuMs: async () => 0,
  });
  const prepared = await driver.prepare({
    definition: definitionValue,
    artifact: built.buildArtifact.bytes,
  });
  const running = await driver.start(prepared, attempt(), sandboxStartRequest());
  try {
    return await driver.execute(running, {
      ...envelope(definitionValue),
      deadlineAtMs: Date.now() + 2_000,
    }, { call: async () => { throw new Error('unexpected resource call'); } });
  } finally {
    await driver.destroy(running);
    expect(driver.diagnostics().activeGuestCount).toBe(0);
  }
}

type TExecutorFaultState = {
  cancelRequested: boolean;
  prepareCalls: number;
  startAttemptCalls: number;
  guestEntryCalls: number;
  heartbeatCalls: number;
  heartbeatExpiries: number[];
  heartbeatMetrics: TUsageMetrics[];
  startCalls: number;
  executeCalls: number;
  cancelCalls: number;
  destroyCalls: number;
  completeCalls: number;
  resourceCommits: number;
  artifactRequests: Array<Record<string, unknown>>;
  completions: Array<Record<string, unknown>>;
  resolveExecution?: (result: TSandboxExecutionResult) => void;
};

function executorFaultFixture(hooks: Readonly<{
  claim?: () => unknown;
  startAttempt?: (state: TExecutorFaultState) => Promise<void> | void;
  enterGuestCode?: (state: TExecutorFaultState) => Promise<void> | void;
  heartbeat?: (state: TExecutorFaultState) => Promise<void> | void;
  start?: (
    state: TExecutorFaultState,
    observeMetrics: (metrics: TUsageMetrics) => void,
  ) => Promise<void> | void;
  execute?: (
    state: TExecutorFaultState,
    resources: IResourceGateway,
  ) => Promise<TSandboxExecutionResult> | TSandboxExecutionResult;
  cancel?: (state: TExecutorFaultState) => Promise<void> | void;
  destroy?: (state: TExecutorFaultState) => Promise<void> | void;
  complete?: (state: TExecutorFaultState) => Promise<unknown> | unknown;
  resourceCall?: (state: TExecutorFaultState) => Promise<unknown> | unknown;
}> = {}) {
  const definitionValue = definition('a'.repeat(64));
  const invocation = envelope(definitionValue);
  const attemptValue = attempt();
  let lease: TInvocationLease = {
    invocationId: invocation.id,
    attemptId: attemptValue.id,
    leaseEpoch: attemptValue.leaseEpoch,
    workerId: 'worker-a',
    heartbeatAtMs: 100,
    expiresAtMs: 120,
  };
  const state: TExecutorFaultState = {
    cancelRequested: false,
    prepareCalls: 0,
    startAttemptCalls: 0,
    guestEntryCalls: 0,
    heartbeatCalls: 0,
    heartbeatExpiries: [],
    heartbeatMetrics: [],
    startCalls: 0,
    executeCalls: 0,
    cancelCalls: 0,
    destroyCalls: 0,
    completeCalls: 0,
    resourceCommits: 0,
    artifactRequests: [],
    completions: [],
  };
  const store = {
    resolveFunctionForSubject: async () => definitionValue,
    claim: async () => hooks.claim?.() ?? ({ status: 'claimed' as const, attempt: attemptValue, lease }),
    getInvocation: async () => ({
      ...invocationRecord(invocation),
      cancelRequestedAtMs: state.cancelRequested ? 101 : null,
    }),
    startAttempt: async () => {
      state.startAttemptCalls += 1;
      await hooks.startAttempt?.(state);
      return {
        status: 'updated' as const,
        attempt: { ...attemptValue, status: 'running' as const },
        lease,
      };
    },
    enterGuestCode: async () => {
      state.guestEntryCalls += 1;
      await hooks.enterGuestCode?.(state);
      return {
        status: 'updated' as const,
        attempt: {
          ...attemptValue,
          status: 'running' as const,
          startedAtMs: 101,
          guestCodeEnteredAtMs: 102,
        },
        lease,
      };
    },
    heartbeat: async (_tenant: unknown, request: Readonly<{
      metrics: TUsageMetrics;
      nowMs: number;
      ttlMs: number;
    }>) => {
      state.heartbeatCalls += 1;
      state.heartbeatMetrics.push(request.metrics);
      await hooks.heartbeat?.(state);
      lease = {
        ...lease,
        heartbeatAtMs: request.nowMs,
        expiresAtMs: request.nowMs + request.ttlMs,
      };
      state.heartbeatExpiries.push(lease.expiresAtMs);
      return { status: 'updated' as const, attempt: attemptValue, lease };
    },
    completeAttempt: async (_tenant: unknown, request: Record<string, unknown>) => {
      state.completeCalls += 1;
      state.completions.push(request);
      return await (hooks.complete?.(state) ?? { status: 'stale' as const });
    },
    expireWritePermits: async () => 0,
  } as unknown as IFunctionControlStore;
  const handle = Object.freeze({ driver: 'fault-driver', id: 'fault-handle' });
  const driver: ISandboxDriver = {
    name: 'fault-driver',
    prepare: async () => {
      state.prepareCalls += 1;
      return handle;
    },
    start: async (_prepared, _attempt, request) => {
      state.startCalls += 1;
      await request.enterGuestCode();
      await hooks.start?.(state, request.observeMetrics);
      return handle;
    },
    execute: async (_running, _envelope, resources) => {
      state.executeCalls += 1;
      return await (hooks.execute?.(state, resources) ?? {
        status: 'succeeded' as const,
        output: { echo: 'hello' },
        outputByteSize: 16,
        logByteSize: 0,
      });
    },
    measure: async () => ({
      activeWallMs: 1, cpuMs: 0, allocatedMemoryByteMs: 1, peakRssBytes: 1,
      diskReadBytes: 0, diskWriteBytes: 0, networkRxBytes: 0, networkTxBytes: 0,
    }),
    cancel: async () => {
      state.cancelCalls += 1;
      await hooks.cancel?.(state);
    },
    reset: async () => undefined,
    destroy: async () => {
      state.destroyCalls += 1;
      await hooks.destroy?.(state);
    },
  };
  const executor = new FunctionExecutor({
    workerId: 'worker-a',
    store,
    artifacts: {
      readExactServerArtifact: async (_tenant, request) => {
        state.artifactRequests.push(request as Record<string, unknown>);
        return new Uint8Array([1]);
      },
    },
    resources: {
      createInvocationResourceGateway: async () => ({
        call: async () => {
          state.resourceCommits += 1;
          return {
            output: await hooks.resourceCall?.(state),
            receipt: {
              operationId: `${invocation.id}:0`,
              resourceId: 'resource-a',
              effect: 'write' as const,
              committed: true,
            },
          };
        },
      }),
    },
    driver,
    schemas: new JsonSchemaFunctionValidator(),
    leaseTtlMs: 20,
    heartbeatMs: 1,
    completionRetryMs: 1,
    nowMs: (() => {
      let value = 100;
      return () => ++value;
    })(),
    createAttemptId: () => attemptValue.id,
  });
  return { executor, state, invocation, definitionValue };
}

describe('local short-lived function runtime', () => {
  test('accepts only the dedicated version 1 server artifact format', () => {
    const built = artifact();
    const envelope = fnParseServerArtifactEnvelope({
      text: Buffer.from(built.buildArtifact.bytes).toString('utf8'),
      expectedRuntimeAbi: 'bun-test-v1',
    });
    expect(envelope.format).toBe('vibecanvas.server-artifact.v1');

    const unsupported = {
      ...JSON.parse(Buffer.from(built.buildArtifact.bytes).toString('utf8')),
      format: 'vibecanvas.server-artifact.v0',
    };
    expect(() => fnParseServerArtifactEnvelope({
      text: JSON.stringify(unsupported),
      expectedRuntimeAbi: 'bun-test-v1',
    })).toThrow('dedicated version 1 server artifact');
  });

  test('canonicalizes semantic JSON and rejects non-JSON values', () => {
    expect(fnCanonicalJson({ b: 2, a: { z: true, y: [1, null] } })).toBe(
      fnCanonicalJson({ a: { y: [1, null], z: true }, b: 2 }),
    );
    expect(() => fnCanonicalJson({ value: undefined })).toThrow();
    expect(() => fnCanonicalJson({ value: 1n })).toThrow();
    expect(() => fnCanonicalJson({ value: Number.NaN })).toThrow();
    const sparse: unknown[] = [];
    sparse.length = 1;
    expect(() => fnCanonicalJson(sparse)).toThrow(/sparse/i);
    expect(fnCanonicalJson([])).toBe('[]');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => fnCanonicalJson(cyclic)).toThrow();
  });

  test('rejects explicit durable continuation APIs and bounds trusted JSON schemas', () => {
    expect(fnFunctionArtifactAdmission('await Bun.sleep(1000)')).toEqual({ allowed: false, token: 'Bun.sleep' });
    for (const [source, token] of [
      ['Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0)', 'Atomics.wait'],
      ['waitUntil(Promise.resolve())', 'waitUntil'],
      ['checkpoint()', 'checkpoint'],
      ['scheduleAfter(100)', 'schedule'],
      ["await import('node:fs')", 'dynamic import'],
      ["require('node:child_process').spawn('sh')", 'require'],
      ["import.meta.resolve('node:fs')", 'import.meta'],
      ["import fs from 'node:fs'", 'static import'],
    ] as const) {
      expect(fnFunctionArtifactAdmission(source)).toEqual({ allowed: false, token });
    }
    const schemas = new JsonSchemaFunctionValidator({ maxSchemaDepth: 8 });
    expect(schemas.validate(registration.inputSchema, { value: 'ok' })).toEqual({ valid: true });
    expect(schemas.validate(registration.inputSchema, { value: 3 }).valid).toBe(false);
    expect(schemas.validate({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['value'],
      properties: { value: { type: 'string' } },
      additionalProperties: false,
    }, { value: 'zod-compatible' })).toEqual({ valid: true });
  });

  test('fault matrix: stale write permit invalidates an already-issued capability', async () => {
    let permit: TResourceWritePermit = {
      orgId: tenant.orgId,
      id: 'permit-a',
      resourceId: 'resource-a',
      invocationId: tenant.invocationId,
      attemptId: 'attempt-a',
      leaseEpoch: 1,
      operationName: 'set',
      operationId: `${tenant.invocationId}:0`,
      operationFingerprintSha256: 'e'.repeat(64),
      status: 'active',
      result: null,
      resultDigestSha256: null,
      issuedAtMs: 100,
      expiresAtMs: 200,
      consumedAtMs: null,
    };
    const authority = new ResourceWriteCapabilityAuthority({
      secret: new Uint8Array(32).fill(7),
      permits: {
        getWritePermit: async () => permit,
      } as unknown as IFunctionControlStore,
      nowMs: () => 101,
      createNonce: () => 'nonce-a',
    });
    const capability = await authority.issueWriteCapability(tenant, permit);
    expect(await authority.verifyWriteCapability(tenant, capability)).toMatchObject({
      permitId: permit.id,
      operationId: permit.operationId,
    });
    permit = { ...permit, status: 'expired' };
    expect(await authority.verifyWriteCapability(tenant, capability)).toBeNull();
  });

  test('resource writes use the heartbeat-renewed lease after the initial TTL', async () => {
    const definitionValue: TFunctionDefinition = {
      ...definition('a'.repeat(64)),
      effect: 'tx',
      resources: [{ slot: 'store', effect: 'write' }],
    };
    const invocation = envelope(definitionValue);
    const attemptValue = attempt();
    let nowMs = 100;
    let liveLease: TInvocationLease = {
      invocationId: invocation.id,
      attemptId: attemptValue.id,
      leaseEpoch: attemptValue.leaseEpoch,
      workerId: 'worker-a',
      heartbeatAtMs: nowMs,
      expiresAtMs: 110,
    };
    const acquired: Array<Record<string, unknown>> = [];
    const gateway = new InvocationResourceGateway({
      tenant,
      definition: definitionValue,
      envelope: invocation,
      attempt: attemptValue,
      getLease: () => liveLease,
      gateway: {
        call: async (_tenant, call) => ({
          output: { committed: true },
          receipt: {
            operationId: call.operationId!,
            resourceId: 'resource-a',
            effect: 'write',
            committed: true,
          },
        }),
      },
      bindings: {
        resolveBinding: async () => ({
          slot: 'store',
          resourceId: 'resource-a',
          kind: 'kv',
          allowRead: false,
          allowWrite: true,
        }),
      },
      permits: {
        acquireWritePermit: async (
          _tenant: Parameters<IFunctionControlStore['acquireWritePermit']>[0],
          request: Parameters<IFunctionControlStore['acquireWritePermit']>[1],
        ) => {
          acquired.push(request as unknown as Record<string, unknown>);
          return {
            status: 'acquired' as const,
            permit: {
              orgId: tenant.orgId,
              id: request.id,
              resourceId: request.resourceId,
              invocationId: request.invocationId,
              attemptId: request.attemptId,
              leaseEpoch: request.leaseEpoch,
              operationName: request.operationName,
              operationId: request.operationId,
              operationFingerprintSha256: request.operationFingerprintSha256,
              status: 'active' as const,
              result: null,
              resultDigestSha256: null,
              issuedAtMs: request.nowMs,
              expiresAtMs: request.nowMs + request.ttlMs,
              consumedAtMs: null,
            },
          };
        },
      } as unknown as IFunctionControlStore,
      writeCapabilities: { issueWriteCapability: async () => 'host-issued-capability' },
      writePermitTtlMs: 50,
      nowMs: () => nowMs,
      createPermitId: () => 'permit-a',
    });

    nowMs = 111;
    liveLease = { ...liveLease, heartbeatAtMs: 111, expiresAtMs: 200 };
    await expect(gateway.call(tenant, {
      slot: 'store',
      operation: 'set',
      effect: 'write',
      input: { value: 1 },
    })).resolves.toMatchObject({ output: { committed: true } });
    expect(acquired).toEqual([expect.objectContaining({
      attemptId: attemptValue.id,
      leaseEpoch: liveLease.leaseEpoch,
      nowMs: 111,
      ttlMs: 50,
    })]);
    const firstFingerprint = acquired[0]?.operationFingerprintSha256;
    await gateway.call(tenant, {
      slot: 'store', operation: 'set', effect: 'write', input: { value: 1 },
    });
    expect(acquired[1]?.operationFingerprintSha256).toBe(firstFingerprint);
    await gateway.call(tenant, {
      slot: 'store', operation: 'set', effect: 'write', input: { type: 'bigint', value: '1' },
    });
    await gateway.call(tenant, {
      slot: 'store', operation: 'set', effect: 'write', input: 1n,
    });
    expect(acquired[2]?.operationFingerprintSha256)
      .not.toBe(acquired[3]?.operationFingerprintSha256);
    const sparse: unknown[] = [];
    sparse.length = 1;
    await expect(gateway.call(tenant, {
      slot: 'store', operation: 'set', effect: 'write', input: sparse,
    })).rejects.toThrow(/sparse arrays/i);
  });

  test('extracts only registered named exports inside a bounded child', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vibecanvas-extractor-test-'));
    roots.push(tempRoot);
    const valid = artifact();
    const extractor = new BunChildFunctionDescriptorExtractor({ tempRoot, timeoutMs: 2_000 });
    const descriptors = await extractor.extractServerFunctionDescriptors(tenant, {
      serverArtifact: valid.buildArtifact,
      serverEntry: 'server.ts',
      runtimeAbi: 'bun-test-v1',
    });
    expect(descriptors).toEqual([{ ...registration, exportName: 'echo' }]);
    expect(extractor.diagnostics()).toEqual({
      activeGuestCount: 0,
      activeGuestPids: [],
      activeGuestProcessGroupIds: [],
      teardownFailures: [],
    });
    expect(await readdir(tempRoot)).toEqual([]);

    const invalid = artifact(guestSource('export const sideValue = 1;'));
    await expect(extractor.extractServerFunctionDescriptors(tenant, {
      serverArtifact: invalid.buildArtifact,
      serverEntry: 'server.ts',
      runtimeAbi: 'bun-test-v1',
    })).rejects.toThrow("export 'sideValue'");
    expect(extractor.diagnostics().activeGuestCount).toBe(0);
  });

  test('executes one exact revision and tears down to zero PID/RSS/cwd', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vibecanvas-driver-test-'));
    roots.push(tempRoot);
    const built = artifact();
    const definitionValue = definition(built.buildArtifact.digestSha256);
    const driver = new BunChildSandboxDriver({
      tempRoot,
      startupTimeoutMs: 2_000,
      readRssBytes: async () => 1_024,
    });
    const prepared = await driver.prepare({ definition: definitionValue, artifact: built.buildArtifact.bytes });
    const running = await driver.start(prepared, attempt(), sandboxStartRequest());
    const resources: IResourceGateway = { call: async () => { throw new Error('fn must not call resources'); } };
    const result = await driver.execute(running, envelope(definitionValue), resources);
    expect(result).toEqual({
      status: 'succeeded',
      output: { echo: 'hello' },
      outputByteSize: Buffer.byteLength(JSON.stringify({ echo: 'hello' })),
      logByteSize: 0,
    });
    await driver.destroy(running);
    expect(driver.diagnostics()).toEqual({
      warmTtlMs: 0,
      preparedInvocationCount: 0,
      activeGuestCount: 0,
      activeGuestPids: [],
      activeGuestProcessGroupIds: [],
      activeGuestRssBytes: 0,
      teardownFailures: [],
    });
    expect(await readdir(tempRoot)).toEqual([]);
  });

  test('exposes the immutable widget instance subject inside the guest SDK context', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vibecanvas-driver-widget-subject-'));
    roots.push(tempRoot);
    const built = artifact(subjectGuestSource());
    const definitionValue = {
      ...definition(built.buildArtifact.digestSha256),
      widgetRevisionId: 'widget-revision-a',
    };
    const driver = new BunChildSandboxDriver({
      tempRoot,
      startupTimeoutMs: 2_000,
      readRssBytes: async () => 1_024,
    });
    const prepared = await driver.prepare({
      definition: definitionValue,
      artifact: built.buildArtifact.bytes,
    });
    const running = await driver.start(prepared, attempt(), sandboxStartRequest());
    const result = await driver.execute(running, {
      ...envelope(definitionValue),
      subject: {
        kind: 'widget_instance',
        canvasId: 'canvas-a',
        widgetInstanceId: 'widget-a',
      },
    }, { call: async () => { throw new Error('fn must not call resources'); } });
    expect(result).toMatchObject({
      status: 'succeeded',
      output: { echo: 'widget-a' },
    });
    await driver.destroy(running);
    expect(driver.diagnostics().activeGuestCount).toBe(0);
  });

  test('guest VM blocks a computed constructor escape to ambient Bun authority', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vibecanvas-driver-vm-escape-'));
    roots.push(tempRoot);
    const built = artifact(computedEscapeGuestSource());
    const definitionValue = definition(built.buildArtifact.digestSha256);
    const driver = new BunChildSandboxDriver({
      tempRoot,
      startupTimeoutMs: 2_000,
      readRssBytes: async () => 1_024,
      readCpuMs: async () => 1,
    });
    const prepared = await driver.prepare({
      definition: definitionValue,
      artifact: built.buildArtifact.bytes,
    });
    const running = await driver.start(prepared, attempt(), sandboxStartRequest());
    const result = await driver.execute(
      running,
      envelope(definitionValue),
      { call: async () => { throw new Error('unexpected resource call'); } },
    );
    expect(result).toMatchObject({ status: 'succeeded', output: { echo: 'EvalError' } });
    await driver.destroy(running);
    expect(driver.diagnostics()).toMatchObject({
      activeGuestCount: 0,
      activeGuestProcessGroupIds: [],
      teardownFailures: [],
    });
  });

  test('guest VM removes direct ambient authority and disables string code generation', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vibecanvas-driver-vm-authority-'));
    roots.push(tempRoot);
    const built = artifact(ambientAuthorityGuestSource());
    const definitionValue = definition(built.buildArtifact.digestSha256);
    const driver = new BunChildSandboxDriver({
      tempRoot,
      startupTimeoutMs: 2_000,
      readRssBytes: async () => 1_024,
      readCpuMs: async () => 1,
    });
    const prepared = await driver.prepare({
      definition: definitionValue,
      artifact: built.buildArtifact.bytes,
    });
    const running = await driver.start(prepared, attempt(), sandboxStartRequest());
    const result = await driver.execute(
      running,
      envelope(definitionValue),
      { call: async () => { throw new Error('unexpected resource call'); } },
    );
    expect(result).toMatchObject({
      status: 'succeeded',
      output: {
        echo: 'ReferenceError|ReferenceError|TypeError|EvalError|EvalError|undefined|undefined',
      },
    });
    await driver.destroy(running);
    expect(driver.diagnostics()).toMatchObject({
      activeGuestCount: 0,
      activeGuestProcessGroupIds: [],
      teardownFailures: [],
    });
  });

  test('memory watchdog rejects top-level allocation during module evaluation and leaves zero guests', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vibecanvas-driver-load-memory-'));
    roots.push(tempRoot);
    let evaluating = false;
    let killCalls = 0;
    const built = artifact(topLevelAllocationGuestSource());
    const definitionValue = definition(built.buildArtifact.digestSha256);
    const driver = new BunChildSandboxDriver({
      tempRoot,
      spawn: moduleEvaluationWorkerSpawn({
        evaluating: () => { evaluating = true; },
        killed: () => { killCalls += 1; },
      }),
      processGroups: NO_DESCENDANT_PROCESS_GROUPS,
      memorySampleMs: 1,
      memoryTierBytes: { small: 32, medium: 64, large: 128 },
      readRssBytes: async () => evaluating ? 33 : 0,
      readCpuMs: async () => 0,
      cancelGraceMs: 1,
    });
    const prepared = await driver.prepare({
      definition: definitionValue,
      artifact: built.buildArtifact.bytes,
    });
    await expect(driver.start(prepared, attempt(), sandboxStartRequest())).rejects.toMatchObject({
      code: 'FUNCTION_MEMORY_LIMIT',
    });
    expect(killCalls).toBeGreaterThan(0);
    expect(driver.diagnostics()).toMatchObject({
      activeGuestCount: 0,
      activeGuestPids: [],
      activeGuestProcessGroupIds: [],
      teardownFailures: [],
    });
    expect(await readdir(tempRoot)).toEqual([]);
  });

  test('publishes host-accounted metrics while guest module evaluation is pending', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vibecanvas-driver-startup-metrics-'));
    roots.push(tempRoot);
    const built = artifact();
    const definitionValue = definition(built.buildArtifact.digestSha256);
    const observedDuringModuleEvaluation: TUsageMetrics[] = [];
    let nowMs = 100;
    let moduleEvaluationPending = false;
    let releaseModuleEvaluation!: () => void;
    let markModuleEvaluationPending!: () => void;
    const moduleEvaluationStarted = new Promise<void>((resolve) => {
      markModuleEvaluationPending = resolve;
    });
    const driver = new BunChildSandboxDriver({
      tempRoot,
      nowMs: () => ++nowMs,
      spawn: deadlineWorkerSpawn({
        onSend: (message, emit) => {
          if (message.type !== 'load') return;
          moduleEvaluationPending = true;
          releaseModuleEvaluation = () => emit({ type: 'loaded', requestId: message.requestId });
          markModuleEvaluationPending();
        },
      }),
      processGroups: NO_DESCENDANT_PROCESS_GROUPS,
      readRssBytes: async () => 321,
      readCpuMs: async () => 9,
      memorySampleMs: 1,
      cancelGraceMs: 1,
    });
    const prepared = await driver.prepare({
      definition: definitionValue,
      artifact: built.buildArtifact.bytes,
    });
    const starting = driver.start(prepared, attempt(), {
      deadlineAtMs: 10_000,
      observeMetrics: (metrics) => {
        if (moduleEvaluationPending) observedDuringModuleEvaluation.push(metrics);
      },
      enterGuestCode: async () => undefined,
    });
    await moduleEvaluationStarted;
    for (let index = 0; index < 50; index += 1) {
      if (observedDuringModuleEvaluation.some((metrics) => (
        metrics.activeWallMs > 0
        && metrics.cpuMs === 9
        && metrics.allocatedMemoryByteMs > 0
        && metrics.peakRssBytes === 321
      ))) break;
      await Bun.sleep(1);
    }
    moduleEvaluationPending = false;
    releaseModuleEvaluation();
    const running = await starting;
    await driver.destroy(running);
    expect(observedDuringModuleEvaluation).toContainEqual(expect.objectContaining({
      cpuMs: 9,
      peakRssBytes: 321,
    }));
    expect(observedDuringModuleEvaluation.some((metrics) => (
      metrics.activeWallMs > 0 && metrics.allocatedMemoryByteMs > 0
    ))).toBe(true);
    expect(driver.diagnostics().activeGuestCount).toBe(0);
    expect(await readdir(tempRoot)).toEqual([]);
  });

  test('descriptor extraction bounds top-level allocation and leaves zero guests', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vibecanvas-extractor-load-memory-'));
    roots.push(tempRoot);
    let evaluating = false;
    let killCalls = 0;
    const built = artifact(topLevelAllocationGuestSource());
    const extractor = new BunChildFunctionDescriptorExtractor({
      tempRoot,
      spawn: moduleEvaluationWorkerSpawn({
        evaluating: () => { evaluating = true; },
        killed: () => { killCalls += 1; },
      }),
      processGroups: NO_DESCENDANT_PROCESS_GROUPS,
      timeoutMs: 1_000,
      memoryLimitBytes: 32,
      memorySampleMs: 1,
      readRssBytes: async () => evaluating ? 33 : 0,
      cancelGraceMs: 1,
    });
    await expect(extractor.extractServerFunctionDescriptors(tenant, {
      serverArtifact: built.buildArtifact,
      serverEntry: 'server.ts',
      runtimeAbi: 'bun-test-v1',
    })).rejects.toMatchObject({ code: 'FUNCTION_MEMORY_LIMIT' });
    expect(killCalls).toBeGreaterThan(0);
    expect(extractor.diagnostics()).toEqual({
      activeGuestCount: 0,
      activeGuestPids: [],
      activeGuestProcessGroupIds: [],
      teardownFailures: [],
    });
    expect(await readdir(tempRoot)).toEqual([]);
  });

  test('guest-entry marker failure tears down without sending module bytes', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vibecanvas-driver-entry-marker-'));
    roots.push(tempRoot);
    let loadCalls = 0;
    let killCalls = 0;
    const built = artifact();
    const driver = new BunChildSandboxDriver({
      tempRoot,
      spawn: deadlineWorkerSpawn({
        onSend: (message) => { if (message.type === 'load') loadCalls += 1; },
        killed: () => { killCalls += 1; },
      }),
      processGroups: NO_DESCENDANT_PROCESS_GROUPS,
      readRssBytes: async () => 0,
      readCpuMs: async () => 0,
      cancelGraceMs: 1,
      startupTimeoutMs: 20_000,
    });
    const prepared = await driver.prepare({
      definition: definition(built.buildArtifact.digestSha256),
      artifact: built.buildArtifact.bytes,
    });
    await expect(driver.start(prepared, attempt(), {
      deadlineAtMs: Date.now() + 2_000,
      observeMetrics: () => undefined,
      enterGuestCode: async () => { throw new Error('durable marker unavailable'); },
    })).rejects.toThrow(/durable marker unavailable/i);
    expect(loadCalls).toBe(0);
    expect(killCalls).toBeGreaterThan(0);
    expect(driver.diagnostics()).toMatchObject({
      activeGuestCount: 0,
      activeGuestPids: [],
      activeGuestProcessGroupIds: [],
      teardownFailures: [],
    });
    expect(await readdir(tempRoot)).toEqual([]);
  });

  test('a legal 1ms startup deadline is bounded and leaves zero guests', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vibecanvas-driver-deadline-'));
    roots.push(tempRoot);
    let nowMs = 100;
    let guestEntryCalls = 0;
    let loadCalls = 0;
    let killCalls = 0;
    const built = artifact();
    const driver = new BunChildSandboxDriver({
      tempRoot,
      nowMs: () => nowMs,
      spawn: deadlineWorkerSpawn({
        onSend: (message) => {
          if (message.type !== 'load') return;
          loadCalls += 1;
        },
        killed: () => { killCalls += 1; },
      }),
      processGroups: NO_DESCENDANT_PROCESS_GROUPS,
      readRssBytes: async () => 0,
      readCpuMs: async () => 0,
      cancelGraceMs: 1,
      startupTimeoutMs: 20_000,
    });
    const prepared = await driver.prepare({
      definition: definition(built.buildArtifact.digestSha256),
      artifact: built.buildArtifact.bytes,
    });
    await expect(driver.start(prepared, attempt(), {
      deadlineAtMs: 101,
      observeMetrics: () => undefined,
      enterGuestCode: async () => { guestEntryCalls += 1; },
    })).rejects.toMatchObject({ code: 'FUNCTION_TIMED_OUT' });
    // A one-millisecond budget may expire at any startup checkpoint. It must
    // never cross either boundary more than once or leave a live guest.
    expect(guestEntryCalls).toBeLessThanOrEqual(1);
    expect(loadCalls).toBeLessThanOrEqual(1);
    // The budget may expire before spawn, in which case cage cleanup is the
    // complete teardown and no child signal is necessary.
    expect(killCalls).toBeLessThanOrEqual(1);
    expect(driver.diagnostics()).toMatchObject({
      preparedInvocationCount: 0,
      activeGuestCount: 0,
      activeGuestPids: [],
      activeGuestProcessGroupIds: [],
      teardownFailures: [],
    });
    expect(await readdir(tempRoot)).toEqual([]);
  });

  test('awaits verified removal of a cage created after the startup timeout', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vibecanvas-driver-late-cage-'));
    roots.push(tempRoot);
    let releaseCageCreation!: () => void;
    const cageCreationGate = new Promise<void>((resolve) => { releaseCageCreation = resolve; });
    let markCageCreated!: () => void;
    const cageCreated = new Promise<void>((resolve) => { markCageCreated = resolve; });
    let spawnCalls = 0;
    const built = artifact();
    const driver = new BunChildSandboxDriver({
      tempRoot,
      nowMs: () => 100,
      createCage: async (root) => {
        const cage = await createBunChildCage(root);
        markCageCreated();
        await cageCreationGate;
        return cage;
      },
      spawn: deadlineWorkerSpawn({ afterSpawn: () => { spawnCalls += 1; } }),
      processGroups: NO_DESCENDANT_PROCESS_GROUPS,
      startupTimeoutMs: 20_000,
    });
    const prepared = await driver.prepare({
      definition: definition(built.buildArtifact.digestSha256),
      artifact: built.buildArtifact.bytes,
    });
    const starting = driver.start(prepared, attempt(), {
      deadlineAtMs: 101,
      observeMetrics: () => undefined,
      enterGuestCode: async () => undefined,
    });
    const outcome = starting.then(
      (value) => ({ status: 'resolved' as const, value }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    );
    await Promise.race([
      cageCreated,
      Bun.sleep(1_000).then(() => { throw new Error('Late test cage was not created.'); }),
    ]);
    await Bun.sleep(10);
    releaseCageCreation();
    const settled = await Promise.race([
      outcome,
      Bun.sleep(1_000).then(() => { throw new Error('Timed-out cage startup did not settle.'); }),
    ]);
    expect(settled).toMatchObject({
      status: 'rejected',
      error: { code: 'FUNCTION_TIMED_OUT' },
    });
    expect(spawnCalls).toBe(0);
    expect(driver.diagnostics()).toMatchObject({
      preparedInvocationCount: 0,
      activeGuestCount: 0,
      activeGuestPids: [],
      activeGuestProcessGroupIds: [],
      teardownFailures: [],
    });
    expect(await readdir(tempRoot)).toEqual([]);
  });

  test('loaded IPC at the exact startup boundary loses and leaves zero guests', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vibecanvas-driver-loaded-deadline-'));
    roots.push(tempRoot);
    let nowMs = 100;
    let guestEntryCalls = 0;
    let loadCalls = 0;
    let killCalls = 0;
    const built = artifact();
    const driver = new BunChildSandboxDriver({
      tempRoot,
      nowMs: () => nowMs,
      spawn: deadlineWorkerSpawn({
        onSend: (message, emit) => {
          if (message.type !== 'load') return;
          loadCalls += 1;
          nowMs = 10_100;
          emit({ type: 'loaded', requestId: message.requestId });
        },
        killed: () => { killCalls += 1; },
      }),
      processGroups: NO_DESCENDANT_PROCESS_GROUPS,
      readRssBytes: async () => 0,
      readCpuMs: async () => 0,
      cancelGraceMs: 1,
      startupTimeoutMs: 20_000,
    });
    const prepared = await driver.prepare({
      definition: definition(built.buildArtifact.digestSha256),
      artifact: built.buildArtifact.bytes,
    });
    await expect(driver.start(prepared, attempt(), {
      deadlineAtMs: 10_100,
      observeMetrics: () => undefined,
      enterGuestCode: async () => { guestEntryCalls += 1; },
    })).rejects.toMatchObject({ code: 'FUNCTION_TIMED_OUT' });
    expect(guestEntryCalls).toBe(1);
    expect(loadCalls).toBe(1);
    expect(killCalls).toBeGreaterThan(0);
    expect(driver.diagnostics()).toMatchObject({
      preparedInvocationCount: 0,
      activeGuestCount: 0,
      activeGuestPids: [],
      activeGuestProcessGroupIds: [],
      teardownFailures: [],
    });
    expect(await readdir(tempRoot)).toEqual([]);
  });

  test('a guest marker resolving at the exact boundary sends no module bytes', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vibecanvas-driver-marker-deadline-'));
    roots.push(tempRoot);
    let nowMs = 100;
    let loadCalls = 0;
    let killCalls = 0;
    const built = artifact();
    const driver = new BunChildSandboxDriver({
      tempRoot,
      nowMs: () => nowMs,
      spawn: deadlineWorkerSpawn({
        onSend: (message) => { if (message.type === 'load') loadCalls += 1; },
        killed: () => { killCalls += 1; },
      }),
      processGroups: NO_DESCENDANT_PROCESS_GROUPS,
      readRssBytes: async () => 0,
      readCpuMs: async () => 0,
      cancelGraceMs: 1,
      startupTimeoutMs: 20_000,
    });
    const prepared = await driver.prepare({
      definition: definition(built.buildArtifact.digestSha256),
      artifact: built.buildArtifact.bytes,
    });
    await expect(driver.start(prepared, attempt(), {
      deadlineAtMs: 10_100,
      observeMetrics: () => undefined,
      enterGuestCode: async () => { nowMs = 10_100; },
    })).rejects.toMatchObject({ code: 'FUNCTION_TIMED_OUT' });
    expect(loadCalls).toBe(0);
    expect(killCalls).toBeGreaterThan(0);
    expect(driver.diagnostics()).toMatchObject({
      activeGuestCount: 0,
      activeGuestPids: [],
      activeGuestProcessGroupIds: [],
      teardownFailures: [],
    });
    expect(await readdir(tempRoot)).toEqual([]);
  });

  test('exact descriptor inspection deadline wins over synchronous success and leaves zero guests', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vibecanvas-extractor-deadline-'));
    roots.push(tempRoot);
    let nowMs = 100;
    let inspectCalls = 0;
    let killCalls = 0;
    const built = artifact();
    const extractor = new BunChildFunctionDescriptorExtractor({
      tempRoot,
      nowMs: () => nowMs,
      timeoutMs: 10_000,
      spawn: deadlineWorkerSpawn({
        onSend: (message, emit) => {
          if (message.type !== 'inspect') return;
          inspectCalls += 1;
          nowMs = 10_100;
          emit({ type: 'inspected', requestId: message.requestId, descriptors: [] });
        },
        killed: () => { killCalls += 1; },
      }),
      processGroups: NO_DESCENDANT_PROCESS_GROUPS,
      readRssBytes: async () => 0,
      cancelGraceMs: 1,
    });
    await expect(extractor.extractServerFunctionDescriptors(tenant, {
      serverArtifact: built.buildArtifact,
      serverEntry: 'server.ts',
      runtimeAbi: 'bun-test-v1',
    })).rejects.toMatchObject({ code: 'FUNCTION_TIMED_OUT' });
    expect(inspectCalls).toBe(1);
    expect(killCalls).toBeGreaterThan(0);
    expect(extractor.diagnostics()).toEqual({
      activeGuestCount: 0,
      activeGuestPids: [],
      activeGuestProcessGroupIds: [],
      teardownFailures: [],
    });
    expect(await readdir(tempRoot)).toEqual([]);
  });

  test('destroy escalates to the detached process group when a descendant survives TERM', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vibecanvas-driver-descendant-'));
    roots.push(tempRoot);
    const signals: NodeJS.Signals[] = [];
    let groupAlive = true;
    const processGroups: TBunChildProcessGroupController = {
      signal: (_processGroupId, signal) => {
        signals.push(signal);
        if (signal === 'SIGKILL') groupAlive = false;
      },
      exists: () => groupAlive,
    };
    const built = artifact();
    const definitionValue = definition(built.buildArtifact.digestSha256);
    const driver = new BunChildSandboxDriver({
      tempRoot,
      spawn: faultWorkerSpawn('hang'),
      processGroups,
      cancelGraceMs: 1,
    });
    const prepared = await driver.prepare({
      definition: definitionValue,
      artifact: built.buildArtifact.bytes,
    });
    const running = await driver.start(prepared, attempt(), sandboxStartRequest());
    await driver.destroy(running);
    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(driver.diagnostics()).toMatchObject({
      activeGuestCount: 0,
      activeGuestPids: [],
      activeGuestProcessGroupIds: [],
      teardownFailures: [],
    });
    expect(await readdir(tempRoot)).toEqual([]);
  });

  test('surviving process groups remain visible after destroy rejects', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vibecanvas-driver-teardown-failure-'));
    roots.push(tempRoot);
    const processGroups: TBunChildProcessGroupController = {
      signal: () => undefined,
      exists: () => true,
    };
    const built = artifact();
    const definitionValue = definition(built.buildArtifact.digestSha256);
    const driver = new BunChildSandboxDriver({
      tempRoot,
      spawn: faultWorkerSpawn('hang'),
      processGroups,
      cancelGraceMs: 1,
    });
    const prepared = await driver.prepare({
      definition: definitionValue,
      artifact: built.buildArtifact.bytes,
    });
    const running = await driver.start(prepared, attempt(), sandboxStartRequest());
    await expect(driver.destroy(running)).rejects.toThrow(/process group 60001 survived SIGKILL/i);
    expect(driver.diagnostics()).toMatchObject({
      activeGuestCount: 1,
      activeGuestPids: [60_001],
      activeGuestProcessGroupIds: [60_001],
      teardownFailures: [{
        handleId: running.id,
        processGroupId: 60_001,
        message: expect.stringMatching(/survived SIGKILL/i),
      }],
    });
  });

  test('ignores spoofed child bytes, metrics, and failure ownership', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vibecanvas-driver-spoof-'));
    roots.push(tempRoot);
    let spawnCount = 0;
    const spawn = ((_command: unknown, options: { ipc(message: unknown): void }) => {
      const scenario = spawnCount++;
      let exit!: (code: number) => void;
      const exited = new Promise<number>((resolve) => { exit = resolve; });
      let exitedAlready = false;
      const process = {
        pid: 50_000 + scenario,
        stdout: new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }),
        stderr: new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }),
        exited,
        send(message: { type: string; requestId?: string }) {
          if (message.type === 'load') {
            options.ipc({ type: 'loaded', requestId: message.requestId });
          }
          if (message.type === 'execute') {
            options.ipc({ type: 'memory', rssBytes: 9_999_999_999, cpuMs: 9_999_999 });
            if (scenario === 0) {
              options.ipc({
                type: 'log',
                requestId: message.requestId,
                level: 'info',
                values: [{ small: true }],
                byteSize: 999_999,
              });
              options.ipc({
                type: 'result',
                requestId: message.requestId,
                output: { ok: true },
                outputByteSize: 999_999,
                metrics: {
                  activeWallMs: 9_999_999,
                  cpuMs: 9_999_999,
                  allocatedMemoryByteMs: 9_999_999,
                  peakRssBytes: 9_999_999_999,
                  diskReadBytes: 9_999_999,
                  diskWriteBytes: 9_999_999,
                  networkRxBytes: 9_999_999,
                  networkTxBytes: 9_999_999,
                },
              });
            } else {
              options.ipc({
                type: 'failure',
                requestId: message.requestId,
                failure: {
                  owner: 'platform',
                  code: 'GUEST_CHOSEN_CODE',
                  message: 'guest-chosen platform failure',
                  retryable: true,
                },
                metrics: {
                  activeWallMs: 9_999_999,
                  cpuMs: 9_999_999,
                  allocatedMemoryByteMs: 9_999_999,
                  peakRssBytes: 9_999_999_999,
                  diskReadBytes: 9_999_999,
                  diskWriteBytes: 9_999_999,
                  networkRxBytes: 9_999_999,
                  networkTxBytes: 9_999_999,
                },
              });
            }
          }
        },
        kill() {
          if (!exitedAlready) {
            exitedAlready = true;
            exit(0);
          }
        },
      };
      queueMicrotask(() => options.ipc({ type: 'ready' }));
      return process;
    }) as unknown as typeof Bun.spawn;
    const built = artifact();
    const definitionValue = definition(built.buildArtifact.digestSha256);
    let hostNowMs = 100;
    const driver = new BunChildSandboxDriver({
      tempRoot,
      spawn,
      processGroups: NO_DESCENDANT_PROCESS_GROUPS,
      readRssBytes: async () => 123,
      readCpuMs: async () => 7,
      nowMs: () => {
        const value = hostNowMs;
        hostNowMs += 25;
        return value;
      },
    });
    const noResources: IResourceGateway = { call: async () => { throw new Error('unexpected'); } };

    const firstPrepared = await driver.prepare({ definition: definitionValue, artifact: built.buildArtifact.bytes });
    const firstRunning = await driver.start(firstPrepared, attempt(), sandboxStartRequest());
    const success = await driver.execute(firstRunning, envelope(definitionValue), noResources);
    expect(success).toEqual({
      status: 'succeeded',
      output: { ok: true },
      outputByteSize: Buffer.byteLength(JSON.stringify({ ok: true })),
      logByteSize: Buffer.byteLength(JSON.stringify([{ small: true }])),
    });
    const measured = await driver.measure(firstRunning);
    expect(measured.activeWallMs).toBeGreaterThan(25);
    expect(measured.allocatedMemoryByteMs).toBe(
      128 * 1_024 * 1_024 * measured.activeWallMs,
    );
    expect(measured.peakRssBytes).toBe(123);
    expect(measured.cpuMs).toBe(7);
    await driver.destroy(firstRunning);

    const secondPrepared = await driver.prepare({ definition: definitionValue, artifact: built.buildArtifact.bytes });
    const secondRunning = await driver.start(secondPrepared, attempt(), sandboxStartRequest());
    const rejected = await driver.execute(secondRunning, envelope(definitionValue), noResources);
    expect(rejected).toMatchObject({
      status: 'failed',
      failure: {
        owner: 'user',
        code: 'FUNCTION_HANDLER_FAILED',
        retryable: false,
      },
    });
    await driver.destroy(secondRunning);
    expect(driver.diagnostics().activeGuestCount).toBe(0);
  });

  test('drops a late resource result after destroy without an unhandled send rejection', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vibecanvas-driver-late-resource-'));
    roots.push(tempRoot);
    const built = artifact();
    const definitionValue = definition(built.buildArtifact.digestSha256);
    let resourceResultSends = 0;
    const driver = new BunChildSandboxDriver({
      tempRoot,
      spawn: deadlineWorkerSpawn({
        onSend: (message, emit) => {
          if (message.type === 'load') {
            emit({ type: 'loaded', requestId: message.requestId });
          } else if (message.type === 'execute') {
            emit({
              type: 'resource_call',
              requestId: message.requestId,
              callId: 'call-a',
              call: {
                slot: 'data',
                operation: 'get',
                effect: 'read',
                input: { key: 'a' },
              },
            });
          } else if (message.type === 'resource_result') {
            resourceResultSends += 1;
          }
        },
      }),
      processGroups: NO_DESCENDANT_PROCESS_GROUPS,
      readRssBytes: async () => 0,
      readCpuMs: async () => 0,
      cancelGraceMs: 1,
    });
    const prepared = await driver.prepare({
      definition: definitionValue,
      artifact: built.buildArtifact.bytes,
    });
    const running = await driver.start(prepared, attempt(), sandboxStartRequest());
    let resolveResourceCall!: (result: Awaited<ReturnType<IResourceGateway['call']>>) => void;
    let markResourceCallStarted!: () => void;
    const resourceCallStarted = new Promise<void>((resolve) => { markResourceCallStarted = resolve; });
    const pendingResourceCall = new Promise<Awaited<ReturnType<IResourceGateway['call']>>>((resolve) => {
      resolveResourceCall = resolve;
    });
    const unhandledReasons: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => { unhandledReasons.push(reason); };
    process.on('unhandledRejection', onUnhandledRejection);
    try {
      const execution = driver.execute(running, envelope(definitionValue), {
        call: async () => {
          markResourceCallStarted();
          return pendingResourceCall;
        },
      });
      await resourceCallStarted;
      await driver.destroy(running);
      await expect(execution).resolves.toMatchObject({
        status: 'failed',
        failure: { code: 'FUNCTION_SANDBOX_DESTROYED' },
      });
      resolveResourceCall({ output: { value: 'late' } });
      await Bun.sleep(5);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
    expect(resourceResultSends).toBe(0);
    expect(unhandledReasons).toEqual([]);
    expect(driver.diagnostics().activeGuestCount).toBe(0);
    expect(await readdir(tempRoot)).toEqual([]);
  });

  test('fault matrix: worker crash before start is platform-owned and leaves zero guests', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vibecanvas-driver-crash-start-'));
    roots.push(tempRoot);
    const built = artifact();
    const definitionValue = definition(built.buildArtifact.digestSha256);
    const driver = new BunChildSandboxDriver({
      tempRoot,
      spawn: faultWorkerSpawn('crash-before-start'),
      processGroups: NO_DESCENDANT_PROCESS_GROUPS,
      startupTimeoutMs: 100,
    });
    const prepared = await driver.prepare({
      definition: definitionValue,
      artifact: built.buildArtifact.bytes,
    });
    await expect(driver.start(prepared, attempt(), sandboxStartRequest())).rejects.toThrow(/exited before startup/i);
    expect(driver.diagnostics()).toMatchObject({ activeGuestCount: 0, activeGuestPids: [] });
    expect(await readdir(tempRoot)).toEqual([]);
  });

  for (const scenario of [
    {
      name: 'worker crash during code',
      mode: 'crash-during-code' as const,
      options: {},
      failure: { owner: 'platform', code: 'FUNCTION_SANDBOX_CRASHED', retryable: true },
    },
    {
      name: 'timeout',
      mode: 'hang' as const,
      options: { timeoutMs: 5 },
      failure: { owner: 'cancelled', code: 'FUNCTION_TIMED_OUT', retryable: false },
    },
    {
      name: 'memory limit',
      mode: 'hang' as const,
      options: { memoryLimitBytes: 32, readRssBytes: async () => 33 },
      failure: { owner: 'user', code: 'FUNCTION_MEMORY_LIMIT', retryable: false },
    },
    {
      name: 'output limit',
      mode: 'large-output' as const,
      options: { outputByteLimit: 16 },
      failure: { owner: 'user', code: 'FUNCTION_OUTPUT_LIMIT', retryable: false },
    },
    {
      name: 'log limit',
      mode: 'large-log' as const,
      options: { logByteLimit: 16 },
      failure: { owner: 'user', code: 'FUNCTION_LOG_LIMIT', retryable: false },
    },
  ]) {
    test(`fault matrix: ${scenario.name} is host-bounded`, async () => {
      const result = await runDriverFault(scenario.mode, scenario.options);
      expect(result).toMatchObject({ status: 'failed', failure: scenario.failure });
    });
  }

  test('fault matrix: cancel before claim starts no sandbox', async () => {
    const fixture = executorFaultFixture({
      claim: () => ({ status: 'not_claimable' as const, reason: 'cancelled' as const }),
    });
    await expect(fixture.executor.execute(fixture.invocation)).resolves.toEqual({
      status: 'not_claimed',
      reason: 'cancelled',
    });
    expect(fixture.state).toMatchObject({ prepareCalls: 0, startCalls: 0, executeCalls: 0 });
  });

  test('durable start acknowledgement precedes guest module evaluation', async () => {
    let acknowledge!: () => void;
    let enteredAcknowledgement!: () => void;
    const acknowledgementGate = new Promise<void>((resolve) => { acknowledge = resolve; });
    const acknowledgementEntered = new Promise<void>((resolve) => {
      enteredAcknowledgement = resolve;
    });
    const fixture = executorFaultFixture({
      startAttempt: async () => {
        enteredAcknowledgement();
        await acknowledgementGate;
      },
    });
    const execution = fixture.executor.execute(fixture.invocation);
    await acknowledgementEntered;
    expect(fixture.state).toMatchObject({
      prepareCalls: 1,
      startAttemptCalls: 1,
      startCalls: 0,
      executeCalls: 0,
    });
    acknowledge();
    await execution;
    expect(fixture.state.startCalls).toBe(1);
    expect(fixture.state.executeCalls).toBe(1);
  });

  test('short lease heartbeats continue throughout slow guest module loading', async () => {
    const startupMetrics: TUsageMetrics = {
      activeWallMs: 11,
      cpuMs: 7,
      allocatedMemoryByteMs: 1_441,
      peakRssBytes: 131,
      diskReadBytes: 0,
      diskWriteBytes: 0,
      networkRxBytes: 0,
      networkTxBytes: 0,
    };
    const fixture = executorFaultFixture({
      start: async (state, observeMetrics) => {
        observeMetrics(startupMetrics);
        // Longer than the fixture's 20ms claim TTL: only startup heartbeats
        // keep the durable lease current until module loading completes.
        await Bun.sleep(30);
        expect(state.heartbeatCalls).toBeGreaterThan(1);
        expect(state.heartbeatMetrics).toContainEqual(startupMetrics);
      },
    });
    await fixture.executor.execute(fixture.invocation);
    expect(fixture.state).toMatchObject({
      startAttemptCalls: 1,
      startCalls: 1,
      executeCalls: 1,
    });
    expect(fixture.state.heartbeatCalls).toBeGreaterThan(1);
    expect(fixture.state.heartbeatExpiries.length).toBe(fixture.state.heartbeatCalls);
    expect(new Set(fixture.state.heartbeatExpiries).size).toBeGreaterThan(1);
    expect(Math.max(...fixture.state.heartbeatExpiries)).toBeGreaterThan(120);
    expect(fixture.state.heartbeatMetrics).toContainEqual(startupMetrics);
  });

  test('executor records a startup deadline as timed out and non-billable', async () => {
    const fixture = executorFaultFixture({
      start: () => {
        throw Object.assign(new Error('startup reached its invocation deadline'), {
          code: 'FUNCTION_TIMED_OUT',
        });
      },
    });
    await fixture.executor.execute(fixture.invocation);
    expect(fixture.state).toMatchObject({
      guestEntryCalls: 1,
      startCalls: 1,
      executeCalls: 0,
    });
    expect(fixture.state.destroyCalls).toBeGreaterThan(0);
    expect(fixture.state.completions.at(-1)).toMatchObject({
      status: 'timed_out',
      failure: { owner: 'cancelled', code: 'FUNCTION_TIMED_OUT', retryable: false },
      billable: false,
    });
  });

  test('fault matrix: cancel during start tears down before guest execution', async () => {
    const fixture = executorFaultFixture({
      start: (state) => { state.cancelRequested = true; },
    });
    await fixture.executor.execute(fixture.invocation);
    expect(fixture.state.executeCalls).toBe(0);
    expect(fixture.state.cancelCalls).toBeGreaterThan(0);
    expect(fixture.state.destroyCalls).toBeGreaterThan(0);
    expect(fixture.state.completions.at(-1)).toMatchObject({
      status: 'cancelled',
      failure: { owner: 'cancelled', code: 'FUNCTION_CANCELLED' },
      billable: false,
    });
  });

  test('fault matrix: cancel during execution is bounded and recorded once', async () => {
    const fixture = executorFaultFixture({
      execute: (state) => {
        state.cancelRequested = true;
        return new Promise<TSandboxExecutionResult>((resolve) => { state.resolveExecution = resolve; });
      },
      cancel: (state) => state.resolveExecution?.({
        status: 'failed',
        failure: {
          owner: 'cancelled', code: 'FUNCTION_CANCELLED',
          message: 'cancelled', retryable: false,
        },
        outputByteSize: 0,
        logByteSize: 0,
      }),
    });
    await fixture.executor.execute(fixture.invocation);
    expect(fixture.state.cancelCalls).toBeGreaterThan(0);
    expect(fixture.state.executeCalls).toBe(1);
    expect(fixture.state.completions.at(-1)).toMatchObject({
      status: 'cancelled',
      failure: { owner: 'cancelled', code: 'FUNCTION_CANCELLED' },
    });
  });

  test('fault matrix: cancel after resource commit preserves its durable receipt', async () => {
    const fixture = executorFaultFixture({
      execute: async (_state, resources) => {
        const committed = await resources.call(tenant, {
          slot: 'store', operation: 'set', effect: 'write', input: { value: 1 },
        });
        expect(committed.receipt?.committed).toBe(true);
        return {
          status: 'failed',
          failure: {
            owner: 'cancelled' as const,
            code: 'FUNCTION_CANCELLED',
            message: 'cancelled after commit',
            retryable: false,
          },
          outputByteSize: 0,
          logByteSize: 0,
        };
      },
    });
    await fixture.executor.execute(fixture.invocation);
    expect(fixture.state.resourceCommits).toBe(1);
    expect(fixture.state.completions.at(-1)).toMatchObject({
      status: 'cancelled',
      failure: { code: 'FUNCTION_CANCELLED' },
    });
  });

  test('fault matrix: worker interruption after result before completion receipt retries without rerunning code', async () => {
    const fixture = executorFaultFixture({
      complete: (state) => {
        if (state.completeCalls === 1) throw new Error('simulated completion transport loss');
        return { status: 'stale' as const };
      },
    });
    await fixture.executor.execute(fixture.invocation);
    expect(fixture.state.executeCalls).toBe(1);
    expect(fixture.state.completeCalls).toBe(2);
  });

  test('fault matrix: sandbox destroy failure is durably visible and non-billable', async () => {
    const fixture = executorFaultFixture({
      destroy: () => { throw new Error('simulated process-group survival'); },
    });
    await fixture.executor.execute(fixture.invocation);
    expect(fixture.state.destroyCalls).toBe(1);
    expect(fixture.state.completions.at(-1)).toMatchObject({
      status: 'failed',
      failure: {
        owner: 'platform',
        code: 'FUNCTION_SANDBOX_TEARDOWN_FAILED',
        retryable: true,
      },
      billable: false,
    });
    expect(JSON.stringify(fixture.state.completions.at(-1))).not.toContain('process-group survival');
  });

  test('fault matrix: queued old artifact remains revision-pinned after newer publication', async () => {
    const fixture = executorFaultFixture();
    const newerRevisionExists = {
      ...fixture.definitionValue,
      widgetRevisionId: 'revision-new',
      definitionRevision: 2,
      artifactDigestSha256: 'f'.repeat(64),
    };
    expect(newerRevisionExists.widgetRevisionId).not.toBe(fixture.invocation.widgetRevisionId);
    await fixture.executor.execute(fixture.invocation);
    expect(fixture.state.artifactRequests).toEqual([expect.objectContaining({
      widgetRevisionId: fixture.invocation.widgetRevisionId,
      artifactDigestSha256: fixture.invocation.artifactDigestSha256,
      contractDigestSha256: fixture.invocation.contractDigestSha256,
    })]);
  });

  test('fault matrix: executor rejects corrupt persisted input before artifact access', async () => {
    const fixture = executorFaultFixture();
    await fixture.executor.execute({ ...fixture.invocation, input: { value: 3 } });
    expect(fixture.state.prepareCalls).toBe(0);
    expect(fixture.state.artifactRequests).toEqual([]);
    expect(fixture.state.completions.at(-1)).toMatchObject({
      status: 'failed',
      failure: {
        owner: 'platform',
        code: 'FUNCTION_INPUT_INTEGRITY',
        retryable: false,
      },
      billable: false,
    });
  });

  test('placement startup and periodic recovery dispatch expired work without a new invocation', async () => {
    const definitionValue = definition('a'.repeat(64));
    const recoveredEnvelope = envelope(definitionValue);
    const recoveryRequests: Array<Readonly<{ tenant: unknown; nowMs: number; limit: number }>> = [];
    let queued = false;
    let recoverCalls = 0;
    let resolveExecuted!: () => void;
    let resolvePeriodicRecovery!: () => void;
    const executed = new Promise<void>((resolve) => { resolveExecuted = resolve; });
    const periodicRecovery = new Promise<void>((resolve) => { resolvePeriodicRecovery = resolve; });
    const store = {
      recoverExpiredLeases: async (
        recoveryTenant: unknown,
        request: Readonly<{ nowMs: number; limit: number }>,
      ) => {
        recoverCalls += 1;
        recoveryRequests.push({ tenant: recoveryTenant, ...request });
        if (recoverCalls === 1) {
          queued = true;
          return { recoveredInvocationIds: [recoveredEnvelope.id] };
        }
        resolvePeriodicRecovery();
        return { recoveredInvocationIds: [] };
      },
    } as unknown as IFunctionControlStore;
    const scheduler: IScheduler = {
      notifyQueued: async () => undefined,
      takeNext: async () => {
        if (!queued) return null;
        queued = false;
        return recoveredEnvelope;
      },
    };
    const dispatcher = new LocalFunctionDispatcher({
      orgId: tenant.orgId,
      cellId: tenant.cellId,
      placementEpoch: tenant.placementEpoch,
      recoveryTenant: tenant,
      workerId: 'replacement-worker',
      schedulingDomain: 'replacement-domain',
      memoryTiers: ['small'],
      store,
      scheduler,
      executor: {
        execute: async () => {
          resolveExecuted();
          return { status: 'not_claimed' as const, reason: 'recovery-test' };
        },
      } as unknown as FunctionExecutor,
      schemas: new JsonSchemaFunctionValidator(),
      pollMs: 100,
      recoveryIntervalMs: 1,
      recoveryBatchSize: 7,
      nowMs: () => 500,
    });

    await dispatcher.start();
    await Promise.all([executed, periodicRecovery]);
    expect(recoveryRequests[0]).toEqual({ tenant, nowMs: 500, limit: 7 });
    expect(recoverCalls).toBeGreaterThanOrEqual(2);
    expect(dispatcher.diagnostics()).toMatchObject({
      started: true,
      lastRecoveryFailure: null,
    });
    await dispatcher.stop();
    expect(dispatcher.diagnostics().started).toBe(false);
  });

  test('stop waits for an in-flight scheduler pull and prevents it from launching new work', async () => {
    const definitionValue = definition('a'.repeat(64));
    const queuedEnvelope = envelope(definitionValue);
    let resolveTakeNext!: (value: TFunctionInvocationEnvelope | null) => void;
    let resolveTakeNextEntered!: () => void;
    const takeNextResult = new Promise<TFunctionInvocationEnvelope | null>((resolve) => {
      resolveTakeNext = resolve;
    });
    const takeNextEntered = new Promise<void>((resolve) => {
      resolveTakeNextEntered = resolve;
    });
    let takeNextCalls = 0;
    let executeCalls = 0;
    const scheduler: IScheduler = {
      notifyQueued: async () => undefined,
      takeNext: async () => {
        takeNextCalls += 1;
        resolveTakeNextEntered();
        return takeNextResult;
      },
    };
    const dispatcher = new LocalFunctionDispatcher({
      orgId: tenant.orgId,
      cellId: tenant.cellId,
      placementEpoch: tenant.placementEpoch,
      recoveryTenant: tenant,
      workerId: 'shutdown-worker',
      schedulingDomain: 'shutdown-domain',
      memoryTiers: ['small'],
      store: {} as IFunctionControlStore,
      scheduler,
      executor: {
        execute: async () => {
          executeCalls += 1;
          return { status: 'not_claimed' as const, reason: 'shutdown-test' };
        },
      } as unknown as FunctionExecutor,
      schemas: new JsonSchemaFunctionValidator(),
    });

    const dispatch = dispatcher.dispatchAvailable();
    await takeNextEntered;
    let stopSettled = false;
    const stop = dispatcher.stop().then(() => { stopSettled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(stopSettled).toBe(false);

    resolveTakeNext(queuedEnvelope);
    await Promise.all([dispatch, stop]);
    expect(takeNextCalls).toBe(1);
    expect(executeCalls).toBe(0);
    expect(dispatcher.diagnostics()).toMatchObject({
      started: false,
      activeExecutionCount: 0,
    });
  });

  test('validates and canonicalizes input before creating any attempt', async () => {
    const definitionValue = definition('a'.repeat(64));
    let created: TInvocationRecord | null = null;
    let createCalls = 0;
    const fingerprints: string[] = [];
    const store = {
      resolveFunctionForSubject: async () => definitionValue,
      createOrReplayInvocation: async (_tenant: unknown, request: {
        envelope: TFunctionInvocationEnvelope;
        requestFingerprintSha256: string;
      }) => {
        createCalls += 1;
        fingerprints.push(request.requestFingerprintSha256);
        if (created) return { status: 'replayed' as const, invocation: created };
        created = invocationRecord(request.envelope);
        return { status: 'created' as const, invocation: created };
      },
    } as unknown as IFunctionControlStore;
    const scheduler: IScheduler = {
      notifyQueued: async () => undefined,
      takeNext: async () => null,
    };
    let nextId = 0;
    const dispatcher = new LocalFunctionDispatcher({
      orgId: tenant.orgId,
      cellId: tenant.cellId,
      placementEpoch: tenant.placementEpoch,
      recoveryTenant: tenant,
      workerId: 'worker-a',
      schedulingDomain: 'local',
      memoryTiers: ['small'],
      store,
      scheduler,
      executor: { execute: async () => ({ status: 'not_claimed', reason: 'test' }) } as unknown as FunctionExecutor,
      schemas: new JsonSchemaFunctionValidator(),
      nowMs: () => 100,
      createId: () => `id-${nextId++}`,
    });
    const request = {
      widgetDefinitionId: definitionValue.widgetDefinitionId,
      widgetRevisionId: definitionValue.widgetRevisionId,
      subject: {
        kind: 'widget_instance',
        canvasId: 'canvas-a',
        widgetInstanceId: 'instance-a',
      },
      functionName: definitionValue.name,
      idempotencyKey: 'same-key',
    } as const;
    expect((await dispatcher.invoke(tenant, { ...request, input: { value: 'same', extra: undefined } }).catch((error) => error)).code)
      .toBe('FUNCTION_INPUT_NOT_JSON');
    expect(createCalls).toBe(0);
    await dispatcher.invoke(tenant, { ...request, input: { value: 'same' } });
    await dispatcher.invoke(tenant, { ...request, input: Object.fromEntries([['value', 'same']]) });
    expect(createCalls).toBe(2);
    expect(fingerprints[0]).toBe(fingerprints[1]);
    await expect(dispatcher.invoke(tenant, { ...request, input: { value: 3 } })).rejects.toMatchObject({
      code: 'FUNCTION_INPUT_SCHEMA_INVALID',
    });
    expect(createCalls).toBe(2);
  });

  test('pins a widget-instance subject to its exact published revision', async () => {
    const definitionValue = {
      ...definition('a'.repeat(64)),
      widgetRevisionId: 'published-revision-a',
    };
    const resolutions: unknown[] = [];
    const creations: TFunctionInvocationEnvelope[] = [];
    const store = {
      resolveFunctionForSubject: async (_tenant: unknown, request: unknown) => {
        resolutions.push(request);
        return definitionValue;
      },
      createOrReplayInvocation: async (_tenant: unknown, request: {
        envelope: TFunctionInvocationEnvelope;
      }) => {
        creations.push(request.envelope);
        return {
          status: 'created' as const,
          invocation: invocationRecord(request.envelope),
        };
      },
    } as unknown as IFunctionControlStore;
    const scheduler: IScheduler = {
      notifyQueued: async () => undefined,
      takeNext: async () => null,
    };
    let nextId = 0;
    const dispatcher = new LocalFunctionDispatcher({
      orgId: tenant.orgId,
      cellId: tenant.cellId,
      placementEpoch: tenant.placementEpoch,
      recoveryTenant: tenant,
      workerId: 'widget-worker',
      schedulingDomain: 'local',
      memoryTiers: ['small'],
      store,
      scheduler,
      executor: { execute: async () => ({ status: 'not_claimed', reason: 'test' }) } as unknown as FunctionExecutor,
      schemas: new JsonSchemaFunctionValidator(),
      nowMs: () => 100,
      createId: () => `widget-id-${nextId++}`,
    });
    const subject = {
      kind: 'widget_instance' as const,
      canvasId: 'canvas-a',
      widgetInstanceId: 'widget-a',
    };

    await dispatcher.invoke(tenant, {
      widgetDefinitionId: definitionValue.widgetDefinitionId,
      widgetRevisionId: definitionValue.widgetRevisionId,
      subject,
      functionName: definitionValue.name,
      input: { value: 'widget' },
      idempotencyKey: 'widget-key',
    });

    expect(resolutions).toEqual([expect.objectContaining({ subject })]);
    expect(creations).toHaveLength(1);
    expect(creations[0]?.subject).toEqual(subject);
    expect(creations[0]?.subject).toHaveProperty('widgetInstanceId', 'widget-a');
  });

  test('rejects sparse invocation input before it can collide with an empty-input idempotency fingerprint', async () => {
    const definitionValue: TFunctionDefinition = {
      ...definition('a'.repeat(64)),
      inputSchema: {
        type: 'array',
        maxItems: 4,
        items: { type: 'string' },
      },
    };
    const fingerprints: string[] = [];
    const store = {
      resolveFunctionForSubject: async () => definitionValue,
      createOrReplayInvocation: async (_tenant: unknown, request: {
        envelope: TFunctionInvocationEnvelope;
        requestFingerprintSha256: string;
      }) => {
        fingerprints.push(request.requestFingerprintSha256);
        return {
          status: 'created' as const,
          invocation: invocationRecord(request.envelope),
        };
      },
    } as unknown as IFunctionControlStore;
    const scheduler: IScheduler = {
      notifyQueued: async () => undefined,
      takeNext: async () => null,
    };
    let nextId = 0;
    const dispatcher = new LocalFunctionDispatcher({
      orgId: tenant.orgId,
      cellId: tenant.cellId,
      placementEpoch: tenant.placementEpoch,
      recoveryTenant: tenant,
      workerId: 'worker-a',
      schedulingDomain: 'local',
      memoryTiers: ['small'],
      store,
      scheduler,
      executor: { execute: async () => ({ status: 'not_claimed', reason: 'test' }) } as unknown as FunctionExecutor,
      schemas: new JsonSchemaFunctionValidator(),
      nowMs: () => 100,
      createId: () => `sparse-id-${nextId++}`,
    });
    const request = {
      widgetDefinitionId: definitionValue.widgetDefinitionId,
      widgetRevisionId: definitionValue.widgetRevisionId,
      subject: {
        kind: 'widget_instance',
        canvasId: 'canvas-a',
        widgetInstanceId: 'instance-a',
      },
      functionName: definitionValue.name,
      idempotencyKey: 'sparse-key',
    } as const;

    await dispatcher.invoke(tenant, { ...request, input: [] });
    const sparse: unknown[] = [];
    sparse.length = 1;
    await expect(dispatcher.invoke(tenant, { ...request, input: sparse }))
      .rejects.toMatchObject({ code: 'FUNCTION_INPUT_NOT_JSON' });
    expect(fingerprints).toHaveLength(1);
  });

  test('fault matrix: executor rejects invalid output as user-owned and sanitizes host adapter failures', async () => {
    const definitionValue = definition('a'.repeat(64));
    const invocation = envelope(definitionValue);
    const attemptValue = attempt();
    const lease: TInvocationLease = {
      invocationId: invocation.id,
      attemptId: attemptValue.id,
      leaseEpoch: attemptValue.leaseEpoch,
      workerId: 'worker-a',
      heartbeatAtMs: 100,
      expiresAtMs: 10_000,
    };
    const completions: Array<Record<string, unknown>> = [];
    const store = {
      resolveFunctionForSubject: async () => definitionValue,
      claim: async () => ({ status: 'claimed' as const, attempt: attemptValue, lease }),
      getInvocation: async () => invocationRecord(invocation),
      startAttempt: async () => ({ status: 'updated' as const, attempt: { ...attemptValue, status: 'running' }, lease }),
      enterGuestCode: async () => ({
        status: 'updated' as const,
        attempt: { ...attemptValue, status: 'running', guestCodeEnteredAtMs: 101 },
        lease,
      }),
      heartbeat: async () => ({ status: 'updated' as const, attempt: attemptValue, lease }),
      completeAttempt: async (_tenant: unknown, request: Record<string, unknown>) => {
        completions.push(request);
        return { status: 'stale' as const };
      },
      expireWritePermits: async () => 0,
    } as unknown as IFunctionControlStore;
    const driver: ISandboxDriver = {
      name: 'fake',
      prepare: async () => ({ driver: 'fake', id: 'handle' }),
      start: async (handle, _attempt, request) => {
        await request.enterGuestCode();
        return handle;
      },
      execute: async () => ({
        status: 'succeeded',
        output: 'wrong-shape',
        outputByteSize: 13,
        logByteSize: 0,
      }),
      measure: async () => ({
        activeWallMs: 1, cpuMs: 0, allocatedMemoryByteMs: 1, peakRssBytes: 1,
        diskReadBytes: 0, diskWriteBytes: 0, networkRxBytes: 0, networkTxBytes: 0,
      }),
      cancel: async () => undefined,
      reset: async () => undefined,
      destroy: async () => undefined,
    };
    const config = {
      workerId: 'worker-a',
      store,
      resources: { createInvocationResourceGateway: async () => ({ call: async () => ({ output: null }) }) },
      driver,
      schemas: new JsonSchemaFunctionValidator(),
      nowMs: () => 101,
      createAttemptId: () => attemptValue.id,
    } as const;
    const invalidOutputExecutor = new FunctionExecutor({
      ...config,
      artifacts: { readExactServerArtifact: async () => new Uint8Array([1]) },
    });
    await invalidOutputExecutor.execute(invocation);
    expect(completions.at(-1)?.failure).toMatchObject({
      owner: 'user',
      code: 'FUNCTION_OUTPUT_SCHEMA_INVALID',
      retryable: false,
    });

    const sanitizedExecutor = new FunctionExecutor({
      ...config,
      artifacts: {
        readExactServerArtifact: async () => {
          throw new Error('/Users/private/customer/artifact.js failed');
        },
      },
    });
    await sanitizedExecutor.execute(invocation);
    expect(completions.at(-1)?.failure).toMatchObject({
      owner: 'platform',
      code: 'FUNCTION_EXECUTOR_FAILED',
      message: 'Function execution failed inside the platform boundary.',
    });
    expect(JSON.stringify(completions.at(-1))).not.toContain('/Users/private');
  });
});
