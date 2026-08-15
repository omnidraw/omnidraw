import type { ICanvasExtension, TCanvasExternalWidgetPreview } from "@omnidraw/canvas";
import { Predicate } from "effect";
import {
  CANVAS_WIDGET_EXTENSION_KEY,
  fnReadCanvasWidgetExtension,
  type TWidgetFrameNode,
} from "@omnidraw/canvas-contract";
import type {
  IWidgetBrowserMount,
  TWidgetNotificationOutput,
  TWidgetHostSubject,
} from "@omnidraw/sdk";
import { showErrorToast, showSuccessToast, showToast } from "../../components/ui/Toast";
import { fnWidgetHostTheme, fnWidgetPreviewTitleBarColor } from "@/core/widgets/fn.widget-host-theme";
import { txRouteWidgetOutput } from "@/core/widgets/tx.route-widget-output";
import { createWidgetCollaborativeStatePort } from "@/shell/widgets/widget-collaborative-state";
import type { TFrontendRuntime } from "@/shell/runtime/frontend-runtime";
import type { TWidgetPlacementCoordinator } from "../widget-placement/WidgetPlacementCoordinator";
import { FrontendWidgetRuntime } from "../widget-runtime";
import type { TWidgetPublicCatalog } from "../sidebar/ports";
import {
  fnClampWidgetPlacementPosition,
  fnHasWidgetPlacementDragThreshold,
  type TWidgetPlacementPoint,
} from "@/core/widgets/fn.pointer-placement";
import {
  fnPlacedWidgetNode,
  fnWidgetPreviewActionId,
} from "@/core/widgets/fn.placed-widget-node";
import { fnWidgetHostDiagnosticDescription } from "@/core/widgets/fn.widget-host-diagnostic";
import { createWidgetViewportSync } from "./widget-viewport-sync";
import { retireFatalWidgetMount } from "./widget-fatal-lifecycle";
import { isPrivateRpcError } from "@/core/app/private-rpc-error";

type TCreateFrontendWidgetExtensionArgs = Readonly<{
  runtime: TFrontendRuntime;
  placement: TWidgetPlacementCoordinator;
  invalidateWidgets(): void;
}>;

type TPreviewFailurePresentation = Readonly<{
  title: "Build required" | "Building" | "Build failed" | "Preview failed";
  message: string;
  rebuildDisabled: boolean;
}>;

function previewFailurePresentation(error: unknown): TPreviewFailurePresentation {
  if (isPrivateRpcError(error) && Predicate.isObject(error.details)) {
    const details = error.details;
    if (details.kind === "widget-preview-build-state") {
      const phase = details.phase;
      const diagnostics = Array.isArray(details.diagnostics) ? details.diagnostics : [];
      const diagnostic = diagnostics.find((candidate) => Predicate.isObject(candidate)
        && typeof candidate.message === "string");
      if (phase === "building" || phase === "validating") {
        return Object.freeze({
          title: "Building",
          message: phase === "validating"
            ? "The exact widget build is being validated. Select Rebuild to join it and open Preview when it is ready."
            : "The exact widget dependencies and source are being built. Select Rebuild to join it and open Preview when it is ready.",
          rebuildDisabled: false,
        });
      }
      if (phase === "rejected") {
        return Object.freeze({
          title: "Build failed",
          message: typeof diagnostic?.message === "string"
            ? diagnostic.message.slice(0, 600)
            : "The host rejected the current widget build. Repair the draft, then rebuild it.",
          rebuildDisabled: false,
        });
      }
      return Object.freeze({
        title: "Build required",
        message: "This draft has no accepted build for its current files. Rebuild it to open Preview.",
        rebuildDisabled: false,
      });
    }
  }
  const code = Predicate.isObject(error) && typeof error.code === "string"
    && /^[A-Z][A-Z0-9_]{0,127}$/.test(error.code)
      ? error.code
      : undefined;
  return Object.freeze({
    title: "Preview failed",
    message: code === undefined
      ? "The accepted Preview could not start. Repair and rebuild the widget, or remove this frame."
      : `The accepted Preview could not start (${code}). Repair and rebuild the widget, or remove this frame.`,
    rebuildDisabled: false,
  });
}

