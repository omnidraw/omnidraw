import { describe, expect, test } from 'bun:test';
import type {
  IFunctionSandboxDriver,
  TDirectFunctionDefinition,
  TDirectFunctionInvocationRequest,
  TFunctionSandboxExecutionResult,
  TFunctionUsageMetrics,
} from '../index';
import {
  DirectFunctionExecutor,
  DirectInvocationResourceGateway,
  EphemeralResourceWritePermitAuthority,
  fnBunFunctionWorkerCommand,
  JsonSchemaFunctionValidator,
} from '../local';

const explicitExecutorWorld = Object.freeze({
  nowMs: () => 1,
  createId: () => 'call-test',
});

const definition: TDirectFunctionDefinition = Object.freeze({
  widgetKey: 'counter',
  catalogGeneration: 7,
  runtimeAbi: 'omnidraw.function.v1',
  artifactDigestSha256: 'a'.repeat(64),
  descriptor: Object.freeze({
    schemaVersion: 1,
    exportName: 'increment',
    modulePath: 'server.ts',
    effect: 'fn',
    inputSchema: { type: 'object', additionalProperties: false },
    outputSchema: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    },
    resources: [],
    limits: {
      timeoutMs: 1_000,
      memoryTier: 'small' as const,
      outputByteLimit: 64,
      logByteLimit: 32,
    },
  }),
});

const metrics: TFunctionUsageMetrics = Object.freeze({
  activeWallMs: 1,
  cpuMs: 1,
  allocatedMemoryByteMs: 1,
  peakRssBytes: 1,
});

describe('source-run function worker command', () => {
  test('always launches the explicit TypeScript worker entrypoint', () => {
    expect(fnBunFunctionWorkerCommand({
      executable: '/usr/bin/bun',
      workerPath: '/workspace/function-worker.ts',
    })).toEqual([
      '/usr/bin/bun',
      '/workspace/function-worker.ts',
      '--function-worker',
    ]);
  });
});

function request(
  patch: Partial<TDirectFunctionInvocationRequest> = {},
): TDirectFunctionInvocationRequest {
  return {
    subject: {
      canvasId: 'canvas-a',
      elementId: 'element-a',
      widgetInstanceId: 'instance-a',
    },
    definition,
    artifact: new Uint8Array(),
    input: {},
    createResources: () => ({ call: async () => ({ output: null }) }),
    ...patch,
  };
}

function driver(
  result: TFunctionSandboxExecutionResult = {
    status: 'succeeded', output: { ok: true }, outputByteSize: 11, logByteSize: 0,
  },
  events: string[] = [],
): IFunctionSandboxDriver {
  return {
    name: 'fake',
    prepare: async () => {
      events.push('prepare');
      return { driver: 'fake', id: 'one' };
    },
    start: async () => {
      events.push('start');
      return { driver: 'fake', id: 'one' };
    },
    execute: async () => {
      events.push('execute');
      return result;
    },
    measure: async () => metrics,
    cancel: async () => { events.push('cancel'); },
    destroy: async () => { events.push('destroy'); },
  };
}

