import { Context, Effect } from "effect";
import type { TFrontendTransportFailure } from "./service.frontend-transport";
import type { TBackendCanvas } from "./backend.types";
import { fnGetStartupCanvasNavigation } from "./fn.startup-canvas-navigation";

export class StartupCanvasCatalog extends Context.Service<StartupCanvasCatalog, {
  list(): Effect.Effect<readonly TBackendCanvas[], TFrontendTransportFailure>;
  create(name: string): Effect.Effect<TBackendCanvas, TFrontendTransportFailure>;
}>()("omnidraw/frontend/core/app/StartupCanvasCatalog") {}

export class StartupApplicationState extends Context.Service<StartupApplicationState, {
  setCanvases(canvases: readonly TBackendCanvas[]): Effect.Effect<void>;
}>()("omnidraw/frontend/core/app/StartupApplicationState") {}

export class StartupNavigation extends Context.Service<StartupNavigation, {
  navigate(path: string): Effect.Effect<void>;
}>()("omnidraw/frontend/core/app/StartupNavigation") {}

export class StartupNotifications extends Context.Service<StartupNotifications, {
  showError(message: string): Effect.Effect<void>;
}>()("omnidraw/frontend/core/app/StartupNotifications") {}

export class StartupFence extends Context.Service<StartupFence, {
  current(requestId: number): Effect.Effect<boolean>;
}>()("omnidraw/frontend/core/app/StartupFence") {}

export type TStartupCanvasServices =
  | StartupCanvasCatalog
  | StartupApplicationState
  | StartupNavigation
  | StartupNotifications
  | StartupFence;

export type TStartupCanvasArgs = Readonly<{
  pathname: string;
  requestId: number;
}>;

const DEFAULT_CANVAS_NAME = "Untitled Canvas";

function errorMessage(error: TFrontendTransportFailure, fallback: string): string {
  return error.message || fallback;
}

/** Lazy startup transaction; shell and simulation provide the same services. */
export const txStartupCanvas = (
  args: TStartupCanvasArgs,
): Effect.Effect<void, TFrontendTransportFailure, TStartupCanvasServices> =>
  Effect.gen(function*() {
    const catalog = yield* StartupCanvasCatalog;
    const state = yield* StartupApplicationState;
    const navigation = yield* StartupNavigation;
    const notifications = yield* StartupNotifications;
    const fence = yield* StartupFence;
    if (!(yield* fence.current(args.requestId))) return;

    const listed = yield* catalog.list().pipe(
      Effect.tapError((error) => notifications.showError(errorMessage(error, "Failed to list canvases"))),
    );
    if (!(yield* fence.current(args.requestId))) return;
    if (listed.length > 0) {
      yield* state.setCanvases(listed);
      return;
    }
    // A direct route already carries the Canvas identity. An empty catalog is
    // metadata evidence only; the authoritative snapshot decides whether the
    // target exists, and startup must not create or redirect in the meantime.
    if (/^\/c\/[^/]+\/?$/u.test(args.pathname)) {
      yield* state.setCanvases(listed);
      return;
    }

    const created = yield* catalog.create(DEFAULT_CANVAS_NAME).pipe(
      Effect.tapError((error) => notifications.showError(errorMessage(error, "Failed to create canvas"))),
    );
    if (!(yield* fence.current(args.requestId))) return;
    const canvases = [created];
    yield* state.setCanvases(canvases);
    const path = fnGetStartupCanvasNavigation({ canvases, createdCanvas: created, pathname: args.pathname });
    if (path !== null) yield* navigation.navigate(path);
  });
