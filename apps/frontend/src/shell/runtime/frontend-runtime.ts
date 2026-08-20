import { Effect, Layer, ManagedRuntime, Stream } from "effect";
import {
  FrontendTransport,
  frontendTransportFailure,
  type TFrontendTransportRequest,
  type TFrontendTransportStreamRequest,
  type TFrontendTransportFailure,
} from "@/core/app/service.frontend-transport";
import { createCatalogInvalidation, type TCatalogInvalidationPort } from "../framework/feature/sidebar/ports";
import {
  createWidgetPlacementCoordinator,
  type TWidgetPlacementCoordinator,
} from "../framework/feature/widget-placement/WidgetPlacementCoordinator";
import { createFrontendStore, type TFrontendStore } from "../framework/state/store";
import { createFrontendThemeController, type TFrontendThemeController } from "../browser/theme";
import {
  createFrontendCanvasHostRetirementCoordinator,
  type TFrontendCanvasHostRetirementCoordinator,
} from "../canvas/canvas-host-retirement";
import { createFrontendApi, type TFrontendApi } from "../transport/frontend-api";
import {
  FrontendRpcClient,
  FrontendRpcConnection,
  FrontendRpcConnectionGenerations,
  frontendRpcLayer,
  frontendWebsocketUrl,
} from "../transport/rpc";
import { DbResources } from "@/core/resources/service.db-resources";
import { NotificationSink } from "@/core/notifications/service.notification-sink";
import { ChatRecoveryBackend } from "@/core/chat/fx.recover-chat";
import type {
  TPrivateRequestArguments,
  TPrivateRequestOutput,
  TPrivateRequestPath,
  TPrivateStreamOutput,
  TPrivateStreamPath,
} from "@/core/app/private-operation-contract";
import {
  showErrorToast,
  showSuccessToast,
  showToast,
  showWarningToast,
} from "../framework/components/ui/Toast";

export type TFrontendCoreServices = FrontendTransport | DbResources | NotificationSink | ChatRecoveryBackend;

export type TFrontendRuntime = Readonly<{
  ownerWindow: Window;
  ownerDocument: Document;
  rpc: FrontendRpcConnection;
  api: TFrontendApi;
  store: TFrontendStore;
  theme: TFrontendThemeController;
  catalogInvalidation: TCatalogInvalidationPort;
  widgetPlacement: TWidgetPlacementCoordinator;
  canvasHostRetirement: TFrontendCanvasHostRetirementCoordinator;
  signal: AbortSignal;
  runPromise<A, E>(
    program: Effect.Effect<A, E, TFrontendCoreServices>,
  ): Promise<A>;
  runSafe<A>(
    program: Effect.Effect<A, TFrontendTransportFailure, TFrontendCoreServices>,
  ): Promise<readonly [TFrontendTransportFailure | null, A | undefined]>;
  fork<A, E>(
    program: Effect.Effect<A, E, TFrontendCoreServices>,
    observer?: Readonly<{ onSuccess?(value: A): void; onError?(error: E): void }>,
  ): () => void;
  dispose(): Promise<void>;
}>;

