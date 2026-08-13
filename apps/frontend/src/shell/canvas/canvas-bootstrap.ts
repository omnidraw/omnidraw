import { Effect } from "effect";
import { frontendTransportFailure } from "@/core/app/service.frontend-transport";
import {
  StartupApplicationState,
  StartupCanvasCatalog,
  StartupFence,
  StartupNavigation,
  StartupNotifications,
  txStartupCanvas,
} from "@/core/app/startup-canvas";
import { showErrorToast } from "../framework/components/ui/Toast";
import type { TFrontendRuntime } from "../runtime/frontend-runtime";

export type TCanvasBootstrapHost = Readonly<{
  navigate(path: string): void;
  pathname(): string;
}>;

export type TFrontendCanvasBootstrap = Readonly<{
  run(): Promise<void>;
  dispose(): void;
}>;

/** Per-application startup supervisor with stale-response fencing and deduplication. */
export function createFrontendCanvasBootstrap(
  runtime: TFrontendRuntime,
  host: TCanvasBootstrapHost,
): TFrontendCanvasBootstrap {
  let requestId = 0;
  let disposed = false;
  let pending: Promise<void> | null = null;
  const controller = new AbortController();
  const catalog = StartupCanvasCatalog.of({
    list: () => Effect.tryPromise({
      try: () => runtime.rpc.request("canvas.list", {}, { signal: controller.signal }),
      catch: frontendTransportFailure,
    }),
    create: (name) => Effect.tryPromise({
      try: () => runtime.rpc.request("canvas.create", { name }, {
        signal: controller.signal,
      }),
      catch: frontendTransportFailure,
    }),
  });
  const state = StartupApplicationState.of({
    setCanvases: (canvases) => Effect.sync(() => runtime.store.set("canvases", [...canvases])),
  });
  const navigation = StartupNavigation.of({
    navigate: (path) => Effect.sync(() => host.navigate(path)),
  });
  const notifications = StartupNotifications.of({
    showError: (message) => Effect.sync(() => { showErrorToast(message); }),
  });
  const fence = StartupFence.of({
    current: (candidate) => Effect.sync(() => !disposed && candidate === requestId),
  });

  return Object.freeze({
    run() {
      if (pending !== null) return pending;
      const activeRequest = ++requestId;
      const program = txStartupCanvas({ pathname: host.pathname(), requestId: activeRequest }).pipe(
        Effect.provideService(StartupCanvasCatalog, catalog),
        Effect.provideService(StartupApplicationState, state),
        Effect.provideService(StartupNavigation, navigation),
        Effect.provideService(StartupNotifications, notifications),
        Effect.provideService(StartupFence, fence),
      );
      pending = runtime.runPromise(program).catch(() => undefined).finally(() => {
        pending = null;
      });
      return pending;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      requestId += 1;
      controller.abort("Canvas bootstrap disposed");
    },
  });
}
