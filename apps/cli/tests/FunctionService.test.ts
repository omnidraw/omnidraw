import { describe, expect, test } from 'bun:test';
import {
  CANVAS_WIDGET_EXTENSION_KEY,
  type TCanvasItemSnapshot,
} from '@omnidraw/canvas-contract';
import type {
  IDirectFunctionInvoker,
  TDirectFunctionCall,
  TDirectFunctionInvocationRequest,
} from '@omnidraw/function-runtime';
import { EphemeralResourceWritePermitAuthority } from '@omnidraw/function-runtime/local';
import type { ICanvasService } from '@omnidraw/service-canvas';
import type { TWidgetServerFunctionDescriptor } from '@omnidraw/widget-contract';
import { FunctionService } from '../src/services/FunctionService';
import type {
  TWidgetFilesystemRuntimeResolution,
  WidgetFilesystemRuntimeCatalog,
} from '../src/services/WidgetFilesystemRuntimeCatalog';
import type { ResourceService } from '../src/services/ResourceService';

const input = Object.freeze({
  canvasId: 'canvas-a',
  elementId: 'element-a',
  widgetInstanceId: 'instance-a',
  widgetKey: 'counter',
  catalogGeneration: 7,
  functionName: 'readCounter',
  input: { key: 'count' },
});

const success = Object.freeze({
  status: 'succeeded' as const,
  output: { ok: true },
  diagnostics: Object.freeze({
    code: null,
    message: null,
    logByteSize: 0,
    truncated: false,
  }),
});

function descriptor(
  effect: 'fn' | 'fx' | 'tx' = 'fx',
  resourceEffect: 'read' | 'write' | 'read_write' = 'read',
): TWidgetServerFunctionDescriptor {
  return Object.freeze({
    schemaVersion: 1,
    exportName: input.functionName,
    modulePath: 'server/main.ts',
    effect,
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    resources: effect === 'fn'
      ? []
      : [Object.freeze({ slot: 'store', effect: resourceEffect })],
    limits: Object.freeze({
      timeoutMs: 1_000,
      memoryTier: 'small' as const,
      outputByteLimit: 1_024,
      logByteLimit: 1_024,
    }),
  });
}

function canvasItem(
  binding: Readonly<{ allowRead: boolean; allowWrite: boolean }> | null,
): TCanvasItemSnapshot {
  return {
    id: input.elementId,
    item: {
      id: input.elementId,
      kind: 'widget-frame',
      extensions: {
        [CANVAS_WIDGET_EXTENSION_KEY]: {
          schemaVersion: 1,
          type: 'widget-instance',
          instanceId: input.widgetInstanceId,
          widgetKey: input.widgetKey,
          ...(binding === null ? {} : {
            resourceBindings: {
              store: {
                resourceId: 'resource-a',
                allowRead: binding.allowRead,
                allowWrite: binding.allowWrite,
              },
            },
          }),
        },
      },
    } as TCanvasItemSnapshot['item'],
    itemRevision: 3,
    createdAtMs: 1,
    updatedAtMs: 2,
  };
}

function runtimeResolution(
  functionDescriptor: TWidgetServerFunctionDescriptor,
): TWidgetFilesystemRuntimeResolution {
  const serverEntryBytes = new Uint8Array([1, 2, 3, 4]);
  const resourceEffect = functionDescriptor.resources[0]?.effect;
  return {
    widgetKey: input.widgetKey,
    catalogGeneration: input.catalogGeneration,
    catalogDigestSha256: 'b'.repeat(64),
    manifest: {
      schemaVersion: 1,
      slug: input.widgetKey,
      name: 'Counter',
      entry: 'src/main.tsx',
      capabilities: [],
      resources: resourceEffect === undefined
        ? []
        : [{ slot: 'store', kind: 'kv', effect: resourceEffect, required: true }],
    },
    release: {
      schemaVersion: 1,
      widgetKey: input.widgetKey,
      manifestSha256: 'a'.repeat(64),
      capsule: { path: 'dist/widget.capsule', sha256: 'c'.repeat(64), byteSize: 1 },
      files: [{
        path: 'server/main.ts',
        sha256: 'd'.repeat(64),
        byteSize: serverEntryBytes.byteLength,
      }],
      server: {
        entry: 'server/main.ts',
        runtimeAbi: 'omnidraw.function.v1',
        functions: { path: 'server/functions.json', sha256: 'e'.repeat(64), byteSize: 1 },
      },
    },
    capsuleBytes: new Uint8Array([0]),
    serverEntryBytes,
    functionDescriptors: [functionDescriptor],
  } as unknown as TWidgetFilesystemRuntimeResolution;
}

