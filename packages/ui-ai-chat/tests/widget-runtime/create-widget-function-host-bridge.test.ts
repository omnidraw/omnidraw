import { describe, expect, test, vi } from 'vitest';
import type { TWidgetBrowserFunctionDescriptor } from '@omnidraw/widget-contract';
import { createWidgetFunctionHostBridge } from '../../src/widget-runtime/create-widget-function-host-bridge';
import type {
  TWidgetRuntimeIdentity,
  TWidgetRuntimeTransportPort,
} from '../../src/widget-runtime/interface';

const identity: TWidgetRuntimeIdentity = Object.freeze({
  orgId: 'org-a',
  canvasId: 'canvas-a',
  elementId: 'element-a',
  widgetInstanceId: 'instance-a',
  definitionId: 'definition-a',
  revisionId: 'revision-a',
});

function functionDescriptor(
  timeoutMs = 5_000,
  exportName = 'count',
): TWidgetBrowserFunctionDescriptor {
  return {
    schemaVersion: 1,
    exportName,
    effect: 'fn',
    inputSchema: {},
    outputSchema: {},
    resources: [],
    limits: {
      timeoutMs,
      memoryTier: 'small',
      outputByteLimit: 1_024,
      logByteLimit: 1_024,
    },
    retry: {
      mode: 'none',
      maxAttempts: 1,
      initialBackoffMs: 0,
      maxBackoffMs: 0,
    },
  };
}

const functionDescriptors = Object.freeze([functionDescriptor()]);

function invocation(status: 'queued' | 'succeeded', patch: Record<string, unknown> = {}) {
  return {
    id: 'invocation-a',
    functionName: 'count',
    widgetRevisionId: identity.revisionId,
    widgetInstanceId: identity.widgetInstanceId,
    status,
    output: status === 'succeeded' ? { count: 2 } : null,
    failure: null,
    createdAtMs: 1,
    startedAtMs: status === 'succeeded' ? 2 : null,
    finishedAtMs: status === 'succeeded' ? 3 : null,
    ...patch,
  };
}

