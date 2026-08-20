import type {
  ICanvasExtension,
  TCanvasExtensionDocumentPort,
  TCanvasExternalWidgetPreview,
} from "@omnidraw/canvas";
import { Predicate } from "effect";
import {
  CANVAS_WIDGET_EXTENSION_KEY,
  fnReadCanvasWidgetExtension,
  fnStringifyCanonicalCanvasJson,
  type TWidgetFrameNode,
} from "@omnidraw/canvas-contract";
import type {
  IWidgetBrowserMount,
  TWidgetHostDiagnostic,
  TWidgetNotificationOutput,
  TWidgetHostSubject,
} from "@omnidraw/sdk";
import { showErrorToast, showSuccessToast, showToast } from "../../components/ui/Toast";
import { fnWidgetHostTheme, fnWidgetPreviewTitleBarColor } from "@/core/widgets/fn.widget-host-theme";
import { txRouteWidgetOutput } from "@/core/widgets/tx.route-widget-output";
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
  fnReplacePreviewWithPublishedWidget,
  fnWidgetPreviewActionId,
  fnWidgetPreviewWithPublishedActionAvailability,
} from "@/core/widgets/fn.placed-widget-node";
import { fnWidgetHostDiagnosticDescription } from "@/core/widgets/fn.widget-host-diagnostic";
import { createWidgetViewportSync } from "./widget-viewport-sync";
import { retireFatalWidgetMount } from "./widget-fatal-lifecycle";
import {
  createWidgetGuestReportedErrorSurface,
  fnIsWidgetGuestReportedError,
} from "./widget-runtime-diagnostic";
import { isPrivateRpcError } from "@/core/app/private-rpc-error";
import {
  fnCreateWidgetPreviewState,
  fnShouldRebuildWidgetPreview,
  fnTransitionWidgetPreviewState,
  fnWidgetPreviewPresentation,
} from "@/core/widgets/fn.widget-preview-state";
import type { TWidgetPreviewAutomation } from "./preview-automation";
import { createWidgetFrameStatusSurface } from "./widget-frame-status-surface";

type TCreateFrontendWidgetExtensionArgs = Readonly<{
  runtime: TFrontendRuntime;
  placement: TWidgetPlacementCoordinator;
  invalidateWidgets(): void;
  previewAutomation?: TWidgetPreviewAutomation;
}>;

type TPreviewOpenOptions = Readonly<{
  forceBuild?: boolean;
  manual?: boolean;
  allowBuildFallback?: boolean;
}>;
type TPreviewReload = (options?: TPreviewOpenOptions) => Promise<boolean>;

type TPreviewBuildState = Readonly<{
  phase: "unbuilt" | "build_required" | "restoring" | "building" | "validating" | "ready" | "rejected";
  message: string;
}>;

function previewBuildState(error: unknown): TPreviewBuildState | null {
  if (isPrivateRpcError(error) && Predicate.isObject(error.details)) {
    const details = error.details;
    if (details.kind === "widget-preview-build-state") {
      const phase = details.phase;
      const diagnostics = Array.isArray(details.diagnostics) ? details.diagnostics : [];
      const diagnostic = diagnostics.find((candidate) => Predicate.isObject(candidate)
        && typeof candidate.message === "string");
      if (
        phase === "unbuilt"
        || phase === "build_required"
        || phase === "restoring"
        || phase === "building"
        || phase === "validating"
        || phase === "ready"
        || phase === "rejected"
      ) {
        return Object.freeze({
          phase,
          message: typeof diagnostic?.message === "string"
            ? diagnostic.message.slice(0, 600)
            : phase === "rejected"
              ? "The host rejected the current widget build. Repair the draft, then rebuild it."
              : "The widget build is not ready.",
        });
      }
    }
  }
  if (Predicate.isObject(error) && (error.code === "BUILD_REQUIRED" || error.code === "BUILD_PENDING")) {
    return Object.freeze({
      phase: error.code === "BUILD_PENDING" ? "validating" : "build_required",
      message: "The widget build is not ready.",
    });
  }
  return null;
}

