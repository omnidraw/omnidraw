import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'bun:test';
import * as BunHttpServer from '@effect/platform-bun/BunHttpServer';
import {
  WIDGET_SERVER_MODULE_ABI,
  WIDGET_SERVER_MODULE_FORMAT,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  type TWidgetServerFunctionDescriptor,
} from '@omnidraw/sdk/contract';
import {
  CANVAS_WIDGET_EXTENSION_KEY,
  type TCanvasItemSnapshot,
} from '@omnidraw/canvas-contract';
import { Effect, Fiber, Layer, Stream } from 'effect';
import { HttpRouter, HttpServer } from 'effect/unstable/http';
import { RpcClient, RpcSerialization } from 'effect/unstable/rpc';
import { Socket } from 'effect/unstable/socket';
import type { ICanvasService } from '../../canvas/authority';
import { FunctionService } from '../FunctionService';
import type {
  TDirectFunctionDefinition,
  TDirectFunctionInvocationRequest,
} from '../index';
import {
  BunChildFunctionProcessDriver,
  DirectFunctionExecutor,
  EphemeralResourceWritePermitAuthority,
  JsonSchemaFunctionValidator,
} from '../local';
import {
  createBunChildCage,
  liveBunChildProcessGroupController,
  removeBunChildCage,
  terminateBunChild,
  type TBunChildCage,
} from '../local/BunChildLifecycle';
import type { ResourceService } from '../../resources/ResourceService';
import type {
  TWidgetFilesystemRuntimeResolution,
  WidgetFilesystemRuntimeCatalog,
} from '../../widget/WidgetFilesystemRuntimeCatalog';
import { layerPrivateEffectRpc } from '../../transport/layer.effect-rpc';
import { PrivateRpcError, PrivateTransportRpcs } from '../../transport/rpc-contract';
import { RpcDispatcher } from '../../transport/service.rpc-dispatcher';
import { apiInvokeFunction } from '../../api/function/api.invoke-function';
import type { Json } from 'effect/Schema';

const WORKER_PATH = fileURLToPath(new URL('../local/function-worker.ts', import.meta.url));
const roots = new Set<string>();

afterEach(async () => {
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })));
  roots.clear();
});

const sha256 = (value: string | Uint8Array): string => (
  createHash('sha256').update(value).digest('hex')
);

function canonicalModule(timeoutMs: number): Readonly<{
  bytes: Uint8Array;
  definition: TDirectFunctionDefinition;
}> {
  const descriptor = Object.freeze({
    schemaVersion: 1,
    exportName: 'lifecycle',
    effect: 'fn',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        mode: Object.freeze({ enum: Object.freeze(['success', 'failure', 'hang', 'context']) }),
      }),
      required: Object.freeze(['mode']),
      additionalProperties: false,
    }),
    outputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({ ok: Object.freeze({ type: 'boolean' }) }),
      required: Object.freeze(['ok']),
      additionalProperties: false,
    }),
    resources: Object.freeze([]),
    limits: Object.freeze({
      timeoutMs,
      memoryTier: 'small',
      outputByteLimit: 1_024,
      logByteLimit: 0,
    }),
  }) satisfies TWidgetServerFunctionDescriptor;
  const registration = {
    schemaVersion: descriptor.schemaVersion,
    effect: descriptor.effect,
    inputSchema: descriptor.inputSchema,
    outputSchema: descriptor.outputSchema,
    resources: descriptor.resources,
    limits: descriptor.limits,
  };
  const source = [
    `const registration = Object.freeze(${JSON.stringify(registration)});`,
    'const lifecycle = async () => { throw new Error("Server functions require the host bridge."); };',
    'Object.defineProperties(lifecycle, {',
    '  __omnidrawServerFunction: { enumerable: false, value: "omnidraw.server-function.v1" },',
    '  __omnidrawRegistration: { enumerable: false, value: registration },',
    '  __omnidrawExecute: { enumerable: false, value: async (context, input) => {',
    '    if (input.mode === "failure") throw new Error("fixture handler failure");',
    '    if (input.mode === "hang") return await new Promise(() => undefined);',
    '    if (input.mode === "context") return { ok: !("catalogGeneration" in context)',
    '      && context.signal.aborted === false',
    '      && typeof context.signal.throwIfAborted === "function"',
    '      && typeof context.signal.addEventListener === "function"',
    '      && !("onabort" in context.signal) };',
    '    return { ok: true };',
    '  } },',
    '});',
    'Object.freeze(lifecycle);',
    'export { lifecycle };',
    '',
  ].join('\n');
  const bytes = new TextEncoder().encode(source);
  const functionDescriptors = Object.freeze([descriptor]);
  return Object.freeze({
    bytes,
    definition: Object.freeze({
      widgetKey: 'qualification-widget',
      catalogGeneration: 1,
      serverModule: Object.freeze({
        format: WIDGET_SERVER_MODULE_FORMAT,
        abi: WIDGET_SERVER_MODULE_ABI,
        moduleDigestSha256: sha256(bytes),
        functionDescriptors,
        functionDescriptorsDigestSha256: sha256(
          fnCanonicalizeWidgetServerFunctionDescriptors(functionDescriptors),
        ),
      }),
      descriptor,
    }),
  });
}