export function createLiveFrontendRuntime(args: Readonly<{
  ownerWindow: Window;
  ownerDocument: Document;
}>): TFrontendRuntime {
  const store = createFrontendStore(args.ownerWindow.localStorage);
  const theme = createFrontendThemeController({ store, document: args.ownerDocument });
  const catalogInvalidation = createCatalogInvalidation();
  const widgetPlacement = createWidgetPlacementCoordinator();
  const lifetime = new AbortController();
  const generations = new FrontendRpcConnectionGenerations();
  let rpc: FrontendRpcConnection;
  const transport = FrontendTransport.of({
    request: <Path extends TPrivateRequestPath>(request: TFrontendTransportRequest<Path>) => Effect.tryPromise({
      try: () => rpc.request(request.path, request.input, {
        ...(request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      }),
      catch: frontendTransportFailure,
    }),
    stream: <Path extends TPrivateStreamPath>(request: TFrontendTransportStreamRequest<Path>) => Stream.unwrap(Effect.tryPromise({
      try: async () => Stream.fromAsyncIterable(await rpc.stream(request.path, request.input, {
        ...(request.afterCursor === undefined ? {} : { afterCursor: request.afterCursor }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      }), frontendTransportFailure),
      catch: frontendTransportFailure,
    })),
  });
  const dbResources = DbResources.of({
    read: <Path extends TPrivateRequestPath>(path: Path, input: Parameters<typeof rpc.request<Path>>[1]) => Effect.tryPromise({
      try: () => rpc.request(path, ...([input, {
        signal: lifetime.signal,
      }] as unknown as TPrivateRequestArguments<Path>)),
      catch: frontendTransportFailure,
    }),
    write: <Path extends TPrivateRequestPath>(path: Path, input: Parameters<typeof rpc.request<Path>>[1]) => Effect.tryPromise({
      try: () => rpc.request(path, ...([input, {
        signal: lifetime.signal,
      }] as unknown as TPrivateRequestArguments<Path>)),
      catch: frontendTransportFailure,
    }),
  });
  const notificationSink = NotificationSink.of({
    show: ({ tone, title, description }) => Effect.sync(() => {
      if (tone === "error") showErrorToast(title, description);
      else if (tone === "success") showSuccessToast(title, description);
      else if (tone === "warning") showWarningToast(title, description);
      else showToast(title, description);
    }),
  });
  const chatRecoveryBackend = ChatRecoveryBackend.of({
    history: (scope) => Effect.tryPromise({
      try: () => rpc.request("agent.chat.history", {
        widgetId: scope.componentId,
        sessionId: scope.sessionId,
      }, { signal: lifetime.signal }),
      catch: frontendTransportFailure,
    }),
  });
  const appRuntime = ManagedRuntime.make(Layer.mergeAll(
    frontendRpcLayer(
      frontendWebsocketUrl(args.ownerWindow.location.origin),
      generations,
      (url, protocols) => new (args.ownerWindow as Window & typeof globalThis).WebSocket(url, protocols),
    ),
    Layer.succeed(FrontendTransport, transport),
    Layer.succeed(DbResources, dbResources),
    Layer.succeed(NotificationSink, notificationSink),
    Layer.succeed(ChatRecoveryBackend, chatRecoveryBackend),
  ));
  const canvasHostRetirement = createFrontendCanvasHostRetirementCoordinator(
    (program) => appRuntime.runPromise(program),
  );
  rpc = new FrontendRpcConnection({
    generations,
    runPromise: <A, E>(
      program: Effect.Effect<A, E, FrontendRpcClient>,
      options?: Readonly<{ signal?: AbortSignal }>,
    ) => appRuntime.runPromise(program, options),
  });
  const api = createFrontendApi({
    rpc,
  });
  const runPromise = <A, E>(program: Effect.Effect<A, E, TFrontendCoreServices>): Promise<A> =>
    appRuntime.runPromise(program);
  const runSafe = async <A>(
    program: Effect.Effect<A, TFrontendTransportFailure, TFrontendCoreServices>,
  ): Promise<readonly [TFrontendTransportFailure | null, A | undefined]> => {
    try {
      return [null, await runPromise(program)];
    } catch (error) {
      return [frontendTransportFailure(error), undefined];
    }
  };
  const fork = <A, E>(
    program: Effect.Effect<A, E, TFrontendCoreServices>,
    observer: Readonly<{ onSuccess?(value: A): void; onError?(error: E): void }> = {},
  ): (() => void) => appRuntime.runCallback(program.pipe(
    Effect.tap((value) => Effect.sync(() => observer.onSuccess?.(value))),
    Effect.catch((error) => Effect.sync(() => observer.onError?.(error))),
  ));
  let disposal: Promise<void> | null = null;

  return Object.freeze({
    ownerWindow: args.ownerWindow,
    ownerDocument: args.ownerDocument,
    rpc,
    api,
    store,
    theme,
    catalogInvalidation,
    widgetPlacement,
    canvasHostRetirement,
    signal: lifetime.signal,
    runPromise,
    runSafe,
    fork,
    dispose() {
      if (disposal !== null) return disposal;
      lifetime.abort("Frontend runtime disposed");
      disposal = (async () => {
        try {
          await canvasHostRetirement.retireAll();
        } finally {
          theme.dispose();
          store.dispose();
          await appRuntime.dispose();
        }
      })();
      return disposal;
    },
  });
}