function subject(
  canvasId: string,
  node: Readonly<TWidgetFrameNode>,
): TWidgetHostSubject | null {
  const extension = fnReadCanvasWidgetExtension(node);
  if (extension?.type !== "widget-instance" && extension?.type !== "widget-preview") return null;
  return {
    canvasId,
    elementId: node.id,
    widgetInstanceId: extension.instanceId,
    widgetKey: extension.widgetKey,
  };
}

async function buildAndPublishPreview(runtime: TFrontendRuntime, widgetKey: string, signal: AbortSignal): Promise<void> {
  const catalog = await runtime.rpc.request("widget.catalog.get", {}, { signal });
  const entry = catalog.entries.find((candidate) => candidate.widgetKey === widgetKey);
  const manifestDigest = entry?.draft?.manifestDigestSha256;
  if (manifestDigest === null || manifestDigest === undefined) {
    throw new Error("The widget draft manifest is unavailable.");
  }
  await runtime.rpc.request("widget.publication.buildAndPublish", {
    widgetKey,
    expectedManifestDigestSha256: manifestDigest,
    expectedCatalogDigestSha256: catalog.catalogDigestSha256,
  }, { signal });
}

export function createFrontendWidgetExtension(
  options: TCreateFrontendWidgetExtensionArgs,
): ICanvasExtension {
  const { runtime: application } = options;
  return {
    name: "omnidraw.frontend-widgets",
    install(context) {
      const runtime = new FrontendWidgetRuntime({
        document: context.config.container.ownerDocument,
        rpc: application.rpc,
        createId: () => application.ownerWindow.crypto.randomUUID(),
        decodeBase64: (value) => application.ownerWindow.atob(value),
        digestSha256: async (bytes) => {
          const digest = await application.ownerWindow.crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
          return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
        },
        state: createWidgetCollaborativeStatePort(application.rpc),
        output: {
          notification(output: TWidgetNotificationOutput) {
            void application.runPromise(txRouteWidgetOutput({ output }));
          },
        },
      });
      const mounts = new Map<string, IWidgetBrowserMount>();
      const reloadByNode = new Map<string, () => Promise<boolean>>();
      const unregisterWidgetHost = context.widgets.register({
        id: "omnidraw.frontend-widgets",
        match: (node) => subject(context.config.canvasId, node) !== null,
        async mount(args) {
          const exactSubject = subject(context.config.canvasId, args.node);
          const extension = fnReadCanvasWidgetExtension(args.node);
          if (exactSubject === null || (extension?.type !== "widget-instance" && extension?.type !== "widget-preview")) return;
          // Preview title and actions are authored once on the widget frame.
          // Cangine then owns their responsive title lane and compact overflow
          // menu; an extension titlebar here would overlay that same chrome.
          let mount: IWidgetBrowserMount | undefined;
          let failureSurface: HTMLElement | null = null;
          let opening: Promise<boolean> | null = null;
          const ownerWindow = application.ownerWindow as Window & typeof globalThis;
          const viewportSync = createWidgetViewportSync({
            container: args.container,
            createResizeObserver: (callback) => new ownerWindow.ResizeObserver(callback),
            devicePixelRatio: () => ownerWindow.devicePixelRatio,
            node: args.node,
          });
          const removePreview = (): void => {
            context.document.commit({
              source: "omnidraw.widget-preview.remove",
              commands: [{ type: "remove", nodeId: args.node.id, descendants: "remove" }],
            });
          };
          const renderFailure = (error: unknown): void => {
            if (extension.type !== "widget-preview" || mount !== undefined) return;
            failureSurface?.remove();
            const presentation = previewFailurePresentation(error);
            const surface = args.container.ownerDocument.createElement("section");
            surface.dataset.omnidrawWidgetPreviewFailure = presentation.title;
            surface.setAttribute("aria-live", "polite");
            surface.setAttribute("aria-label", `Preview ${presentation.title}`);
            Object.assign(surface.style, {
              alignItems: "center",
              background: "var(--omnidraw-color-surface, #fff)",
              boxSizing: "border-box",
              color: "var(--omnidraw-color-text, #171717)",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              gridArea: "1 / 1",
              height: "100%",
              justifyContent: "center",
              minHeight: "0",
              padding: "24px",
              textAlign: "center",
              width: "100%",
              zIndex: "2",
            });
            const title = surface.ownerDocument.createElement("h3");
            title.textContent = presentation.title;
            title.style.cssText = "font:600 16px/22px system-ui,sans-serif;margin:0";
            const message = surface.ownerDocument.createElement("p");
            message.textContent = presentation.message;
            message.style.cssText = "font:400 13px/19px system-ui,sans-serif;margin:0;max-width:32rem;overflow-wrap:anywhere";
            const controls = surface.ownerDocument.createElement("div");
            controls.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;justify-content:center";
            const rebuild = surface.ownerDocument.createElement("button");
            rebuild.type = "button";
            rebuild.textContent = presentation.rebuildDisabled ? "Building…" : "Rebuild";
            rebuild.disabled = presentation.rebuildDisabled;
            rebuild.style.cssText = "appearance:none;border:1px solid currentColor;border-radius:7px;background:transparent;color:inherit;cursor:pointer;font:600 13px/18px system-ui,sans-serif;padding:6px 11px";
            rebuild.addEventListener("click", () => {
              void (async () => {
                rebuild.disabled = true;
                rebuild.textContent = "Building…";
                try {
                  await application.rpc.request("widget.preview.rebuildDraft", {
                    widgetKey: extension.widgetKey,
                  }, { signal: args.signal });
                  options.invalidateWidgets();
                  if (await open()) showSuccessToast("Widget draft rebuilt");
                } catch (rebuildError) {
                  renderFailure(rebuildError);
                  const failed = previewFailurePresentation(rebuildError);
                  showErrorToast(failed.title, failed.message);
                }
              })();
            });
            const remove = surface.ownerDocument.createElement("button");
            remove.type = "button";
            remove.textContent = "Remove";
            remove.style.cssText = rebuild.style.cssText;
            remove.addEventListener("click", removePreview);
            controls.append(rebuild, remove);
            surface.append(title, message, controls);
            args.container.append(surface);
            failureSurface = surface;
          };
          const open = async (): Promise<boolean> => {
            if (opening !== null) return opening;
            opening = (async () => {
              const previous = mount;
              let next: IWidgetBrowserMount | undefined;
              let fatalError: unknown;
              let committed = false;
              const initialViewport = viewportSync.current();
              const retireFatalMount = async (failedMount: IWidgetBrowserMount, error: unknown): Promise<void> => {
                await retireFatalWidgetMount({
                  canRenderFailure: () => mount === undefined
                    && !args.signal.aborted,
                  detach: (failed) => viewportSync.detach(failed),
                  error,
                  failedMount,
                  isCurrent: () => mount === failedMount,
                  renderFailure,
                  retire: () => {
                    mount = undefined;
                    mounts.delete(args.node.id);
                  },
                });
              };
              try {
                next = await runtime.mount({
                  mode: extension.type === "widget-preview" ? "preview" : "published",
                  container: args.container,
                  subject: exactSubject,
                  viewport: initialViewport,
                  theme: fnWidgetHostTheme(application.theme.service.getTheme()),
                  props: extension.uiProps,
                  signal: args.signal,
                  onDiagnostic: (diagnostic) => {
                    if (diagnostic.fatal) showErrorToast(
                      diagnostic.message,
                      fnWidgetHostDiagnosticDescription(diagnostic),
                    );
                  },
                  onFatal: (error) => {
                    fatalError ??= error;
                    if (committed && next !== undefined) {
                      void retireFatalMount(next, error).catch(() => undefined);
                    }
                  },
                });
                await next.ready();
                if (fatalError !== undefined) throw fatalError;
              } catch (error) {
                await next?.dispose("replacement-failed").catch(() => undefined);
                if (previous === undefined) renderFailure(error);
                const failed = previewFailurePresentation(error);
                showErrorToast(failed.title, failed.message);
                return false;
              }
              failureSurface?.remove();
              failureSurface = null;
              mount = next;
              viewportSync.attach(next, initialViewport);
              mounts.set(args.node.id, next);
              committed = true;
              if (fatalError !== undefined) {
                await retireFatalMount(next, fatalError);
                return false;
              }
              await previous?.dispose("replaced");
              if (fatalError !== undefined) {
                await retireFatalMount(next, fatalError);
                return false;
              }
              return true;
            })().finally(() => {
              opening = null;
            });
            return opening;
          };
          reloadByNode.set(args.node.id, open);
          await open();
          const unsubscribeNode = args.onNodeChange?.((node) => {
            viewportSync.updateNode(node);
            const next = fnReadCanvasWidgetExtension(node);
            if (next?.uiProps !== undefined && typeof next.uiProps === "object" && next.uiProps !== null && !Array.isArray(next.uiProps)) {
              mount?.setProps(next.uiProps);
            }
          });
          const unsubscribeTheme = application.theme.service.subscribeThemeChange((theme) => {
            mount?.setTheme(fnWidgetHostTheme(theme));
          });
          return async () => {
            viewportSync.disconnect();
            unsubscribeNode?.();
            unsubscribeTheme();
            reloadByNode.delete(args.node.id);
            mounts.delete(args.node.id);
            failureSurface?.remove();
            await mount?.dispose("canvas-unmount");
          };
        },
        async onAction({ node, actionId, signal }) {
          const extension = fnReadCanvasWidgetExtension(node);
          if (extension?.type !== "widget-preview") return;
          const previewActionId = fnWidgetPreviewActionId(actionId);
          if (previewActionId === "remove") {
            context.document.commit({ source: "omnidraw.widget-preview.remove", commands: [{ type: "remove", nodeId: node.id, descendants: "remove" }] });
            return;
          }
          if (previewActionId === "reload") {
            await reloadByNode.get(node.id)?.();
            return;
          }
          if (previewActionId === "rebuild") {
            await application.rpc.request("widget.preview.rebuildDraft", { widgetKey: extension.widgetKey }, { signal });
            options.invalidateWidgets();
            if (await reloadByNode.get(node.id)?.()) showSuccessToast("Widget draft rebuilt");
            return;
          }
          if (previewActionId === "publish") {
            await buildAndPublishPreview(application, extension.widgetKey, signal);
            options.invalidateWidgets();
            showSuccessToast("Widget built and published");
          }
        },
      });
      type TPlacementRequest = Parameters<TWidgetPlacementCoordinator["beginPointerSession"]>[0];
      type TPointerSession = {
        request: TPlacementRequest;
        pointerId: number;
        origin: TWidgetPlacementPoint;
        nodeId: ReturnType<Crypto["randomUUID"]>;
        dragging: boolean;
        previousUserSelect: string;
        captureTarget: Element | null;
      };
      const ownerDocument = context.config.container.ownerDocument;
      let disposed = false;
      let pointerSession: TPointerSession | null = null;
      let placementPreview: TCanvasExternalWidgetPreview | null = null;

      const resolvePosition = (
        point: TWidgetPlacementPoint,
        bounds: Readonly<{ width: number; height: number }>,
      ): TWidgetPlacementPoint => fnClampWidgetPlacementPosition({
        point: context.placement.clientToWorld(point),
        bounds,
        viewport: context.placement.visibleWorldBounds(),
      });
      const commitPlacement = (
        request: Pick<TPlacementRequest, "reference" | "bounds" | "label">,
        position: TWidgetPlacementPoint,
        nodeId: ReturnType<Crypto["randomUUID"]> = application.ownerWindow.crypto.randomUUID(),
      ): void => {
        const preview = request.reference.source === "draft";
        const node = fnPlacedWidgetNode({
          id: nodeId,
          reference: request.reference,
          bounds: request.bounds,
          label: request.label,
          position,
          instanceId: application.ownerWindow.crypto.randomUUID(),
          ...(preview ? {
            titleBarColor: fnWidgetPreviewTitleBarColor(application.theme.service.getTheme()),
          } : {}),
        });
        context.document.commit({ source: "omnidraw.widget-place", commands: [{ type: "upsert", node }] });
        context.document.setSelection([node.id], { focusedNodeId: node.id });
      };
      const removePointerListeners = (): void => {
        ownerDocument.removeEventListener("pointermove", onPointerMove);
        ownerDocument.removeEventListener("pointerup", onPointerUp);
        ownerDocument.removeEventListener("pointercancel", onPointerCancel);
        ownerDocument.removeEventListener("keydown", onKeyDown);
      };
      const clearPlacementPreview = (): void => {
        placementPreview?.clear();
      };
      const finishPointerSession = (): TPointerSession | null => {
        const current = pointerSession;
        if (current === null) return null;
        removePointerListeners();
        ownerDocument.body.style.userSelect = current.previousUserSelect;
        if (current.captureTarget?.hasPointerCapture?.(current.pointerId)) {
          current.captureTarget.releasePointerCapture(current.pointerId);
        }
        pointerSession = null;
        placementPreview?.dispose();
        placementPreview = null;
        return current;
      };
      const cancelPointerSession = (): void => {
        const current = finishPointerSession();
        if (current?.dragging) current.request.onDragEnd?.();
      };
      const syncPlacementPreview = (current: TPointerSession, point: TWidgetPlacementPoint): void => {
        const position = resolvePosition(point, current.request.bounds);
        placementPreview ??= context.placement.createWidgetPreview({
          nodeId: current.nodeId,
          title: current.request.label,
        });
        placementPreview.update({
          x: position.x,
          y: position.y,
          width: current.request.bounds.width,
          height: current.request.bounds.height,
        });
      };
      function onPointerMove(event: PointerEvent): void {
        const current = pointerSession;
        if (current === null || event.pointerId !== current.pointerId) return;
        const point = { x: event.clientX, y: event.clientY };
        if (!current.dragging && fnHasWidgetPlacementDragThreshold({
          origin: current.origin,
          point,
          threshold: 6,
        })) {
          current.dragging = true;
          ownerDocument.body.style.userSelect = "none";
          current.request.onDragStart?.();
        }
        if (!current.dragging) return;
        event.preventDefault();
        if (!context.placement.containsClientPoint(point)) {
          clearPlacementPreview();
          return;
        }
        syncPlacementPreview(current, point);
      }
      function onPointerUp(event: PointerEvent): void {
        const current = pointerSession;
        if (current === null || event.pointerId !== current.pointerId) return;
        const point = { x: event.clientX, y: event.clientY };
        const shouldCommit = current.dragging && context.placement.containsClientPoint(point);
        const position = shouldCommit ? resolvePosition(point, current.request.bounds) : null;
        if (current.dragging) event.preventDefault();
        finishPointerSession();
        if (current.dragging) current.request.onDragEnd?.();
        if (position !== null) {
          try {
            commitPlacement(current.request, position, current.nodeId);
          } catch (error) {
            showErrorToast("Widget placement failed", error instanceof Error ? error.message : String(error));
          }
        }
      }
      function onPointerCancel(event: PointerEvent): void {
        if (event.pointerId === pointerSession?.pointerId) cancelPointerSession();
      }
      function onKeyDown(event: KeyboardEvent): void {
        if (event.key !== "Escape" || pointerSession === null) return;
        event.preventDefault();
        cancelPointerSession();
      }
      const placementPort = {
        isAvailable: () => !disposed
          && !application.signal.aborted
          && context.config.container.isConnected,
        beginPointerSession(args: Parameters<TWidgetPlacementCoordinator["beginPointerSession"]>[0]) {
          if (args.event.button !== 0 || args.event.isPrimary === false) return false;
          cancelPointerSession();
          const captureTarget = args.event.currentTarget instanceof Element
            ? args.event.currentTarget
            : null;
          captureTarget?.setPointerCapture?.(args.event.pointerId);
          pointerSession = {
            request: args,
            pointerId: args.event.pointerId,
            origin: { x: args.event.clientX, y: args.event.clientY },
            nodeId: application.ownerWindow.crypto.randomUUID(),
            dragging: false,
            previousUserSelect: ownerDocument.body.style.userSelect,
            captureTarget,
          };
          ownerDocument.addEventListener("pointermove", onPointerMove, { passive: false });
          ownerDocument.addEventListener("pointerup", onPointerUp, { passive: false });
          ownerDocument.addEventListener("pointercancel", onPointerCancel, { passive: false });
          ownerDocument.addEventListener("keydown", onKeyDown);
          return true;
        },
        async addToCanvas(args: Parameters<TWidgetPlacementCoordinator["addToCanvas"]>[0]) {
          cancelPointerSession();
          const viewport = context.placement.visibleWorldBounds();
          const center = context.placement.viewportCenter();
          const position = fnClampWidgetPlacementPosition({
            point: args.position ?? {
              x: center.x - args.bounds.width / 2,
              y: center.y - args.bounds.height / 2,
            },
            bounds: args.bounds,
            viewport,
          });
          commitPlacement(args, position);
        },
      };
      const unregisterPlacement = options.placement.register(placementPort);
      return {
        async dispose() {
          disposed = true;
          cancelPointerSession();
          placementPreview?.dispose();
          placementPreview = null;
          unregisterPlacement();
          unregisterWidgetHost();
          reloadByNode.clear();
          mounts.clear();
          await runtime.dispose();
        },
      };
    },
  };
}