type THarness = Awaited<ReturnType<typeof createHarness>>;

async function createHarness() {
  const root = await mkdtemp(join(tmpdir(), 'omnidraw-real-function-child-'));
  roots.add(root);
  const spawnCommands: string[][] = [];
  const terminations: Array<Readonly<{ pid: number; cage: TBunChildCage }>> = [];
  const groupSignals: Array<Readonly<{ pid: number; signal: NodeJS.Signals }>> = [];
  let sequence = 0;
  const processGroups = Object.freeze({
    signal(pid: number, signal: NodeJS.Signals) {
      groupSignals.push(Object.freeze({ pid, signal }));
      liveBunChildProcessGroupController.signal(pid, signal);
    },
    exists: liveBunChildProcessGroupController.exists,
  });
  const spawn = ((command: string[], options: object) => {
    spawnCommands.push([...command]);
    return Bun.spawn(command, options as never);
  }) as typeof Bun.spawn;
  const driver = new BunChildFunctionProcessDriver({
    executable: process.execPath,
    workerPath: WORKER_PATH,
    tempRoot: root,
    spawn,
    nowMs: Date.now,
    createId: () => `real-child-${sequence++}`,
    timers: Object.freeze({
      setTimeout: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
      clearTimeout: (timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>),
      setInterval: (callback: () => void, delayMs: number) => setInterval(callback, delayMs),
      clearInterval: (timer: unknown) => clearInterval(timer as ReturnType<typeof setInterval>),
    }),
    readRssBytes: async () => 1,
    readCpuMs: async () => 0,
    createCage: createBunChildCage,
    removeCage: removeBunChildCage,
    terminateChild: async (child, cage, graceMs, groups) => {
      terminations.push(Object.freeze({ pid: child.pid, cage }));
      await terminateBunChild(child, cage, graceMs, groups);
    },
    processGroups,
    startupTimeoutMs: 5_000,
    cancelGraceMs: 100,
  });
  const executor = new DirectFunctionExecutor({
    driver,
    schemas: new JsonSchemaFunctionValidator(),
    nowMs: Date.now,
    createId: () => `invocation-${sequence++}`,
  });
  return Object.freeze({
    root,
    driver,
    executor,
    processGroups,
    spawnCommands,
    terminations,
    groupSignals,
  });
}

function invocation(
  module: ReturnType<typeof canonicalModule>,
  mode: 'success' | 'failure' | 'hang' | 'context',
  patch: Partial<TDirectFunctionInvocationRequest> = {},
): TDirectFunctionInvocationRequest {
  return {
    subject: Object.freeze({
      canvasId: 'canvas-qualification',
      elementId: 'element-qualification',
      widgetInstanceId: 'instance-qualification',
    }),
    definition: module.definition,
    artifact: module.bytes,
    input: Object.freeze({ mode }),
    createResources: () => Object.freeze({ call: async () => ({ output: null }) }),
    ...patch,
  };
}