function directCall(request: TDirectFunctionInvocationRequest): TDirectFunctionCall {
  return Object.freeze({
    id: 'call-a',
    subject: request.subject,
    definition: request.definition,
    input: request.input,
    deadlineAtMs: Date.now() + 1_000,
  });
}

function harness(args: Readonly<{
  functionDescriptor: TWidgetServerFunctionDescriptor;
  binding: Readonly<{ allowRead: boolean; allowWrite: boolean }> | null;
  executor: IDirectFunctionInvoker;
}>): Readonly<{
  service: FunctionService;
  canvasQueries: unknown[];
  catalogKeys: string[];
  gatewayCalls: unknown[];
  gatewayRequests: unknown[];
  resolution: TWidgetFilesystemRuntimeResolution;
}> {
  const item = canvasItem(args.binding);
  const canvasQueries: unknown[] = [];
  const canvas = {
    queryItems: async (query: unknown) => {
      canvasQueries.push(query);
      return { items: [item], nextCursor: null };
    },
  } as unknown as ICanvasService;
  const resolution = runtimeResolution(args.functionDescriptor);
  const catalogKeys: string[] = [];
  const catalog = {
    resolveRuntime: async (key: string) => {
      catalogKeys.push(key);
      return resolution;
    },
    isRuntimeResolutionCurrent: (candidate: unknown) => candidate === resolution,
  } as unknown as WidgetFilesystemRuntimeCatalog;
  const gatewayCalls: unknown[] = [];
  const gatewayRequests: unknown[] = [];
  const resources = {
    getResource: async () => ({ id: 'resource-a', kind: 'kv', status: 'ready' }),
    createFunctionResourceGateway: (request: {
      requirements: readonly { slot: string; required?: boolean }[];
      bindings: readonly {
        slot: string;
        resourceId: string;
        kind: 'kv';
        allowRead: boolean;
        allowWrite: boolean;
      }[];
    }) => {
      gatewayRequests.push(request);
      const retained = new Map(request.bindings.map((binding) => [binding.slot, binding]));
      return {
        gateway: {
          call: async (call: unknown) => {
            gatewayCalls.push(call);
            return { output: { value: 41 } };
          },
        },
        bindings: {
          resolveBinding: async (slot: string) => retained.get(slot) ?? null,
        },
      };
    },
  } as unknown as ResourceService;
  const writePermits = new EphemeralResourceWritePermitAuthority({
    secret: new Uint8Array(32).fill(7),
  });
  return {
    service: new FunctionService({
      canvas,
      catalog,
      resources,
      executor: args.executor,
      writePermits,
    }),
    canvasQueries,
    catalogKeys,
    gatewayCalls,
    gatewayRequests,
    resolution,
  };
}

