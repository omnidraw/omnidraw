import { Effect, Layer, Stream } from "effect";
import { fxRecoverAfterReconnect } from "@/core/app/fx.recover-after-reconnect";
import type { TBackendCanvas } from "@/core/app/backend.types";
import { fnJsonSafe } from "@/core/app/fn.json-safe";
import { PrivateRpcError } from "@/core/app/private-rpc-error";
import type {
  TPrivateRequestInput,
  TPrivateRequestOutput,
  TPrivateRequestPath,
  TPrivateStreamOutput,
  TPrivateStreamPath,
} from "@/core/app/private-operation-contract";
import {
  FrontendTransport,
  frontendTransportFailure,
  type TFrontendTransportRequest,
  type TFrontendTransportStreamRequest,
} from "@/core/app/service.frontend-transport";
import {
  StartupApplicationState,
  StartupCanvasCatalog,
  StartupFence,
  StartupNavigation,
  StartupNotifications,
  type TStartupCanvasServices,
} from "@/core/app/startup-canvas";
import { ChatRecoveryBackend } from "@/core/chat/fx.recover-chat";
import { NotificationSink } from "@/core/notifications/service.notification-sink";
import { DbResources, type TDbResourceRequestPath } from "@/core/resources/service.db-resources";
import { fnClampWidgetPlacementPosition, fnHasWidgetPlacementDragThreshold } from "@/core/widgets/fn.pointer-placement";
import { createFrontendSimRuntime } from "@/sim/runtime";
import { ScriptedFrontendConnection } from "@/sim/transport/scripted-connection";
import { FrontendRpcConnectionGenerations } from "@/shell/transport/rpc";
import type { TRpcConformanceHarness } from "../rpc.suite";
import type { TStartupConformanceHarness } from "../startup.suite";
import type { TReconnectConformanceHarness, TReconnectLease } from "../reconnect.suite";
import type { TWidgetPlacementConformanceHarness } from "../widget-placement.suite";
import type { TChatConformanceHarness } from "../chat.suite";
import type { TResourcesConformanceHarness } from "../resources.suite";

export type TFullConformanceHarness = TRpcConformanceHarness
  & TStartupConformanceHarness
  & TReconnectConformanceHarness
  & TWidgetPlacementConformanceHarness
  & TChatConformanceHarness
  & TResourcesConformanceHarness
  & Readonly<{ dispose(): Promise<void> }>;

const lostAck = () => new PrivateRpcError({
  code: "CONFORMANCE_LOST_ACK",
  status: 503,
  message: "The commit completed but its acknowledgement was lost.",
  details: null,
});

type TDriverOutcome = Readonly<{ value: unknown; loseAck: boolean }>;