const RPC_FUNCTION_INPUT = Object.freeze({
  canvasId: 'canvas-qualification',
  elementId: 'element-qualification',
  widgetInstanceId: 'instance-qualification',
  widgetKey: 'qualification-widget',
  catalogGeneration: 1,
  functionName: 'lifecycle',
  input: Object.freeze({ mode: 'hang' }),
});

function rpcFunctionService(
  harness: THarness,
  module: ReturnType<typeof canonicalModule>,
): FunctionService {
  const item: TCanvasItemSnapshot = {
    id: RPC_FUNCTION_INPUT.elementId,
    item: {
      id: RPC_FUNCTION_INPUT.elementId,
      kind: 'widget-frame',
      extensions: {
        [CANVAS_WIDGET_EXTENSION_KEY]: {
          schemaVersion: 1,
          type: 'widget-instance',
          instanceId: RPC_FUNCTION_INPUT.widgetInstanceId,
          widgetKey: RPC_FUNCTION_INPUT.widgetKey,
        },
      },
    } as TCanvasItemSnapshot['item'],
    itemRevision: 1,
    createdAtMs: 1,
    updatedAtMs: 1,
  };
  const canvas = {
    queryItems: async () => Object.freeze({ items: Object.freeze([item]), nextCursor: null }),
  } as unknown as ICanvasService;
  const path = 'server-dist/main.mjs';
  const resolution = {
    widgetKey: RPC_FUNCTION_INPUT.widgetKey,
    catalogGeneration: RPC_FUNCTION_INPUT.catalogGeneration,
    catalogDigestSha256: 'a'.repeat(64),
    manifest: {
      schemaVersion: 1,
      slug: RPC_FUNCTION_INPUT.widgetKey,
      name: 'Qualification widget',
      entry: 'src/main.tsx',
      capabilities: [],
      resources: [],
    },
    release: {
      schemaVersion: 1,
      widgetKey: RPC_FUNCTION_INPUT.widgetKey,
      manifestSha256: 'b'.repeat(64),
      capsule: { path: 'dist/widget.capsule', sha256: 'c'.repeat(64), byteSize: 1 },
      files: [{
        path,
        sha256: module.definition.serverModule.moduleDigestSha256,
        byteSize: module.bytes.byteLength,
      }],
      server: {
        entry: path,
        format: module.definition.serverModule.format,
        abi: module.definition.serverModule.abi,
        functionsPath: 'functions.json',
        moduleDigestSha256: module.definition.serverModule.moduleDigestSha256,
        functionsDigestSha256:
          module.definition.serverModule.functionDescriptorsDigestSha256,
      },
    },
    capsuleBytes: new Uint8Array([0]),
    serverEntryBytes: module.bytes,
    functionDescriptors: module.definition.serverModule.functionDescriptors,
  } as unknown as TWidgetFilesystemRuntimeResolution;
  const catalog = {
    resolveRuntime: async () => resolution,
    isRuntimeResolutionCurrent: (candidate: unknown) => candidate === resolution,
  } as unknown as WidgetFilesystemRuntimeCatalog;
  const resources = {
    createFunctionResourceGateway: () => Object.freeze({
      gateway: Object.freeze({ call: async () => Object.freeze({ output: null }) }),
      bindings: Object.freeze({ resolveBinding: async () => null }),
    }),
  } as unknown as ResourceService;
  return new FunctionService({
    canvas,
    catalog,
    resources,
    executor: harness.executor,
    writePermits: new EphemeralResourceWritePermitAuthority({
      secret: new Uint8Array(32).fill(11),
      nowMs: Date.now,
      createId: () => 'rpc-permit',
      createNonce: () => 'rpc-nonce',
    }),
    nowMs: Date.now,
  });
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for function child state.');
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

function rpcDisconnectLayer(
  service: FunctionService,
  observeSocket: (socket: WebSocket) => void,
  observeResult: (result: unknown) => void,
) {
  const invoke = apiInvokeFunction.callable({ context: { functionInvocation: service } });
  const dispatcher = Layer.succeed(RpcDispatcher)(RpcDispatcher.of({
    request: (args) => Effect.tryPromise({
      try: async (signal) => {
        if (args.path !== 'function.invoke') throw new Error('Unexpected test RPC path.');
        const result = await invoke(args.input as never, { signal }) as Json;
        observeResult(result);
        return result;
      },
      catch: (cause) => new PrivateRpcError({
        code: 'INTERNAL_SERVER_ERROR',
        status: 500,
        message: cause instanceof Error ? cause.message : 'Function RPC failed.',
        details: null,
      }),
    }),
    stream: () => Stream.fail(new PrivateRpcError({
      code: 'BAD_REQUEST',
      status: 400,
      message: 'The disconnect qualification does not expose a stream.',
      details: null,
    })),
  }));
  const rpcRoutes = layerPrivateEffectRpc.pipe(Layer.provide(dispatcher));
  const server = HttpRouter.serve(rpcRoutes, {
    disableListenLog: true,
    disableLogger: true,
  }).pipe(Layer.provideMerge(BunHttpServer.layerTest));
  const socketConstructor = Layer.succeed(Socket.WebSocketConstructor)(
    (url, protocols) => {
      const socket = new WebSocket(url, protocols);
      observeSocket(socket);
      return socket;
    },
  );
  const socket = Layer.unwrap(Effect.map(HttpServer.HttpServer, (httpServer) => {
    const address = httpServer.address;
    if (address._tag === 'UnixAddress') throw new Error('Unexpected Unix test server address.');
    return Socket.layerWebSocket(`ws://127.0.0.1:${address.port}/rpc`).pipe(
      Layer.provide(socketConstructor),
    );
  }));
  const clientProtocol = RpcClient.layerProtocolSocket({ retryTransientErrors: false }).pipe(
    Layer.provide(socket),
  );
  return clientProtocol.pipe(
    Layer.provideMerge(server),
    Layer.provide(RpcSerialization.layerNdjson),
  );
}

async function expectFullyReaped(harness: THarness, expectedChildren: number): Promise<void> {
  expect(harness.driver.name).toBe('bun-child');
  expect(harness.executor.diagnostics()).toEqual({ activeCalls: 0, maxConcurrent: 4 });
  expect(harness.driver.diagnostics()).toEqual({
    warmTtlMs: 0,
    preparedInvocationCount: 0,
    activeGuestCount: 0,
    activeGuestPids: [],
    activeGuestProcessGroupIds: [],
    activeGuestRssBytes: 0,
    teardownFailures: [],
  });
  expect(harness.spawnCommands).toHaveLength(expectedChildren);
  expect(harness.terminations).toHaveLength(expectedChildren);
  expect(await readdir(harness.root)).toEqual([]);
  for (const command of harness.spawnCommands) {
    expect(command).toEqual([process.execPath, WORKER_PATH, '--function-worker']);
    expect(command.join(' ')).not.toMatch(/cloudflare|wrangler|workerd|miniflare|https?:/i);
  }
  for (const { pid } of harness.terminations) {
    expect(harness.processGroups.exists(pid)).toBe(false);
    expect(harness.groupSignals).toContainEqual({ pid, signal: 'SIGTERM' });
  }
}

describe('real disposable Bun function child qualification', () => {
  test('executes exact raw canonical module bytes locally and retains no invocation history', async () => {
    const harness = await createHarness();
    const module = canonicalModule(3_000);
    const source = new TextDecoder().decode(module.bytes);
    expect(source).toContain('export { lifecycle };');
    expect(() => JSON.parse(source)).toThrow();
    expect(module.definition.serverModule.moduleDigestSha256).toBe(sha256(module.bytes));

    await expect(harness.executor.invoke(invocation(module, 'success'))).resolves.toEqual({
      status: 'succeeded',
      output: { ok: true },
      diagnostics: { code: null, message: null, logByteSize: 0, truncated: false },
    });
    await expect(harness.executor.invoke(invocation(module, 'success'))).resolves.toMatchObject({
      status: 'succeeded',
      output: { ok: true },
    });
    await expect(harness.executor.invoke(invocation(module, 'context'))).resolves.toMatchObject({
      status: 'succeeded',
      output: { ok: true },
    });

    await expectFullyReaped(harness, 3);
  }, 15_000);

  test('reaps the real process group after a handler failure', async () => {
    const harness = await createHarness();
    const module = canonicalModule(3_000);

    await expect(harness.executor.invoke(invocation(module, 'failure'))).resolves.toMatchObject({
      status: 'failed',
      failure: { owner: 'user', code: 'FUNCTION_HANDLER_FAILED' },
    });

    await expectFullyReaped(harness, 1);
  }, 15_000);

  test('reaps the real process group after the host deadline', async () => {
    const harness = await createHarness();
    const module = canonicalModule(750);

    await expect(harness.executor.invoke(invocation(module, 'hang'))).resolves.toMatchObject({
      status: 'timed_out',
      failure: { owner: 'cancelled', code: 'FUNCTION_TIMED_OUT' },
    });

    await expectFullyReaped(harness, 1);
  }, 15_000);

  test('reaps the real process group after request cancellation or parent disconnect', async () => {
    const harness = await createHarness();
    const module = canonicalModule(3_000);
    const controller = new AbortController();
    let resourcesCreated!: () => void;
    const readyForExecution = new Promise<void>((resolve) => { resourcesCreated = resolve; });
    const call = harness.executor.invoke(invocation(module, 'hang', {
      signal: controller.signal,
      createResources: () => {
        resourcesCreated();
        return Object.freeze({ call: async () => ({ output: null }) });
      },
    }));
    await readyForExecution;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    controller.abort('parent disconnected');

    await expect(call).resolves.toMatchObject({
      status: 'cancelled',
      failure: { owner: 'cancelled', code: 'FUNCTION_CANCELLED' },
    });

    await expectFullyReaped(harness, 1);
  }, 15_000);

  test('reaps the real process group when the physical function RPC disconnects', async () => {
    const harness = await createHarness();
    const module = canonicalModule(10_000);
    const service = rpcFunctionService(harness, module);
    let resolveSocket!: (socket: WebSocket) => void;
    const physicalSocket = new Promise<WebSocket>((resolve) => { resolveSocket = resolve; });
    let resolveResult!: (result: unknown) => void;
    const serverResult = new Promise<unknown>((resolve) => { resolveResult = resolve; });
    const layer = rpcDisconnectLayer(service, resolveSocket, resolveResult);

    const cancelledResult = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const client = yield* RpcClient.make(PrivateTransportRpcs);
      const request = yield* Effect.forkChild(client['omnidraw.request.v1']({
        path: 'function.invoke',
        input: RPC_FUNCTION_INPUT,
      }));
      yield* Effect.promise(() => waitUntil(
        () => harness.driver.diagnostics().activeGuestCount === 1
          && harness.executor.diagnostics().activeCalls === 1,
        5_000,
      ));
      const socket = yield* Effect.promise(() => physicalSocket);
      socket.close(4001, 'qualification transport disconnect');
      const result = yield* Effect.promise(() => serverResult);
      yield* Fiber.interrupt(request);
      return result;
    }).pipe(Effect.provide(layer))));

    expect(cancelledResult).toMatchObject({
      status: 'cancelled',
      failure: { owner: 'cancelled', code: 'FUNCTION_CANCELLED' },
    });
    await waitUntil(
      () => harness.driver.diagnostics().activeGuestCount === 0
        && harness.executor.diagnostics().activeCalls === 0,
      5_000,
    );
    await expectFullyReaped(harness, 1);
  }, 15_000);
});
