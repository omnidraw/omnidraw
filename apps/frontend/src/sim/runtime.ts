import { Effect, Layer, ManagedRuntime } from "effect";
import { TestClock } from "effect/testing";
import type { TBackendCanvas } from "@/core/app/backend.types";
import type {
  TFrontendTransportFailure,
  TFrontendTransportRequest,
} from "@/core/app/service.frontend-transport";
import { frontendTransportFailure, FrontendTransport } from "@/core/app/service.frontend-transport";
import type {
  TPrivateRequestInput,
  TPrivateRequestOutput,
} from "@/core/app/private-operation-contract";
import type { TDbResourceRequestPath } from "@/core/resources/service.db-resources";
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
import { DbResources } from "@/core/resources/service.db-resources";
import { ControlledFrontendBrowser, type TControlledBrowserSeed } from "./browser/controlled-browser";
import { RecordedFrontendNavigation } from "./navigation/recorded-navigation";
import { RecordedFrontendNotifications } from "./notifications/recorded-notifications";
import { FrontendMemoryStorage } from "./storage/memory-storage";
import { ScriptedFrontendTransport } from "./transport/scripted-transport";

export type TFrontendSimServices =
  | FrontendTransport
  | DbResources
  | NotificationSink
  | ChatRecoveryBackend
  | TStartupCanvasServices;

export type TFrontendSimRuntime = Readonly<{
  browser: ControlledFrontendBrowser;
  storage: FrontendMemoryStorage;
  navigation: RecordedFrontendNavigation;
  notifications: RecordedFrontendNotifications;
  transport: ScriptedFrontendTransport;
  canvases(): readonly TBackendCanvas[];
  startupCreateCount(): number;
  setCurrentStartupRequest(requestId: number): void;
  runPromise<A, E>(program: Effect.Effect<A, E, TFrontendSimServices>): Promise<A>;
  waitForRecoveryAttempt(attempts: () => number, expected: number): Promise<void>;
  advanceTime(durationMillis: number): Promise<void>;
  dispose(): Promise<void>;
}>;

/**
 * Isolated simulated application graph. Every world input is supplied by the
 * caller or an explicit deterministic seed; no browser ambient is consulted.
 */
export function createFrontendSimRuntime(args: Readonly<{
  browser?: TControlledBrowserSeed;
  storage?: readonly (readonly [string, string])[];
  canvases?: readonly TBackendCanvas[];
}> = {}): TFrontendSimRuntime {
  const browser = new ControlledFrontendBrowser(args.browser);
  const storage = new FrontendMemoryStorage(args.storage);
  const navigation = new RecordedFrontendNavigation();
  const notifications = new RecordedFrontendNotifications();
  const transport = new ScriptedFrontendTransport();
  let canvases = [...(args.canvases ?? [])];
  let currentStartupRequest = 1;
  let startupCreates = 0;
  let disposed = false;

  const dbResources = DbResources.of({
    read: <Path extends TDbResourceRequestPath>(path: Path, input: TPrivateRequestInput<Path>) => Effect.try({
      try: () => transport.request({ path, input } as TFrontendTransportRequest<Path>) as TPrivateRequestOutput<Path>,
      catch: frontendTransportFailure,
    }),
    write: <Path extends TDbResourceRequestPath>(path: Path, input: TPrivateRequestInput<Path>) => Effect.try({
      try: () => transport.request({
        path,
        input,
      } as TFrontendTransportRequest<Path>) as TPrivateRequestOutput<Path>,
      catch: frontendTransportFailure,
    }),
  });
  const chatRecovery = ChatRecoveryBackend.of({
    connectReuse: (scope) => Effect.try({
      try: () => {
        transport.request({
          path: "agent.chat.connect",
          input: {
            canvasId: scope.canvasId,
            widgetId: scope.componentId,
            sessionId: scope.sessionId,
            mode: "reuse",
          },
        });
      },
      catch: frontendTransportFailure,
    }),
    history: (scope) => Effect.try({
      try: () => transport.request({
        path: "agent.chat.history",
        input: { widgetId: scope.componentId, sessionId: scope.sessionId },
      }),
      catch: frontendTransportFailure,
    }),
  });
  const startupCatalog = StartupCanvasCatalog.of({
    list: () => Effect.succeed([...canvases]),
    create: (name) => Effect.sync(() => {
      startupCreates += 1;
      const created: TBackendCanvas = Object.freeze({ id: browser.nextId(), name, revision: 1 });
      canvases = [...canvases, created];
      return created;
    }),
  });
  const startupState = StartupApplicationState.of({
    setCanvases: (next) => Effect.sync(() => {
      canvases = [...next];
    }),
  });
  const startupNavigation = StartupNavigation.of({
    navigate: (path) => Effect.sync(() => navigation.navigate(path)),
  });
  const startupNotifications = StartupNotifications.of({
    showError: (message) => Effect.sync(() => notifications.show({ tone: "error", title: message })),
  });
  const startupFence = StartupFence.of({
    current: (requestId) => Effect.succeed(requestId === currentStartupRequest),
  });

  const runtime = ManagedRuntime.make(Layer.mergeAll(
    transport.layer(),
    Layer.succeed(DbResources, dbResources),
    notifications.layer(),
    Layer.succeed(ChatRecoveryBackend, chatRecovery),
    Layer.succeed(StartupCanvasCatalog, startupCatalog),
    Layer.succeed(StartupApplicationState, startupState),
    Layer.succeed(StartupNavigation, startupNavigation),
    Layer.succeed(StartupNotifications, startupNotifications),
    Layer.succeed(StartupFence, startupFence),
    TestClock.layer({ warningDelay: "1 hour" }),
  ));

  return Object.freeze({
    browser,
    storage,
    navigation,
    notifications,
    transport,
    canvases: () => [...canvases],
    startupCreateCount: () => startupCreates,
    setCurrentStartupRequest(requestId) {
      currentStartupRequest = requestId;
    },
    runPromise: <A, E>(program: Effect.Effect<A, E, TFrontendSimServices>) => disposed
      ? Promise.reject(new Error("Frontend simulation runtime is disposed."))
      : runtime.runPromise(program),
    waitForRecoveryAttempt: (attempts, expected) => disposed
      ? Promise.reject(new Error("Frontend simulation runtime is disposed."))
      : runtime.runPromise(Effect.gen(function*(): Effect.gen.Return<void> {
        for (let attempt = 0; attempt < 1_000; attempt += 1) {
          if (attempts() >= expected) return;
          yield* Effect.yieldNow;
        }
        return yield* Effect.die(new Error(`Expected reconnect recovery attempt ${expected}.`));
      })),
    advanceTime: (durationMillis) => disposed
      ? Promise.reject(new Error("Frontend simulation runtime is disposed."))
      : runtime.runPromise(TestClock.adjust(durationMillis)),
    dispose: () => {
      disposed = true;
      return runtime.dispose();
    },
  });
}

export function asSimFailure(error: unknown): TFrontendTransportFailure {
  return frontendTransportFailure(error);
}