describe('widget function host bridge', () => {
  test('retains exact host identity and submits its expected revision fence', async () => {
    const invoke = vi.fn(async () => [undefined, invocation('queued')] as const);
    const get = vi.fn(async () => [undefined, invocation('succeeded')] as const);
    const wait = vi.fn(async () => undefined);
    const bridge = createWidgetFunctionHostBridge({
      identity,
      functionDescriptors,
      transport: { api: { function: { invoke, get } } } as unknown as TWidgetRuntimeTransportPort,
      createIdempotencyKey: () => 'key-a',
      nowMs: () => 0,
      wait,
      isTargetCurrent: () => true,
      pollIntervalMs: 10,
    });

    await expect(bridge.invoke({
      functionName: 'count',
      input: { values: [1, 1] },
    })).resolves.toEqual({ count: 2 });
    expect(bridge.identity).toEqual(identity);
    expect(invoke).toHaveBeenCalledWith(
      {
        widgetInstanceId: identity.widgetInstanceId,
        widgetRevisionId: identity.revisionId,
        functionName: 'count',
        input: { values: [1, 1] },
        idempotencyKey: 'key-a',
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(Object.keys(invoke.mock.calls[0]?.[0] ?? {}).sort()).toEqual([
      'functionName',
      'idempotencyKey',
      'input',
      'widgetInstanceId',
      'widgetRevisionId',
    ]);
    expect(get).toHaveBeenCalledWith(
      { invocationId: 'invocation-a' },
      { signal: expect.any(AbortSignal) },
    );
    expect(invoke.mock.calls[0]?.[1]?.signal).toBe(get.mock.calls[0]?.[1]?.signal);
    expect(invoke.mock.calls[0]?.[1]?.signal.aborted).toBe(true);
    expect(wait).toHaveBeenCalledOnce();
  });

  test('fails closed when invoke or polling returns another revision or instance', async () => {
    const invoke = vi.fn(async () => [undefined, invocation('queued')] as const);
    const get = vi.fn(async () => [undefined, invocation('succeeded', {
      widgetRevisionId: 'revision-latest',
    })] as const);
    const bridge = createWidgetFunctionHostBridge({
      identity,
      functionDescriptors,
      transport: { api: { function: { invoke, get } } } as unknown as TWidgetRuntimeTransportPort,
      createIdempotencyKey: () => 'key-a',
      nowMs: () => 0,
      wait: async () => undefined,
      isTargetCurrent: () => true,
      pollIntervalMs: 10,
    });

    await expect(bridge.invoke({ functionName: 'count', input: {} }))
      .rejects.toThrow('identity mismatch');

    const wrongInstance = createWidgetFunctionHostBridge({
      identity,
      functionDescriptors,
      transport: {
        api: {
          function: {
            invoke: vi.fn(async () => [undefined, invocation('succeeded', {
              widgetInstanceId: 'instance-other',
            })] as const),
            get: vi.fn(),
          },
        },
      } as unknown as TWidgetRuntimeTransportPort,
      createIdempotencyKey: () => 'key-a',
      nowMs: () => 0,
      wait: async () => undefined,
      isTargetCurrent: () => true,
    });
    await expect(wrongInstance.invoke({ functionName: 'count', input: {} }))
      .rejects.toThrow('identity mismatch');
  });

  test('binds every status response to the exact invocation id and function name', async () => {
    const wrongFunction = createWidgetFunctionHostBridge({
      identity,
      functionDescriptors,
      transport: {
        api: {
          function: {
            invoke: vi.fn(async () => [undefined, invocation('succeeded', {
              functionName: 'differentFunction',
            })] as const),
            get: vi.fn(),
          },
        },
      } as unknown as TWidgetRuntimeTransportPort,
      createIdempotencyKey: () => 'key-a',
      nowMs: () => 0,
      wait: async () => undefined,
      isTargetCurrent: () => true,
    });
    await expect(wrongFunction.invoke({
      functionName: 'count',
      input: {},
    })).rejects.toThrow('identity mismatch');

    const get = vi.fn(async () => [undefined, invocation('succeeded', {
      id: 'invocation-other',
    })] as const);
    const wrongInvocation = createWidgetFunctionHostBridge({
      identity,
      functionDescriptors,
      transport: {
        api: {
          function: {
            invoke: vi.fn(async () => [undefined, invocation('queued')] as const),
            get,
          },
        },
      } as unknown as TWidgetRuntimeTransportPort,
      createIdempotencyKey: () => 'key-a',
      nowMs: () => 0,
      wait: async () => undefined,
      isTargetCurrent: () => true,
    });
    await expect(wrongInvocation.invoke({
      functionName: 'count',
      input: {},
    })).rejects.toThrow('identity mismatch');
    expect(get).toHaveBeenCalledWith(
      { invocationId: 'invocation-a' },
      { signal: expect.any(AbortSignal) },
    );
  });

  test('hard-stops a hung status request at the remaining polling deadline', async () => {
    let nowMs = 0;
    const wait = vi.fn(async (timeoutMs: number) => { nowMs += timeoutMs; });
    let getSignal: AbortSignal | undefined;
    const get = vi.fn((_input: unknown, options?: Readonly<{ signal?: AbortSignal }>) => {
      getSignal = options?.signal;
      return new Promise<never>((_resolve, reject) => {
        getSignal?.addEventListener('abort', () => reject(new Error('RPC cancelled.')), { once: true });
      });
    });
    const bridge = createWidgetFunctionHostBridge({
      identity,
      functionDescriptors: [functionDescriptor(30)],
      transport: {
        api: {
          function: {
            invoke: vi.fn(async () => [undefined, invocation('queued')] as const),
            get,
          },
        },
      } as unknown as TWidgetRuntimeTransportPort,
      createIdempotencyKey: () => 'key-a',
      nowMs: () => nowMs,
      wait,
      isTargetCurrent: () => true,
      pollIntervalMs: 10,
      pollSlackMs: 0,
    });

    await expect(bridge.invoke({
      functionName: 'count',
      input: {},
    })).rejects.toThrow('polling bound');
    expect(nowMs).toBe(30);
    expect(wait.mock.calls.map(([timeoutMs]) => timeoutMs)).toEqual([10, 20]);
    expect(get).toHaveBeenCalledOnce();
    expect(getSignal?.aborted).toBe(true);
  });

  test('stops polling when the mounted host bridge is disposed', async () => {
    let waitSignal: AbortSignal | undefined;
    const wait = vi.fn((_timeoutMs: number, signal?: AbortSignal) => {
      waitSignal = signal;
      return new Promise<void>(() => undefined);
    });
    const get = vi.fn();
    const bridge = createWidgetFunctionHostBridge({
      identity,
      functionDescriptors,
      transport: {
        api: {
          function: {
            invoke: vi.fn(async () => [undefined, invocation('queued')] as const),
            get,
          },
        },
      } as unknown as TWidgetRuntimeTransportPort,
      createIdempotencyKey: () => 'key-a',
      nowMs: () => 0,
      wait,
      isTargetCurrent: () => true,
      pollIntervalMs: 10,
    });

    const pending = bridge.invoke({ functionName: 'count', input: {} });
    await vi.waitFor(() => expect(wait).toHaveBeenCalledOnce());
    bridge.dispose();

    await expect(pending).rejects.toThrow('bridge is disposed');
    expect(waitSignal?.aborted).toBe(true);
    expect(get).not.toHaveBeenCalled();
  });

  test('retries projection lag with the exact same request and idempotency key', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce([{ code: 'WIDGET_INSTANCE_NOT_FOUND' }, undefined] as never)
      .mockResolvedValueOnce([undefined, invocation('succeeded')] as never);
    const wait = vi.fn(async () => undefined);
    const bridge = createWidgetFunctionHostBridge({
      identity,
      functionDescriptors,
      transport: {
        api: { function: { invoke, get: vi.fn() } },
      } as unknown as TWidgetRuntimeTransportPort,
      createIdempotencyKey: () => 'key-a',
      nowMs: () => 0,
      wait,
      isTargetCurrent: () => true,
    });

    await expect(bridge.invoke({
      functionName: 'count',
      input: { count: 1 },
    })).resolves.toEqual({ count: 2 });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1]?.[0]).toBe(invoke.mock.calls[0]?.[0]);
    expect(invoke.mock.calls[0]?.[0].idempotencyKey).toBe('key-a');
    expect(wait).toHaveBeenCalledWith(25, expect.any(AbortSignal));
  });

  test('stops a lag retry when the exact mounted identity is no longer current', async () => {
    let current = true;
    const invoke = vi.fn(async () => [
      { code: 'NOT_FOUND' },
      undefined,
    ] as never);
    const bridge = createWidgetFunctionHostBridge({
      identity,
      functionDescriptors,
      transport: {
        api: { function: { invoke, get: vi.fn() } },
      } as unknown as TWidgetRuntimeTransportPort,
      createIdempotencyKey: () => 'key-a',
      nowMs: () => 0,
      wait: async () => { current = false; },
      isTargetCurrent: () => current,
    });

    await expect(bridge.invoke({
      functionName: 'count',
      input: {},
    })).rejects.toThrow('no longer current');
    expect(invoke).toHaveBeenCalledOnce();
  });

  test('does not retry internal invocation failures', async () => {
    const invoke = vi.fn(async () => [
      { code: 'INTERNAL_SERVER_ERROR' },
      undefined,
    ] as never);
    const wait = vi.fn(async () => undefined);
    const bridge = createWidgetFunctionHostBridge({
      identity,
      functionDescriptors,
      transport: {
        api: { function: { invoke, get: vi.fn() } },
      } as unknown as TWidgetRuntimeTransportPort,
      createIdempotencyKey: () => 'key-a',
      nowMs: () => 0,
      wait,
      isTargetCurrent: () => true,
    });

    await expect(bridge.invoke({
      functionName: 'count',
      input: {},
    })).rejects.toThrow('invocation failed');
    expect(invoke).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
  });

  test('polls a declared 30-second function through bounded host slack without real waits', async () => {
    let nowMs = 0;
    const wait = vi.fn(async (timeoutMs: number) => { nowMs += timeoutMs; });
    const get = vi.fn(async () => [
      undefined,
      nowMs >= 31_000 ? invocation('succeeded') : invocation('queued'),
    ] as const);
    const bridge = createWidgetFunctionHostBridge({
      identity,
      functionDescriptors: [functionDescriptor(30_000)],
      transport: {
        api: {
          function: {
            invoke: vi.fn(async () => [undefined, invocation('queued')] as const),
            get,
          },
        },
      } as unknown as TWidgetRuntimeTransportPort,
      createIdempotencyKey: () => 'key-a',
      nowMs: () => nowMs,
      wait,
      isTargetCurrent: () => true,
      pollIntervalMs: 5_000,
      pollSlackMs: 2_000,
    });

    await expect(bridge.invoke({
      functionName: 'count',
      input: {},
    })).resolves.toEqual({ count: 2 });
    expect(nowMs).toBe(32_000);
    expect(wait.mock.calls.map(([timeoutMs]) => timeoutMs)).toEqual([
      5_000,
      5_000,
      5_000,
      5_000,
      5_000,
      5_000,
      2_000,
    ]);
    expect(get).toHaveBeenCalledTimes(7);
  });

  test('stops a non-terminal function at its declared timeout plus bounded slack', async () => {
    let nowMs = 0;
    const wait = vi.fn(async (timeoutMs: number) => { nowMs += timeoutMs; });
    const get = vi.fn(async () => [undefined, invocation('queued')] as const);
    const bridge = createWidgetFunctionHostBridge({
      identity,
      functionDescriptors: [functionDescriptor(30_000)],
      transport: {
        api: {
          function: {
            invoke: vi.fn(async () => [undefined, invocation('queued')] as const),
            get,
          },
        },
      } as unknown as TWidgetRuntimeTransportPort,
      createIdempotencyKey: () => 'key-a',
      nowMs: () => nowMs,
      wait,
      isTargetCurrent: () => true,
      pollIntervalMs: 5_000,
      pollSlackMs: 2_000,
    });

    await expect(bridge.invoke({
      functionName: 'count',
      input: {},
    })).rejects.toThrow('polling bound');
    expect(nowMs).toBe(32_000);
    expect(get).toHaveBeenCalledTimes(7);
  });

  test('rejects a function absent from the exact loaded revision descriptor set', async () => {
    const invoke = vi.fn();
    const bridge = createWidgetFunctionHostBridge({
      identity,
      functionDescriptors,
      transport: {
        api: { function: { invoke, get: vi.fn() } },
      } as unknown as TWidgetRuntimeTransportPort,
      createIdempotencyKey: () => 'key-a',
      nowMs: () => 0,
      wait: async () => undefined,
      isTargetCurrent: () => true,
    });

    await expect(bridge.invoke({
      functionName: 'notPublished',
      input: {},
    })).rejects.toThrow('not declared by this revision');
    expect(invoke).not.toHaveBeenCalled();
  });

  test('bounds a hung initial invoke RPC inside the descriptor deadline without teardown', async () => {
    let nowMs = 0;
    let invokeSignal: AbortSignal | undefined;
    const invoke = vi.fn((_input: unknown, options?: Readonly<{ signal?: AbortSignal }>) => {
      invokeSignal = options?.signal;
      return new Promise<never>((_resolve, reject) => {
        invokeSignal?.addEventListener('abort', () => reject(new Error('RPC cancelled.')), { once: true });
      });
    });
    const wait = vi.fn(async (timeoutMs: number) => { nowMs += timeoutMs; });
    const bridge = createWidgetFunctionHostBridge({
      identity,
      functionDescriptors: [functionDescriptor(1)],
      transport: {
        api: { function: { invoke, get: vi.fn() } },
      } as unknown as TWidgetRuntimeTransportPort,
      createIdempotencyKey: () => 'key-a',
      nowMs: () => nowMs,
      wait,
      isTargetCurrent: () => true,
      pollSlackMs: 0,
    });

    await expect(bridge.invoke({
      functionName: 'count',
      input: {},
    })).rejects.toThrow('polling bound');
    expect(invoke).toHaveBeenCalledOnce();
    expect(nowMs).toBe(1);
    expect(invokeSignal?.aborted).toBe(true);
  });

  test('caps in-flight calls and rejects every pending call immediately on teardown', async () => {
    const invoke = vi.fn(() => new Promise<never>(() => undefined));
    const bridge = createWidgetFunctionHostBridge({
      identity,
      functionDescriptors,
      transport: {
        api: { function: { invoke, get: vi.fn() } },
      } as unknown as TWidgetRuntimeTransportPort,
      createIdempotencyKey: () => 'key-a',
      nowMs: () => 0,
      wait: () => new Promise<never>(() => undefined),
      isTargetCurrent: () => true,
    });
    const pending = Array.from({ length: 8 }, (_, index) => bridge.invoke({
      functionName: 'count',
      input: { index },
    }));

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(8));
    await expect(bridge.invoke({
      functionName: 'count',
      input: { index: 8 },
    })).rejects.toThrow('at most 8 in-flight calls');
    expect(invoke).toHaveBeenCalledTimes(8);

    bridge.dispose();
    await expect(Promise.allSettled(pending)).resolves.toEqual(
      Array.from({ length: 8 }, () => expect.objectContaining({
        status: 'rejected',
        reason: expect.objectContaining({ message: 'Widget function host bridge is disposed.' }),
      })),
    );
  });
});