describe('direct function execution', () => {
  test('validates schemas, returns synchronously, and retains no completed call', async () => {
    const events: string[] = [];
    const executor = new DirectFunctionExecutor({
      driver: driver(undefined, events),
      schemas: new JsonSchemaFunctionValidator(),
      createId: () => 'call-a',
      nowMs: () => 1,
    });
    await expect(executor.invoke(request())).resolves.toEqual({
      status: 'succeeded',
      output: { ok: true },
      diagnostics: { code: null, message: null, logByteSize: 0, truncated: false },
    });
    expect(events).toEqual(['prepare', 'start', 'execute', 'destroy']);
    expect(executor.diagnostics()).toEqual({ activeCalls: 0, maxConcurrent: 4 });
    await expect(executor.invoke(request({ input: { unexpected: true } }))).rejects.toMatchObject({
      code: 'FUNCTION_INPUT_SCHEMA_INVALID',
    });
    expect(executor.diagnostics().activeCalls).toBe(0);
  });

  test('defensively rejects oversized output and logs reported by a driver', async () => {
    const outputExecutor = new DirectFunctionExecutor({
      driver: driver({
        status: 'succeeded', output: { ok: true }, outputByteSize: 65, logByteSize: 0,
      }),
      schemas: new JsonSchemaFunctionValidator(),
      ...explicitExecutorWorld,
    });
    await expect(outputExecutor.invoke(request())).resolves.toMatchObject({
      status: 'failed', failure: { code: 'FUNCTION_OUTPUT_INTEGRITY' },
    });

    const logExecutor = new DirectFunctionExecutor({
      driver: driver({
        status: 'succeeded', output: { ok: true }, outputByteSize: 11, logByteSize: 33,
      }),
      schemas: new JsonSchemaFunctionValidator(),
      ...explicitExecutorWorld,
    });
    await expect(logExecutor.invoke(request())).resolves.toMatchObject({
      status: 'failed', failure: { code: 'FUNCTION_LOG_LIMIT' },
    });

    const invalidLogExecutor = new DirectFunctionExecutor({
      driver: driver({
        status: 'succeeded', output: { ok: true }, outputByteSize: 11, logByteSize: Number.NaN,
      }),
      schemas: new JsonSchemaFunctionValidator(),
      ...explicitExecutorWorld,
    });
    await expect(invalidLogExecutor.invoke(request())).resolves.toEqual({
      status: 'failed',
      output: null,
      failure: {
        owner: 'platform',
        code: 'FUNCTION_LOG_INTEGRITY',
        message: 'Function log byte accounting is invalid.',
      },
      diagnostics: {
        code: 'FUNCTION_LOG_INTEGRITY',
        message: 'Function log byte accounting is invalid.',
        logByteSize: 0,
        truncated: false,
      },
    });
  });

  test('rejects excess concurrency immediately instead of queueing', async () => {
    let finish!: (value: TFunctionSandboxExecutionResult) => void;
    const pending = new Promise<TFunctionSandboxExecutionResult>((resolve) => { finish = resolve; });
    const fake = driver();
    fake.execute = async () => pending;
    const executor = new DirectFunctionExecutor({
      driver: fake,
      schemas: new JsonSchemaFunctionValidator(),
      ...explicitExecutorWorld,
      maxConcurrent: 1,
    });
    const first = executor.invoke(request());
    await Promise.resolve();
    await Promise.resolve();
    await expect(executor.invoke(request())).rejects.toMatchObject({ code: 'RESOURCE_EXHAUSTED' });
    finish({ status: 'succeeded', output: { ok: true }, outputByteSize: 11, logByteSize: 0 });
    await expect(first).resolves.toMatchObject({ status: 'succeeded' });
  });

  test('forwards live cancellation and always reaps the child', async () => {
    const events: string[] = [];
    let finish!: (value: TFunctionSandboxExecutionResult) => void;
    const pending = new Promise<TFunctionSandboxExecutionResult>((resolve) => { finish = resolve; });
    const fake = driver(undefined, events);
    fake.execute = async () => pending;
    fake.cancel = async () => {
      events.push('cancel');
      finish({
        status: 'failed',
        failure: { owner: 'cancelled', code: 'FUNCTION_CANCELLED', message: 'cancelled' },
        outputByteSize: 0,
        logByteSize: 0,
      });
    };
    const executor = new DirectFunctionExecutor({
      driver: fake,
      schemas: new JsonSchemaFunctionValidator(),
      ...explicitExecutorWorld,
    });
    const controller = new AbortController();
    const call = executor.invoke(request({ signal: controller.signal }));
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await expect(call).resolves.toMatchObject({
      status: 'cancelled', failure: { code: 'FUNCTION_CANCELLED' },
    });
    expect(events.at(-1)).toBe('destroy');
  });

  test('does not start execution when cancellation lands during resource creation', async () => {
    const events: string[] = [];
    let releaseResources!: () => void;
    let resourcesStarted!: () => void;
    const resourceGate = new Promise<void>((resolve) => { releaseResources = resolve; });
    const resourceStart = new Promise<void>((resolve) => { resourcesStarted = resolve; });
    const executor = new DirectFunctionExecutor({
      driver: driver(undefined, events),
      schemas: new JsonSchemaFunctionValidator(),
      ...explicitExecutorWorld,
    });
    const controller = new AbortController();
    const call = executor.invoke(request({
      signal: controller.signal,
      createResources: async () => {
        events.push('resources');
        resourcesStarted();
        await resourceGate;
        return { call: async () => ({ output: null }) };
      },
    }));

    await resourceStart;
    controller.abort();
    releaseResources();

    await expect(call).resolves.toMatchObject({
      status: 'cancelled', failure: { code: 'FUNCTION_CANCELLED' },
    });
    expect(events).toEqual(['prepare', 'start', 'resources', 'cancel', 'destroy']);
    expect(executor.diagnostics().activeCalls).toBe(0);
  });
});