function widgetLoadFailureMessage(error: unknown, preview: boolean): string {
  const code = Predicate.isObject(error) && typeof error.code === "string"
    && /^[A-Z][A-Z0-9_]{0,127}$/.test(error.code)
      ? error.code
      : undefined;
  const subject = preview ? "accepted Preview" : "published widget";
  return code === undefined
    ? `The ${subject} could not start.`
    : `The ${subject} could not start (${code}).`;
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

function publishedCatalogEntry(catalog: TWidgetPublicCatalog, widgetKey: string) {
  const entry = catalog.entries.find((candidate) => candidate.widgetKey === widgetKey);
  return entry?.placeable === true
    && entry.published?.health === "healthy"
    && entry.published.config !== null
    && entry.placement !== null
      ? entry
      : null;
}

function sameNodeImage(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  type TCanonicalInput = Parameters<typeof fnStringifyCanonicalCanvasJson>[0];
  return fnStringifyCanonicalCanvasJson(left as TCanonicalInput)
    === fnStringifyCanonicalCanvasJson(right as TCanonicalInput);
}

async function commitAndWaitForAcceptedNode(args: Readonly<{
  document: TCanvasExtensionDocumentPort;
  node: Readonly<TWidgetFrameNode>;
  signal: AbortSignal;
}>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let projected = false;
    let unsubscribe: () => void = () => undefined;
    const onAbort = () => settle(() => reject(
      args.signal.reason ?? new DOMException("Aborted", "AbortError"),
    ));
    const settle = (complete: () => void) => {
      unsubscribe();
      args.signal.removeEventListener("abort", onAbort);
      complete();
    };
    unsubscribe = args.document.subscribe(() => {
      const authored = args.document.node(args.node.id);
      const accepted = args.document.item(args.node.id)?.item;
      if (sameNodeImage(authored, args.node)) projected = true;
      if (sameNodeImage(accepted, args.node)) {
        settle(resolve);
      } else if (projected && !sameNodeImage(authored, args.node)) {
        settle(() => reject(new Error("Canvas authority rejected the Preview replacement.")));
      }
    });
    args.signal.addEventListener("abort", onAbort, { once: true });
    if (args.signal.aborted) {
      onAbort();
      return;
    }
    try {
      args.document.commit({
        source: "omnidraw.widget-preview.replace-with-published",
        commands: [{ type: "upsert", node: args.node }],
      });
    } catch (error) {
      settle(() => reject(error));
    }
  });
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
        output: {
          notification(output: TWidgetNotificationOutput) {
            void application.runPromise(txRouteWidgetOutput({ output }));
          },
        },
      });
      const unbindPreviewAutomation = options.previewAutomation?.bind(context.document);
      const mounts = new Map<string, IWidgetBrowserMount>();
      const reloadByNode = new Map<string, TPreviewReload>();
      const previewWidgetKeyByNode = new Map<string, string>();
      const syncPreviewActionsByNode = new Map<string, () => Promise<void>>();
      const previewClosureByNode = new Map<string, Promise<void>>();
      const closePreviewSession = (nodeId: string): Promise<void> => {
        const existing = previewClosureByNode.get(nodeId);
        if (existing !== undefined) return existing;
        const closing = (async () => {
          let failure: unknown;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
              await application.rpc.request("widget.preview.close", {
                canvasId: context.config.canvasId,
                elementId: nodeId,
              });
              return;
            } catch (error) {
              failure = error;
            }
          }
          throw failure;
        })();
        previewClosureByNode.set(nodeId, closing);
        return closing;
      };
      const catalogEventController = new AbortController();
      let catalogRefreshTimer: number | undefined;
      const pendingPreviewRefreshes = new Set<string>();
      const pendingPreviewActionSyncs = new Set<string>();
      const scheduleCatalogRefresh = (
        previewWidgetKeys: readonly string[],
        changedWidgetKeys: readonly string[],
        fullResync: boolean,
      ): void => {
        if (fullResync) {
          for (const widgetKey of previewWidgetKeyByNode.values()) {
            pendingPreviewRefreshes.add(widgetKey);
            pendingPreviewActionSyncs.add(widgetKey);
          }
        } else {
          for (const widgetKey of previewWidgetKeys) pendingPreviewRefreshes.add(widgetKey);
          for (const widgetKey of [...previewWidgetKeys, ...changedWidgetKeys]) {
            pendingPreviewActionSyncs.add(widgetKey);
          }
        }
        if (catalogRefreshTimer !== undefined) return;
        catalogRefreshTimer = application.ownerWindow.setTimeout(() => {
          catalogRefreshTimer = undefined;
          const refreshKeys = new Set(pendingPreviewRefreshes);
          const syncKeys = new Set(pendingPreviewActionSyncs);
          pendingPreviewRefreshes.clear();
          pendingPreviewActionSyncs.clear();
          for (const [nodeId, widgetKey] of previewWidgetKeyByNode) {
            if (syncKeys.has(widgetKey)) void syncPreviewActionsByNode.get(nodeId)?.();
            if (refreshKeys.has(widgetKey)) void reloadByNode.get(nodeId)?.();
          }
        }, 80);
      };
      const watchCatalogEvents = async (): Promise<void> => {
        while (!catalogEventController.signal.aborted) {
          try {
            for await (const event of application.api.widgetCatalogEvents({}, {
              signal: catalogEventController.signal,
            })) {
              if (catalogEventController.signal.aborted) return;
              scheduleCatalogRefresh(
                event.previewWidgetKeys,
                event.changedWidgetKeys,
                event.fullResync,
              );
            }
          } catch {
            if (catalogEventController.signal.aborted) return;
          }
          if (catalogEventController.signal.aborted) return;
          await new Promise<void>((resolve) => {
            const timer = application.ownerWindow.setTimeout(resolve, 250);
            catalogEventController.signal.addEventListener("abort", () => {
              application.ownerWindow.clearTimeout(timer);
              resolve();
            }, { once: true });
          });
        }
      };
      void watchCatalogEvents();
      const unregisterWidgetHost = context.widgets.register({
        id: "omnidraw.frontend-widgets",
        match: (node) => subject(context.config.canvasId, node) !== null,
        async mount(args) {
          const exactSubject = subject(context.config.canvasId, args.node);
          const extension = fnReadCanvasWidgetExtension(args.node);
          if (exactSubject === null || (extension?.type !== "widget-instance" && extension?.type !== "widget-preview")) return;
          if (extension.type === "widget-preview") {
            previewClosureByNode.delete(args.node.id);
          } else {
            await previewClosureByNode.get(args.node.id)?.catch(() => undefined);
          }
          // Preview title and actions are authored once on the widget frame.
          // Cangine then owns their responsive title lane and compact overflow
          // menu; an extension titlebar here would overlay that same chrome.
          let mount: IWidgetBrowserMount | undefined;
          let diagnosticSurface: HTMLElement | null = null;
          let opening: Promise<boolean> | null = null;
          let queuedRefresh = false;
          let queuedForceBuild = false;
          let queuedAllowBuildFallback = true;
          let requestSequence = 0;
          let frameState = fnCreateWidgetPreviewState(
            extension.type === "widget-preview" ? "preview" : "published",
          );
          let statusSurface: HTMLElement | null = null;
          let retryFrame = (_action: "reload" | "rebuild"): void => undefined;
          const ownerWindow = application.ownerWindow as Window & typeof globalThis;
          const viewportSync = createWidgetViewportSync({
            container: args.container,
            createResizeObserver: (callback) => new ownerWindow.ResizeObserver(callback),
            devicePixelRatio: () => ownerWindow.devicePixelRatio,
            node: args.node,
          });
          const removeFrame = (): void => {
            context.document.commit({
              source: extension.type === "widget-preview"
                ? "omnidraw.widget-preview.remove"
                : "omnidraw.widget.remove",
              commands: [{ type: "remove", nodeId: args.node.id, descendants: "remove" }],
            });
          };
          const syncPreviewActions = async (): Promise<void> => {
            const current = context.document.node(args.node.id);
            if (current?.kind !== "widget-frame") return;
            const currentExtension = fnReadCanvasWidgetExtension(current);
            if (
              currentExtension?.type !== "widget-preview"
              || currentExtension.widgetKey !== extension.widgetKey
            ) return;
            const catalog = await application.rpc.request("widget.catalog.get", {}, {
              signal: args.signal,
            });
            const next = fnWidgetPreviewWithPublishedActionAvailability(
              current,
              publishedCatalogEntry(catalog, extension.widgetKey) !== null,
            );
            if (sameNodeImage(current, next)) return;
            context.document.commit({
              source: "omnidraw.widget-preview.sync-actions",
              history: "ignore",
              commands: [{ type: "upsert", node: next }],
            });
          };
          const renderFrameStatus = (): void => {
            args.container.style.display = "grid";
            statusSurface?.remove();
            statusSurface = createWidgetFrameStatusSurface({
              document: args.container.ownerDocument,
              state: frameState,
              onRetry: (action) => retryFrame(action),
              onRemove: removeFrame,
            });
            if (statusSurface !== null) args.container.append(statusSurface);
          };
          const transitionFrame = (event: Parameters<typeof fnTransitionWidgetPreviewState>[1]): void => {
            frameState = fnTransitionWidgetPreviewState(frameState, event);
            renderFrameStatus();
          };
          const renderFailure = (error: unknown, requestId: number): void => {
            diagnosticSurface?.remove();
            diagnosticSurface = null;
            const buildState = extension.type === "widget-preview"
              ? previewBuildState(error)
              : null;
            if (buildState?.phase === "unbuilt" || buildState?.phase === "build_required") {
              transitionFrame({ type: "build-phase", requestId, phase: "build_required" });
            } else if (buildState !== null) {
              transitionFrame({
                type: "build-failed",
                requestId,
                message: buildState.message,
              });
            } else {
              transitionFrame({
                type: "load-failed",
                requestId,
                message: widgetLoadFailureMessage(error, extension.type === "widget-preview"),
              });
            }
          };
          const openOnce = async (
            forceBuild: boolean,
            allowBuildFallback: boolean,
          ): Promise<boolean> => {
            const previous = mount;
            const requestId = ++requestSequence;
            let next: IWidgetBrowserMount | undefined;
            const nextDiagnostic = { surface: null as HTMLElement | null };
            let fatalError: unknown;
            let committed = false;
            const initialViewport = viewportSync.current();
            transitionFrame({ type: "request", requestId });
            const pollController = new AbortController();
            const pollBuildState = async (): Promise<void> => {
              if (extension.type !== "widget-preview") return;
              while (!pollController.signal.aborted && !args.signal.aborted) {
                const buildState = await runtime.buildState(
                  exactSubject.widgetKey,
                  pollController.signal,
                ).catch(() => null);
                if (buildState === null || pollController.signal.aborted) return;
                if (
                  buildState.phase === "restoring"
                  || buildState.phase === "building"
                  || buildState.phase === "validating"
                ) {
                  transitionFrame({ type: "build-phase", requestId, phase: buildState.phase });
                } else if (buildState.phase === "unbuilt" || buildState.phase === "build_required") {
                  transitionFrame({ type: "build-phase", requestId, phase: "build_required" });
                } else if (buildState.phase === "ready") {
                  transitionFrame({ type: "build-accepted", requestId });
                } else if (buildState.phase === "rejected") {
                  const diagnostic = buildState.diagnostics[0]?.message;
                  transitionFrame({
                    type: "build-failed",
                    requestId,
                    message: diagnostic ?? "The host rejected the current widget build.",
                  });
                }
                if (buildState.phase === "ready" || buildState.phase === "rejected") return;
                await new Promise<void>((resolve) => {
                  const timer = ownerWindow.setTimeout(resolve, 140);
                  pollController.signal.addEventListener("abort", () => {
                    ownerWindow.clearTimeout(timer);
                    resolve();
                  }, { once: true });
                });
              }
            };
            let pollingBuildState = false;
            const startBuildStatePolling = (): void => {
              if (pollingBuildState || extension.type !== "widget-preview") return;
              pollingBuildState = true;
              void pollBuildState();
            };
            const retainGuestDiagnostic = (diagnostic: TWidgetHostDiagnostic): void => {
              if (extension.type !== "widget-preview" || !fnIsWidgetGuestReportedError(diagnostic)) return;
              nextDiagnostic.surface ??= createWidgetGuestReportedErrorSurface(
                args.container.ownerDocument,
                diagnostic,
              );
              if (committed && mount === next && !nextDiagnostic.surface.isConnected) {
                diagnosticSurface?.remove();
                diagnosticSurface = nextDiagnostic.surface;
                args.container.append(nextDiagnostic.surface);
              }
            };
            const retireFatalMount = async (failedMount: IWidgetBrowserMount, error: unknown): Promise<void> => {
              await retireFatalWidgetMount({
                canRenderFailure: () => mount === undefined && !args.signal.aborted,
                detach: (failed) => viewportSync.detach(failed),
                error,
                failedMount,
                isCurrent: () => mount === failedMount,
                renderFailure: (failure) => renderFailure(failure, requestId),
                retire: () => {
                  diagnosticSurface?.remove();
                  diagnosticSurface = null;
                  mount = undefined;
                  mounts.delete(args.node.id);
                  transitionFrame({ type: "display-retired", requestId });
                },
              });
            };
            try {
              if (forceBuild && extension.type === "widget-preview") {
                const rebuild = application.rpc.request("widget.preview.rebuildDraft", {
                  widgetKey: extension.widgetKey,
                }, { signal: args.signal });
                startBuildStatePolling();
                await rebuild;
                transitionFrame({ type: "build-accepted", requestId });
                options.invalidateWidgets();
              }
              const mountCandidate = async (): Promise<IWidgetBrowserMount> => runtime.mount({
                mode: extension.type === "widget-preview" ? "preview" : "published",
                container: args.container,
                subject: exactSubject,
                viewport: initialViewport,
                theme: fnWidgetHostTheme(application.theme.service.getTheme()),
                props: extension.uiProps,
                signal: args.signal,
                onDiagnostic: (diagnostic) => {
                  retainGuestDiagnostic(diagnostic);
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
              try {
                const candidate = mountCandidate();
                startBuildStatePolling();
                next = await candidate;
              } catch (error) {
                const buildState = extension.type === "widget-preview"
                  ? previewBuildState(error)
                  : null;
                if (
                  extension.type !== "widget-preview"
                  || buildState === null
                  || !fnShouldRebuildWidgetPreview({
                    allowBuildFallback,
                    phase: buildState.phase,
                  })
                ) throw error;
                transitionFrame({ type: "build-phase", requestId, phase: "build_required" });
                const rebuild = application.rpc.request("widget.preview.rebuildDraft", {
                  widgetKey: extension.widgetKey,
                }, { signal: args.signal });
                await rebuild;
                transitionFrame({ type: "build-accepted", requestId });
                options.invalidateWidgets();
                next = await mountCandidate();
              }
              await next.ready();
              if (fatalError !== undefined) throw fatalError;
            } catch (error) {
              nextDiagnostic.surface?.remove();
              await next?.dispose("replacement-failed").catch(() => undefined);
              renderFailure(error, requestId);
              return false;
            } finally {
              pollController.abort("preview-request-settled");
            }
            diagnosticSurface?.remove();
            diagnosticSurface = nextDiagnostic.surface;
            mount = next;
            viewportSync.attach(next, initialViewport);
            mounts.set(args.node.id, next);
            committed = true;
            if (diagnosticSurface !== null && !diagnosticSurface.isConnected) {
              args.container.append(diagnosticSurface);
            }
            transitionFrame({ type: "candidate-ready", requestId });
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
          };
          const open = async (options: TPreviewOpenOptions = {}): Promise<boolean> => {
            if (opening !== null) {
              queuedRefresh = true;
              queuedForceBuild ||= options.forceBuild === true;
              if (options.allowBuildFallback === false || options.manual === true) {
                queuedAllowBuildFallback = false;
              }
              return opening;
            }
            opening = (async () => {
              let result = false;
              let forceBuild = options.forceBuild === true;
              let allowBuildFallback = options.allowBuildFallback ?? (options.manual !== true);
              do {
                queuedRefresh = false;
                queuedForceBuild = false;
                queuedAllowBuildFallback = true;
                result = await openOnce(forceBuild, allowBuildFallback);
                forceBuild = queuedForceBuild;
                allowBuildFallback = queuedAllowBuildFallback;
              } while (queuedRefresh && !args.signal.aborted);
              if (!result && options.manual) {
                const failed = fnWidgetPreviewPresentation(frameState);
                if (failed !== null) showErrorToast(failed.title, failed.message);
              }
              return result;
            })().finally(() => {
              opening = null;
            });
            return opening;
          };
          retryFrame = (action) => {
            void open({
              forceBuild: action === "rebuild",
              manual: true,
              allowBuildFallback: false,
            });
          };
          reloadByNode.set(args.node.id, open);
          if (extension.type === "widget-preview") {
            previewWidgetKeyByNode.set(args.node.id, extension.widgetKey);
            syncPreviewActionsByNode.set(args.node.id, syncPreviewActions);
            void syncPreviewActions().catch(() => undefined);
          }
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
            const previewClosure = extension.type === "widget-preview"
              ? closePreviewSession(args.node.id)
              : null;
            void previewClosure?.catch(() => undefined);
            viewportSync.disconnect();
            unsubscribeNode?.();
            unsubscribeTheme();
            reloadByNode.delete(args.node.id);
            previewWidgetKeyByNode.delete(args.node.id);
            syncPreviewActionsByNode.delete(args.node.id);
            mounts.delete(args.node.id);
            statusSurface?.remove();
            diagnosticSurface?.remove();
            await mount?.dispose("canvas-unmount");
            await previewClosure?.catch(() => undefined);
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
            await reloadByNode.get(node.id)?.({
              manual: true,
              allowBuildFallback: false,
            });
            return;
          }
          if (previewActionId === "rebuild") {
            const rebuilt = await reloadByNode.get(node.id)?.({ forceBuild: true, manual: true });
            if (rebuilt) showSuccessToast("Widget draft rebuilt");
            return;
          }
          if (previewActionId === "publish") {
            await buildAndPublishPreview(application, extension.widgetKey, signal);
            options.invalidateWidgets();
            await syncPreviewActionsByNode.get(node.id)?.().catch(() => undefined);
            showSuccessToast(
              "Widget built and published",
              "This frame remains a draft Preview. Use Replace with published widget when you are ready to make this placement follow the publication.",
            );
            return;
          }
          if (previewActionId === "replace-with-published") {
            let replacementAccepted = false;
            try {
              const catalog = await application.rpc.request("widget.catalog.get", {}, { signal });
              const published = publishedCatalogEntry(catalog, extension.widgetKey);
              if (published === null) {
                throw new Error("The current publication is missing or unhealthy.");
              }
              const unpublishedChanges = published.differences.manifest !== "same";
              const label = published.published!.config!.tool.label.trim()
                || published.published!.config!.name;
              const confirmed = application.ownerWindow.confirm(
                unpublishedChanges
                  ? `Replace this Preview with the currently published ${label}? The draft has unpublished changes; they will stay in the draft and will not be built or published.`
                  : `Replace this Preview with the published ${label}? The frame keeps its Canvas layout and will follow future publications.`,
              );
              if (!confirmed || signal.aborted) return;
              const instanceId = application.ownerWindow.crypto.randomUUID();
              await application.rpc.request("widget.placement.resolve", {
                reference: published.placement!.reference,
                replacement: {
                  canvasId: context.config.canvasId,
                  elementId: node.id,
                  previewInstanceId: extension.instanceId,
                  targetInstanceId: instanceId,
                },
              }, { signal });
              const current = context.document.node(node.id);
              if (current?.kind !== "widget-frame") {
                throw new Error("The Preview frame no longer exists.");
              }
              const replacement = fnReplacePreviewWithPublishedWidget({
                node: current,
                widgetKey: extension.widgetKey,
                instanceId,
                publishedTitle: label,
              });
              await commitAndWaitForAcceptedNode({
                document: context.document,
                node: replacement,
                signal,
              });
              replacementAccepted = true;
              await closePreviewSession(node.id);
              context.document.setSelection([node.id], { focusedNodeId: node.id });
              showSuccessToast(
                "Preview replaced with published widget",
                "This frame now follows the current publication.",
              );
            } catch (error) {
              if (signal.aborted) return;
              showErrorToast(
                replacementAccepted
                  ? "Preview replaced, but cleanup failed"
                  : "Preview was not replaced",
                error instanceof Error
                  ? error.message
                  : replacementAccepted
                    ? "The old Preview session could not be closed."
                    : "The replacement could not be accepted.",
              );
            }
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
        context.document.insertAtFront({ source: "omnidraw.widget-place", node });
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
          catalogEventController.abort("widget-extension-disposed");
          if (catalogRefreshTimer !== undefined) {
            application.ownerWindow.clearTimeout(catalogRefreshTimer);
            catalogRefreshTimer = undefined;
          }
          pendingPreviewRefreshes.clear();
          pendingPreviewActionSyncs.clear();
          unbindPreviewAutomation?.();
          reloadByNode.clear();
          previewWidgetKeyByNode.clear();
          syncPreviewActionsByNode.clear();
          mounts.clear();
          await Promise.allSettled(previewClosureByNode.values());
          previewClosureByNode.clear();
          await runtime.dispose();
        },
      };
    },
  };
}