describe('FunctionService direct filesystem invocation', () => {
  test('pins canvas identity, catalog generation, exact server bytes, descriptors, and concrete bindings', async () => {
    let invocation: TDirectFunctionInvocationRequest | null = null;
    const executor: IDirectFunctionInvoker = {
      invoke: async (request) => {
        invocation = request;
        const resources = await request.createResources(directCall(request));
        await expect(resources.call({
          slot: 'store',
          operation: 'get',
          effect: 'read',
          input: { key: 'count' },
        })).resolves.toEqual({ output: { value: 41 } });
        return success;
      },
    };
    const setup = harness({
      functionDescriptor: descriptor('fx', 'read'),
      binding: { allowRead: true, allowWrite: false },
      executor,
    });

    await expect(setup.service.invokeFunction(input)).resolves.toEqual(success);
    expect(setup.canvasQueries).toEqual([
      {
        canvasId: input.canvasId,
        filter: { type: 'widget-instance', instanceId: input.widgetInstanceId },
        limit: 2,
      },
      {
        canvasId: input.canvasId,
        filter: { type: 'widget-instance', instanceId: input.widgetInstanceId },
        limit: 2,
      },
    ]);
    expect(setup.catalogKeys).toEqual([input.widgetKey]);
    expect(invocation).not.toBeNull();
    expect(invocation!.subject).toEqual({
      canvasId: input.canvasId,
      elementId: input.elementId,
      widgetInstanceId: input.widgetInstanceId,
    });
    expect(invocation!.definition).toEqual({
      widgetKey: input.widgetKey,
      catalogGeneration: input.catalogGeneration,
      runtimeAbi: 'omnidraw.function.v1',
      artifactDigestSha256: 'd'.repeat(64),
      descriptor: setup.resolution.functionDescriptors[0],
    });
    expect(invocation!.artifact).toEqual(setup.resolution.serverEntryBytes!);
    expect(setup.gatewayRequests).toEqual([{
      requirements: setup.resolution.manifest.resources,
      bindings: [{
        slot: 'store',
        resourceId: 'resource-a',
        kind: 'kv',
        allowRead: true,
        allowWrite: false,
      }],
    }]);
    expect(setup.gatewayCalls).toEqual([{
      slot: 'store',
      operation: 'get',
      effect: 'read',
      input: { key: 'count' },
    }]);
  });

  test('denies an effect that exceeds the function descriptor before provider access', async () => {
    const executor: IDirectFunctionInvoker = {
      invoke: async (request) => {
        const resources = await request.createResources(directCall(request));
        return resources.call({
          slot: 'store',
          operation: 'set',
          effect: 'write',
          input: { key: 'count', value: 42 },
        }) as never;
      },
    };
    const setup = harness({
      functionDescriptor: descriptor('fx', 'write'),
      binding: { allowRead: false, allowWrite: true },
      executor,
    });

    await expect(setup.service.invokeFunction(input)).rejects.toMatchObject({
      code: 'RESOURCE_SCOPE_INVALID',
      message: 'Function resource call denied: fx_write.',
    });
    expect(setup.gatewayCalls).toEqual([]);
  });

  test('forwards live cancellation and returns the direct terminal result', async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let observedSignal: AbortSignal | undefined;
    const executor: IDirectFunctionInvoker = {
      invoke: async (request) => {
        observedSignal = request.signal;
        entered();
        return new Promise((resolve) => {
          request.signal?.addEventListener('abort', () => resolve({
            status: 'cancelled',
            output: null,
            failure: {
              owner: 'cancelled',
              code: 'FUNCTION_CANCELLED',
              message: 'Function invocation was cancelled.',
            },
            diagnostics: {
              code: 'FUNCTION_CANCELLED',
              message: 'Function invocation was cancelled.',
              logByteSize: 0,
              truncated: false,
            },
          }), { once: true });
        });
      },
    };
    const setup = harness({ functionDescriptor: descriptor('fn'), binding: null, executor });
    const controller = new AbortController();
    const call = setup.service.invokeFunction(input, controller.signal);
    await started;
    expect(observedSignal).toBe(controller.signal);
    controller.abort();
    await expect(call).resolves.toMatchObject({
      status: 'cancelled',
      failure: { code: 'FUNCTION_CANCELLED' },
    });
  });

  test('exposes no invocation history, status, logs, usage, or cancellation control after restart', () => {
    const executor: IDirectFunctionInvoker = { invoke: async () => success };
    const first = harness({ functionDescriptor: descriptor('fn'), binding: null, executor }).service;
    const restarted = harness({ functionDescriptor: descriptor('fn'), binding: null, executor }).service;
    expect(Object.getOwnPropertyNames(FunctionService.prototype).sort()).toEqual([
      'constructor',
      'invokeFunction',
    ]);
    for (const service of [first, restarted]) {
      expect('getFunction' in service).toBe(false);
      expect('cancelFunction' in service).toBe(false);
      expect('listFunctionLogs' in service).toBe(false);
      expect('getFunctionUsage' in service).toBe(false);
    }
  });
});