describe('ephemeral write permits', () => {
  test('are single-use and disappear across restart', async () => {
    let nowMs = 10;
    const secret = new Uint8Array(32).fill(7);
    const first = new EphemeralResourceWritePermitAuthority({
      secret,
      nowMs: () => nowMs,
      createId: () => 'permit-a',
      createNonce: () => 'nonce-a',
    });
    const issued = first.issueWriteCapability({
      resourceId: 'resource-a',
      invocationId: 'call-a',
      operation: 'set',
      operationId: 'call-a:0',
      operationFingerprintSha256: 'b'.repeat(64),
      expiresAtMs: 100,
    });
    const claims = await first.verifyWriteCapability(issued.capability);
    expect(claims).not.toBeNull();
    await expect(first.runWithWritePermit({
      claims: claims!,
      slot: 'store',
      kind: 'kv',
      resourceId: 'resource-a',
      operation: 'set',
      operationId: 'call-a:0',
      operationFingerprintSha256: 'b'.repeat(64),
    }, async (guard) => {
      await guard.assertCanCommit();
      return 'written';
    })).resolves.toBe('written');
    expect(first.activePermitCount()).toBe(0);
    expect(await first.verifyWriteCapability(issued.capability)).toBeNull();

    const restarted = new EphemeralResourceWritePermitAuthority({
      secret,
      nowMs: () => nowMs,
      createId: () => 'restarted-permit',
      createNonce: () => 'restarted-nonce',
    });
    expect(await restarted.verifyWriteCapability(issued.capability)).toBeNull();
    nowMs = 101;
    expect(restarted.activePermitCount()).toBe(0);
  });

  test('revokes an issued permit when the resource gateway rejects before consumption', async () => {
    const authority = new EphemeralResourceWritePermitAuthority({
      secret: new Uint8Array(32).fill(9),
      nowMs: () => 10,
      createId: () => 'permit-rejected',
      createNonce: () => 'nonce-rejected',
    });
    const txDefinition: TDirectFunctionDefinition = {
      ...definition,
      descriptor: {
        ...definition.descriptor,
        effect: 'tx',
        resources: [{ slot: 'store', effect: 'write' }],
      },
    };
    const gateway = new DirectInvocationResourceGateway({
      call: {
        id: 'call-rejected',
        subject: request().subject,
        definition: txDefinition,
        input: {},
        deadlineAtMs: 100,
      },
      bindings: {
        resolveBinding: async () => ({
          slot: 'store', resourceId: 'resource-a', kind: 'kv',
          allowRead: false, allowWrite: true,
        }),
      },
      gateway: {
        call: async () => { throw new Error('rejected before permit consumption'); },
      },
      writePermits: authority,
      nowMs: () => 10,
    });
    await expect(gateway.call({
      slot: 'store', operation: 'set', effect: 'write', input: { key: 'a' },
    })).rejects.toThrow('rejected before permit consumption');
    expect(authority.activePermitCount()).toBe(0);
  });

  test('rejects generated permit ID collisions instead of replacing live authority', () => {
    const authority = new EphemeralResourceWritePermitAuthority({
      secret: new Uint8Array(32).fill(5),
      nowMs: () => 1,
      createId: () => 'same-id',
      createNonce: () => 'nonce',
    });
    const args = {
      resourceId: 'resource-a',
      invocationId: 'call-a',
      operation: 'set',
      operationId: 'call-a:0',
      operationFingerprintSha256: 'c'.repeat(64),
      expiresAtMs: 10,
    };
    authority.issueWriteCapability(args);
    expect(() => authority.issueWriteCapability(args)).toThrow('collided');
    expect(authority.activePermitCount()).toBe(1);
    authority.revokeWritePermit('same-id');
  });
});