class LiveLayerDriver {
  readonly #queues = new Map<string, TDriverOutcome[]>();
  readonly #committed = new Map<string, unknown>();
  readonly #records: Array<Readonly<{ path: string; input: unknown; idempotencyKey?: string; replayed: boolean }>> = [];
  readonly #streams = new Map<string, readonly unknown[]>();
  readonly #streamRecords: Array<Readonly<{
    path: string;
    input: unknown;
    afterCursor?: number;
    signal?: AbortSignal;
  }>> = [];
  #closedStreams = 0;

  script(path: string, value: unknown, loseAck = false): void {
    const queue = this.#queues.get(path) ?? [];
    queue.push({ value, loseAck });
    this.#queues.set(path, queue);
  }

  request<Path extends TPrivateRequestPath>(request: TFrontendTransportRequest<Path>): TPrivateRequestOutput<Path> {
    const input = fnJsonSafe(request.input);
    const replayed = request.idempotencyKey !== undefined && this.#committed.has(request.idempotencyKey);
    this.#records.push({
      path: request.path,
      input,
      ...(request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey }),
      replayed,
    });
    if (replayed) return this.#committed.get(request.idempotencyKey!) as TPrivateRequestOutput<Path>;
    const outcome = this.#queues.get(request.path)?.shift();
    if (outcome === undefined) throw new Error(`No live conformance response for '${request.path}'.`);
    if (request.idempotencyKey !== undefined) this.#committed.set(request.idempotencyKey, outcome.value);
    if (outcome.loseAck) throw lostAck();
    return outcome.value as TPrivateRequestOutput<Path>;
  }

  records() {
    return [...this.#records];
  }

  scriptStream(path: string, events: readonly unknown[]): void {
    this.#streams.set(path, events);
  }

  stream<Path extends TPrivateStreamPath>(request: TFrontendTransportStreamRequest<Path>): AsyncIterable<TPrivateStreamOutput<Path>> {
    const events = this.#streams.get(request.path);
    if (events === undefined) throw new Error(`No live conformance stream for '${request.path}'.`);
    this.#streamRecords.push({ ...request });
    const driver = this;
    return {
      async *[Symbol.asyncIterator]() {
        try {
          for (const event of events) {
            if (request.signal?.aborted) throw new Error("Live conformance stream was aborted.");
            yield event as TPrivateStreamOutput<Path>;
          }
        } finally {
          driver.#closedStreams += 1;
        }
      },
    };
  }

  streamRecords() { return [...this.#streamRecords]; }
  closedStreamCount() { return this.#closedStreams; }
}

export function createLiveConformanceHarness(): TFullConformanceHarness {
  const driver = new LiveLayerDriver();
  const generations = new FrontendRpcConnectionGenerations();
  let canvases: TBackendCanvas[] = [];
  let createCount = 0;
  let currentRequest = 1;
  let nextId = 1;
  const navigations: Array<Readonly<{ path: string }>> = [];
  const chatCalls: string[] = [];
  const transport = FrontendTransport.of({
    request: <Path extends TPrivateRequestPath>(request: TFrontendTransportRequest<Path>) => Effect.try({
      try: () => driver.request(request),
      catch: frontendTransportFailure,
    }),
    stream: <Path extends TPrivateStreamPath>(request: TFrontendTransportStreamRequest<Path>) => Stream.fromAsyncIterable(
      driver.stream(request),
      frontendTransportFailure,
    ),
  });
  const dbResources = DbResources.of({
    read: <Path extends TDbResourceRequestPath>(path: Path, input: TPrivateRequestInput<Path>) => Effect.try({
      try: () => driver.request({ path, input } as TFrontendTransportRequest<Path>) as TPrivateRequestOutput<Path>,
      catch: frontendTransportFailure,
    }),
    write: <Path extends TDbResourceRequestPath>(path: Path, input: TPrivateRequestInput<Path>) => Effect.try({
      try: () => driver.request({ path, input } as TFrontendTransportRequest<Path>) as TPrivateRequestOutput<Path>,
      catch: frontendTransportFailure,
    }),
  });
  const layer = Layer.mergeAll(
    Layer.succeed(FrontendTransport, transport),
    Layer.succeed(DbResources, dbResources),
    Layer.succeed(NotificationSink, NotificationSink.of({ show: () => Effect.void })),
    Layer.succeed(ChatRecoveryBackend, ChatRecoveryBackend.of({
      history: (scope) => Effect.try({
        try: () => {
          chatCalls.push("agent.chat.history");
          return driver.request({
            path: "agent.chat.history",
            input: { widgetId: scope.componentId, sessionId: scope.sessionId },
          });
        },
        catch: frontendTransportFailure,
      }),
    })),
    Layer.succeed(StartupCanvasCatalog, StartupCanvasCatalog.of({
      list: () => Effect.succeed([...canvases]),
      create: (name) => Effect.sync(() => {
        createCount += 1;
        const value = Object.freeze({ id: `live-canvas-${nextId++}`, name, revision: 1 });
        canvases = [...canvases, value];
        return value;
      }),
    })),
    Layer.succeed(StartupApplicationState, StartupApplicationState.of({
      setCanvases: (value) => Effect.sync(() => { canvases = [...value]; }),
    })),
    Layer.succeed(StartupNavigation, StartupNavigation.of({
      navigate: (path) => Effect.sync(() => { navigations.push({ path }); }),
    })),
    Layer.succeed(StartupNotifications, StartupNotifications.of({ showError: () => Effect.void })),
    Layer.succeed(StartupFence, StartupFence.of({ current: (id) => Effect.succeed(id === currentRequest) })),
  );
  type TLiveServices = FrontendTransport | DbResources | NotificationSink | ChatRecoveryBackend | TStartupCanvasServices;
  const run = <A, E>(program: Effect.Effect<A, E, TLiveServices>) => Effect.runPromise(Effect.provide(program, layer));
  return {
    scriptCommitThenLoseAck(path, value) { driver.script(path, value, true); },
    scriptFailure(path) { driver.script(path, undefined, true); },
    script(path, value) { driver.script(path, value); },
    scriptStream(path, events) { driver.scriptStream(path, events); },
    scriptRecovery(value) {
      driver.script("agent.chat.history", value);
    },
    runRequest: run,
    runStream: run,
    runStartup: run,
    runRecovery: run,
    runRows: run,
    runRename: run,
    records: () => driver.records(),
    streamRecords: () => driver.streamRecords(),
    closedStreamCount: () => driver.closedStreamCount(),
    calls: () => [...chatCalls],
    setCurrentRequest(id) { currentRequest = id; },
    canvases: () => [...canvases],
    createCount: () => createCount,
    navigations: () => [...navigations],
    snapshot: () => generations.snapshot(),
    lease: () => generations.lease(),
    connect: () => generations.connected(),
    disconnect: () => generations.disconnected(),
    isCurrent(lease: TReconnectLease) {
      try {
        generations.assertCurrent(lease as ReturnType<typeof generations.lease>);
        return true;
      } catch {
        return false;
      }
    },
    runReconnectRecovery: (program) => Effect.runPromise(program),
    recoveryProgram: fxRecoverAfterReconnect,
    observeRecoveryGeneration: () => Effect.sync(() => generations.snapshot()),
    awaitRecoveryGenerationChange: (generation) => Effect.map(
      Effect.tryPromise({
        try: (signal) => generations.waitForConnectionAfter(generation, signal),
        catch: frontendTransportFailure,
      }),
      (snapshot) => snapshot,
    ),
    waitForRecoveryAttempt: () => Promise.resolve(),
    advanceRecoveryTime: () => Promise.resolve(),
    threshold: fnHasWidgetPlacementDragThreshold,
    clamp: fnClampWidgetPlacementPosition,
    dispose: async () => undefined,
  };
}

export function createSimConformanceHarness(): TFullConformanceHarness {
  const runtime = createFrontendSimRuntime({ browser: { idPrefix: "sim", firstId: 1, firstTimeMillis: 10 } });
  const connection = new ScriptedFrontendConnection();
  const chatCalls = () => runtime.transport.records()
    .filter((entry) => entry.path === "agent.chat.connect" || entry.path === "agent.chat.history")
    .map((entry) => entry.path);
  return {
    scriptCommitThenLoseAck(path, value) {
      runtime.transport.enqueueRequest(path, { committedValue: value, lostAcknowledgement: lostAck() });
    },
    scriptFailure(path) { runtime.transport.enqueueRequest(path, { failure: lostAck() }); },
    script(path, value) { runtime.transport.enqueueRequest(path, { value }); },
    scriptStream(path, events) { runtime.transport.enqueueStream(path, events); },
    scriptRecovery(value) {
      runtime.transport.enqueueRequest("agent.chat.history", { value });
    },
    runRequest: (program) => runtime.runPromise(program),
    runStream: (program) => runtime.runPromise(program),
    runStartup: (program) => runtime.runPromise(program),
    runRecovery: (program) => runtime.runPromise(program),
    runRows: (program) => runtime.runPromise(program),
    runRename: (program) => runtime.runPromise(program),
    records: () => runtime.transport.records(),
    streamRecords: () => runtime.transport.streamRecords(),
    closedStreamCount: () => runtime.transport.closedStreamCount(),
    calls: chatCalls,
    setCurrentRequest: (id) => runtime.setCurrentStartupRequest(id),
    canvases: () => runtime.canvases(),
    createCount: () => runtime.startupCreateCount(),
    navigations: () => runtime.navigation.entries(),
    snapshot: () => connection.snapshot(),
    lease: () => connection.lease(),
    connect: () => connection.step("connect"),
    disconnect: () => connection.step("disconnect"),
    isCurrent(lease: TReconnectLease) {
      try {
        connection.assertCurrent(lease as ReturnType<typeof connection.lease>);
        return true;
      } catch {
        return false;
      }
    },
    runReconnectRecovery: (program) => runtime.runPromise(program),
    recoveryProgram: fxRecoverAfterReconnect,
    observeRecoveryGeneration: () => Effect.sync(() => connection.snapshot()),
    awaitRecoveryGenerationChange: (generation) => connection.awaitConnectedAfter(generation),
    waitForRecoveryAttempt: (attempts, expected) => runtime.waitForRecoveryAttempt(attempts, expected),
    advanceRecoveryTime: (durationMillis) => runtime.advanceTime(durationMillis),
    threshold: fnHasWidgetPlacementDragThreshold,
    clamp: fnClampWidgetPlacementPosition,
    dispose: () => runtime.dispose(),
  };
}
