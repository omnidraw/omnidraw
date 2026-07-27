import type {
  IService,
  IStartableService,
  IStoppableService,
} from "@vibecanvas/runtime";
import type { ThemeService } from "@vibecanvas/service-theme";
import type { TBinding } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { SyncHook } from "@vibecanvas/tapable";
import { getStroke } from "perfect-freehand";
import {
  CanvasEngineAdapter,
  type TCanvasEngineAdapterArgs,
  type TCanvasEngineDiagnostic,
  type TCreateCanvasEngine,
} from "../../engine/CanvasEngineAdapter";
import {
  ProjectionCoordinator,
  type TCanvasProjectionCoordinatorResult,
} from "../../engine/ProjectionCoordinator";
import type { CameraEngineBridge } from "../../engine/camera/CameraEngineBridge";
import type { CanvasInputAdapter } from "../../engine/input/CanvasInputAdapter";
import { CanvasTransientTargetRegistry } from "../../engine/input/CanvasTransientTargetRegistry";
import {
  CanvasEditorBridge,
  type TCanvasPathCommit,
} from "../../engine/editor/CanvasEditorBridge";
import { fnCanvasElementFromPathCommit } from "../../engine/editor/fn.path-commit";
import {
  createBuiltInProjectionRegistry,
  registerProjectionDefinition,
  type ProjectionRegistry,
} from "../../engine/projection/ProjectionRegistry";
import { fxReadCanvasProjectionTheme } from "../../engine/projection/fx.theme";
import { CanvasProjectionRuntimePort } from "../../engine/projection-runtime/ProjectionRuntimePort";
import type {
  TCanvasProjectionIndex,
} from "../../engine/typed";
import type { TCanvasTarget } from "../../semantic/typed";
import type { CanvasProductRuntime } from "../../engine/product-runtime/CanvasProductRuntime";
import type { CrdtService } from "../crdt/CrdtService";
import type { ElementService } from "../element/ElementService";
import type { HistoryService } from "../history/HistoryService";
import type { CanvasPortalService } from "../portal/CanvasPortalService";
import { CrdtProjectionService } from "../projection/CrdtProjectionService";
import type { SelectionService } from "../selection/SelectionService";
import { CanvasMode } from "../selection/CONSTANTS";
import { fnShape1dBinding } from "../../plugins/shape1d/fn.binding";
import { fnCanvasProjectionDiagnosticGeneration } from "./fn.projection-diagnostics";

export type TCanvasResizeObserver = {
  observe(target: Element): void;
  disconnect(): void;
};

export type TSceneServiceArgs = {
  container: HTMLDivElement;
  crdt: CrdtService;
  theme: ThemeService;
  selection: SelectionService;
  history: HistoryService;
  element: ElementService;
  portal: CanvasPortalService;
  notification?: {
    showError(title: string, description?: string): void;
  };
  createEngine?: TCreateCanvasEngine;
  createResizeObserver?(
    listener: ResizeObserverCallback,
  ): TCanvasResizeObserver;
  engineConfig?: TCanvasEngineAdapterArgs["engineConfig"];
};

export interface TSceneServiceHooks {
  resize: SyncHook<[number, number]>;
  projection: SyncHook<[TCanvasProjectionCoordinatorResult]>;
  diagnostic: SyncHook<[TCanvasEngineDiagnostic]>;
}

type TSceneServiceState =
  | "idle"
  | "starting"
  | "ready"
  | "stopping"
  | "stopped"
  | "failed";

/**
 * Production canvas scene owner. The engine is an implementation detail;
 * callers receive only canvas-owned camera, input, projection, and lifecycle
 * contracts.
 */
export class SceneService
implements
  IService<TSceneServiceHooks>,
  IStartableService,
  IStoppableService {
  readonly name = "scene";
  readonly container: HTMLDivElement;
  readonly hooks: TSceneServiceHooks = {
    resize: new SyncHook(),
    projection: new SyncHook(),
    diagnostic: new SyncHook(),
  };

  readonly #args: TSceneServiceArgs;
  readonly #adapter: CanvasEngineAdapter;
  readonly #transientTargets = new CanvasTransientTargetRegistry();

  #state: TSceneServiceState = "idle";
  #camera: CameraEngineBridge | null = null;
  #editor: CanvasEditorBridge | null = null;
  #input: CanvasInputAdapter | null = null;
  #product: CanvasProductRuntime | null = null;
  #coordinator: ProjectionCoordinator | null = null;
  #projectionRuntime: CanvasProjectionRuntimePort | null = null;
  #projectionService: CrdtProjectionService | null = null;
  #resizeObserver: TCanvasResizeObserver | null = null;
  #removeThemeListener: (() => void) | null = null;
  #removeElementDefinitionsListener: (() => void) | null = null;
  #removeAdapterListener: (() => void) | null = null;
  #startPromise: Promise<void> | null = null;
  #stopPromise: Promise<void> | null = null;
  #gridVisible = true;
  #lastResize: { width: number; height: number } | null = null;
  #activeProjectionDiagnosticKeys = new Set<string>();

  constructor(args: TSceneServiceArgs) {
    this.#args = args;
    this.container = args.container;
    this.#adapter = new CanvasEngineAdapter({
      host: args.container,
      ...(args.createEngine === undefined
        ? {}
        : { createEngine: args.createEngine }),
      ...(args.engineConfig === undefined
        ? {}
        : { engineConfig: args.engineConfig }),
      onDiagnostic: (diagnostic) => {
        this.hooks.diagnostic.call(diagnostic);
      },
    });
  }

  get state(): TSceneServiceState {
    return this.#state;
  }

  get camera(): CameraEngineBridge {
    if (this.#camera === null) {
      throw new Error("Canvas scene camera is not ready.");
    }
    return this.#camera;
  }

  get input(): CanvasInputAdapter {
    if (this.#input === null) {
      throw new Error("Canvas scene input is not ready.");
    }
    return this.#input;
  }

  get editor(): CanvasEditorBridge {
    if (this.#editor === null) {
      throw new Error("Canvas editor is not ready.");
    }
    return this.#editor;
  }

  get product(): CanvasProductRuntime {
    if (this.#product === null) {
      throw new Error("Canvas product runtime is not ready.");
    }
    return this.#product;
  }

  get projectionIndex(): TCanvasProjectionIndex | null {
    return this.#coordinator?.projectionIndex ?? null;
  }

  get transientTargets(): CanvasTransientTargetRegistry {
    return this.#transientTargets;
  }

  diagnostics(): readonly TCanvasEngineDiagnostic[] {
    return this.#adapter.diagnostics();
  }

  metricsSnapshot() {
    return this.#adapter.metricsSnapshot();
  }

  render() {
    return this.#adapter.render({
      includePortals: true,
      awaitResources: true,
    });
  }

  fitIntrinsicImageSize(
    ...args: Parameters<CanvasEngineAdapter["fitIntrinsicImageSize"]>
  ) {
    return this.#adapter.fitIntrinsicImageSize(...args);
  }

  get gridVisible(): boolean {
    return this.#gridVisible;
  }

  async setGridVisible(visible: boolean): Promise<boolean> {
    if (this.#gridVisible === visible) {
      return false;
    }
    this.#gridVisible = visible;
    const coordinator = this.#coordinator;
    if (coordinator === null) {
      return true;
    }
    coordinator.setGridVisible(visible);
    const result = await coordinator.reproject(
      this.#args.crdt.doc(),
      this.#args.crdt.revision,
      "view",
    );
    this.#publishProjectionResult(result);
    return result.status === "applied" || result.status === "noop";
  }

  start(): Promise<void> {
    if (this.#startPromise !== null) {
      return this.#startPromise;
    }
    if (this.#state !== "idle") {
      return Promise.reject(
        new Error(`Canvas scene cannot start from '${this.#state}'.`),
      );
    }
    this.#state = "starting";
    this.#startPromise = this.#start();
    return this.#startPromise;
  }

  stop(): Promise<void> {
    if (this.#stopPromise !== null) {
      return this.#stopPromise;
    }
    this.#state = "stopping";
    this.#stopPromise = this.#stop();
    return this.#stopPromise;
  }

  async #start(): Promise<void> {
    try {
      this.#removeAdapterListener = this.#adapter.subscribe((event) => {
        if (event.type === "resize") {
          this.#onResize(event.cssSize.width, event.cssSize.height);
        }
      });
      await this.#adapter.start();

      const camera = this.#adapter.createCameraBridge({
        initialViewport: { x: 0, y: 0, zoom: 1 },
      });
      camera.start();
      this.#camera = camera;

      const projectionRuntime = new CanvasProjectionRuntimePort({
        adapter: this.#adapter,
        mountContent: (args) => {
          return this.#args.portal.mount(args);
        },
        readViewportSize: () => ({
          width: this.container.clientWidth,
          height: this.container.clientHeight,
        }),
        onUpdateError: ({ portalId, error }) => {
          this.hooks.diagnostic.call({
            sequence: -1,
            severity: "error",
            source: "ownership",
            code: "PORTAL_CONTENT_UPDATE_FAILED",
            message: error instanceof Error ? error.message : String(error),
            recoverable: true,
            details: { portalId },
          });
        },
        onResourcePreloadError: (error) => {
          this.hooks.diagnostic.call({
            sequence: -1,
            severity: "error",
            source: "ownership",
            code: "RESOURCE_PRELOAD_FAILED",
            message: error instanceof Error ? error.message : String(error),
            recoverable: true,
          });
        },
        onPresentationCommitError: ({ stage, error }) => {
          this.hooks.diagnostic.call({
            sequence: -1,
            severity: "error",
            source: "ownership",
            code: "PRESENTATION_COMMIT_FAILED",
            message: error instanceof Error ? error.message : String(error),
            recoverable: true,
            details: { stage },
          });
        },
      });
      this.#projectionRuntime = projectionRuntime;

      const coordinator = new ProjectionCoordinator({
        registry: this.#createProjectionRegistry(),
        theme: fxReadCanvasProjectionTheme(this.#args.theme, {}),
        dependencies: {
          getStroke,
          unsupportedNodeKinds: [
            ...(this.#adapter.capabilities?.unsupportedNodeKinds ?? []),
          ],
          portalsAvailable: this.#adapter.capabilities?.portals === "dom",
          getViewportSize: () => ({
            width: this.container.clientWidth,
            height: this.container.clientHeight,
          }),
        },
        runtime: projectionRuntime,
        onPruneSelectionAndFocus: ({ elementIds, groupIds }) => {
          this.#args.selection.prune(new Set([
            ...[...elementIds].map((id) => `element:${id}`),
            ...[...groupIds].map((id) => `group:${id}`),
          ]));
        },
      });
      coordinator.setGridVisible(this.#gridVisible);
      this.#coordinator = coordinator;

      const projectionService = new CrdtProjectionService({
        crdt: this.#args.crdt,
        coordinator,
      });
      projectionService.hooks.result.tap((result) => {
        this.#publishProjectionResult(result);
        if (result.status === "applied" || result.status === "noop") {
          this.#publishProjectionDiagnostics();
        }
      });
      projectionService.hooks.error.tap((error, revision) => {
        this.hooks.diagnostic.call({
          sequence: -1,
          severity: "error",
          source: "scene",
          code: "PROJECTION_FAILED",
          message: error instanceof Error ? error.message : String(error),
          recoverable: true,
          details: { revision },
        });
      });
      this.#projectionService = projectionService;
      await projectionService.start();

      const editor = new CanvasEditorBridge({
        adapter: this.#adapter,
        host: this.container,
        history: {
          canUndo: () => this.#args.history.canUndo(),
          canRedo: () => this.#args.history.canRedo(),
          retainedWeight: () => {
            return this.#args.history.getUndoStackSize()
              + this.#args.history.getRedoStackSize();
          },
          subscribe: (listener) => {
            return this.#args.history.hooks.change.tap(listener);
          },
          undo: () => this.#args.history.undo(),
          redo: () => this.#args.history.redo(),
          clear: () => this.#args.history.clear(),
        },
        selection: {
          snapshot: () => this.#args.selection.snapshot,
          subscribe: (listener) => {
            return this.#args.selection.hooks.change.tap(() => listener());
          },
          refresh: () => {
            this.#args.selection.refresh();
          },
          setSelection: (selection) => {
            this.#args.selection.setSelection(selection);
          },
          setFocusedTarget: (target, options) => {
            this.#args.selection.setFocusedTarget(target, options);
          },
          pathInteractionsEnabled: () => {
            return this.#args.selection.mode === CanvasMode.SELECT;
          },
        },
        getDocument: () => this.#args.crdt.doc(),
        getProjectionIndex: () => this.#coordinator?.projectionIndex ?? null,
        onPathCommit: ({ target, node, source, activeAnchorId }) => {
          const current = this.#args.crdt.doc().elements[target.id];
          if (current === undefined) {
            return;
          }
          const endpoint = this.#pathEndpointPatch({
            target,
            node,
            activeAnchorId,
          });
          const next = fnCanvasElementFromPathCommit({
            element: current,
            node,
            source,
            updatedAt: Date.now(),
            ...(endpoint?.endpoint === "start"
              ? {
                  startPoint: endpoint.point,
                  startBinding: endpoint.binding,
                }
              : {}),
            ...(endpoint?.endpoint === "end"
              ? {
                  endPoint: endpoint.point,
                  endBinding: endpoint.binding,
                }
              : {}),
          });
          if (next === null) {
            return;
          }
          const result = this.#args.crdt.build()
            .patchElement(next.id, next)
            .commit();
          this.#args.history.record({
            label: source === "cangine-editor:path-transform"
              ? "Transform connector"
              : "Edit connector points",
            undo: () => this.#args.crdt.applyOps({ ops: result.undoOps }),
            redo: () => this.#args.crdt.applyOps({ ops: result.redoOps }),
          });
        },
        resolveNavigationIntent: (event) => {
          return event.type === "pointer-down"
            && (
              event.button === 1
              || (
                event.button === 0
                && this.#args.selection.mode === CanvasMode.HAND
              )
            );
        },
        onError: (error) => {
          this.hooks.diagnostic.call({
            sequence: -1,
            severity: "error",
            source: "adapter",
            code: "EDITOR_CALLBACK_FAILED",
            message: error instanceof Error ? error.message : String(error),
            recoverable: true,
          });
        },
      });
      editor.attach();
      this.#editor = editor;

      const input = this.#adapter.createInputAdapter({
        getProjectionIndex: () => this.#coordinator?.projectionIndex ?? null,
        getDocument: () => this.#args.crdt.doc(),
        worldToViewport: (point) => this.camera.worldToViewport(point),
        resolveTransientTarget: (query) => {
          return this.#transientTargets.resolve(query);
        },
        onError: (error, diagnostic) => {
          this.hooks.diagnostic.call({
            sequence: -1,
            severity: "error",
            source: "adapter",
            code: `INPUT_${diagnostic.operation.toUpperCase().replaceAll("-", "_")}`,
            message: error instanceof Error ? error.message : String(error),
            recoverable: true,
          });
        },
      });
      this.#input = input;

      this.#product = this.#adapter.createProductRuntime({
        getProjectionIndex: () => this.#coordinator?.projectionIndex ?? null,
        getDocument: () => this.#args.crdt.doc(),
        transientTargets: this.#transientTargets,
        onDiagnostic: (diagnostic) => {
          this.hooks.diagnostic.call({
            sequence: -1,
            severity: "error",
            source: "adapter",
            code: `PRODUCT_${diagnostic.operation.toUpperCase().replaceAll("-", "_")}`,
            message: diagnostic.error instanceof Error
              ? diagnostic.error.message
              : String(diagnostic.error),
            recoverable: true,
            details: {
              ...(diagnostic.gestureId === undefined
                ? {}
                : { gestureId: diagnostic.gestureId }),
              ...(diagnostic.ownerId === undefined
                ? {}
                : { ownerId: diagnostic.ownerId }),
            },
          });
        },
      });
      this.#removeThemeListener = this.#args.theme.hooks.change.tap(() => {
        const activeCoordinator = this.#coordinator;
        if (activeCoordinator === null) {
          return;
        }
        activeCoordinator.setTheme(
          fxReadCanvasProjectionTheme(this.#args.theme, {}),
        );
        void activeCoordinator.reproject(
          this.#args.crdt.doc(),
          this.#args.crdt.revision,
          "theme",
        ).then((result) => {
          this.#publishProjectionResult(result);
        });
      });
      this.#removeElementDefinitionsListener = this.#args.element.hooks.elementsChange.tap(() => {
        const activeCoordinator = this.#coordinator;
        if (activeCoordinator === null) {
          return;
        }
        activeCoordinator.setRegistry(this.#createProjectionRegistry());
        void activeCoordinator.reproject(
          this.#args.crdt.doc(),
          this.#args.crdt.revision,
          "extension",
        ).then((result) => {
          this.#publishProjectionResult(result);
        });
      });

      this.#resizeObserver = this.#createResizeObserver();
      this.#resizeObserver.observe(this.container);
      this.#resizeToContainer();
      this.#state = "ready";
    } catch (error) {
      this.#state = "failed";
      await this.#stopResources();
      throw error;
    }
  }

  async #stop(): Promise<void> {
    await this.#startPromise?.catch(() => undefined);
    const failures = await this.#stopResources();
    this.#state = failures.length === 0 ? "stopped" : "failed";
    if (failures.length > 0) {
      throw new AggregateError(failures, "Canvas scene teardown failed.");
    }
  }

  async #stopResources(): Promise<unknown[]> {
    const failures: unknown[] = [];
    const attempt = async (effect: () => void | Promise<void>) => {
      try {
        await effect();
      } catch (error) {
        failures.push(error);
      }
    };

    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#removeThemeListener?.();
    this.#removeThemeListener = null;
    this.#removeElementDefinitionsListener?.();
    this.#removeElementDefinitionsListener = null;
    this.#removeAdapterListener?.();
    this.#removeAdapterListener = null;
    await attempt(() => this.#product?.destroy());
    this.#product = null;
    await attempt(() => this.#input?.destroy());
    this.#input = null;
    await attempt(() => this.#editor?.destroy());
    this.#editor = null;
    this.#transientTargets.destroy();
    await attempt(() => this.#projectionService?.stop());
    this.#projectionService = null;
    this.#coordinator?.stop();
    this.#coordinator = null;
    this.#activeProjectionDiagnosticKeys.clear();
    await attempt(() => this.#projectionRuntime?.destroy());
    this.#projectionRuntime = null;
    this.#camera?.destroy();
    this.#camera = null;
    await attempt(() => this.#adapter.destroy());
    return failures;
  }

  #createResizeObserver(): TCanvasResizeObserver {
    if (this.#args.createResizeObserver !== undefined) {
      return this.#args.createResizeObserver(() => {
        this.#resizeToContainer();
      });
    }
    return new ResizeObserver(() => {
      this.#resizeToContainer();
    });
  }

  #pathEndpointPatch(args: {
    target: Extract<TCanvasTarget, { kind: "element" }>;
    node: TCanvasPathCommit["node"];
    activeAnchorId: string | null;
  }): {
    endpoint: "start" | "end";
    point: readonly [number, number];
    binding: TBinding | null;
  } | null {
    const endpoint = args.activeAnchorId === "endpoint:from"
      ? "start"
      : args.activeAnchorId === "endpoint:to"
      ? "end"
      : null;
    const value = endpoint === "start" ? args.node.from : args.node.to;
    if (
      endpoint === null
      || value.type !== "point"
      || this.#product === null
      || this.#input === null
    ) {
      return null;
    }
    const rawPoint = [value.point.x, value.point.y] as const;
    const world = this.#product.geometry.localToWorld(
      { target: args.target, role: "render" },
      value.point,
    );
    if (world === null) {
      return { endpoint, point: rawPoint, binding: null };
    }
    const viewport = this.#product.geometry.worldToViewport(world);
    const candidate = this.#input.hitTestViewport({
      point: viewport,
      options: { mode: "all", tolerance: 6 },
    }).find((hit) => {
      return hit.target.kind === "element"
        && hit.target.id !== args.target.id
        && this.#args.crdt.doc().elements[hit.target.id]?.locked === false;
    })?.target;
    if (candidate?.kind !== "element") {
      return { endpoint, point: rawPoint, binding: null };
    }
    const bounds = this.#product.geometry.worldBounds({ target: candidate });
    const nearest = this.#product.geometry.nearestPoint(
      { target: candidate },
      world,
    )?.point;
    if (bounds === null || nearest === undefined) {
      return { endpoint, point: rawPoint, binding: null };
    }
    const local = this.#product.geometry.worldToLocal(
      { target: args.target, role: "render" },
      nearest,
    );
    if (local === null) {
      return { endpoint, point: rawPoint, binding: null };
    }
    return {
      endpoint,
      point: [local.x, local.y],
      binding: fnShape1dBinding({
        targetId: candidate.id,
        worldPoint: nearest,
        worldBounds: bounds,
      }),
    };
  }

  #resizeToContainer(): void {
    const width = Math.max(0, this.container.clientWidth);
    const height = Math.max(0, this.container.clientHeight);
    this.#adapter.resize({ width, height });
    this.#camera?.reapplyViewportSize();
    this.#onResize(width, height);
  }

  #onResize(width: number, height: number): void {
    if (
      this.#lastResize?.width === width
      && this.#lastResize.height === height
    ) {
      return;
    }
    this.#lastResize = { width, height };
    this.hooks.resize.call(width, height);
    const coordinator = this.#coordinator;
    if (coordinator !== null) {
      void coordinator.reproject(
        this.#args.crdt.doc(),
        this.#args.crdt.revision,
        "view",
      ).then((result) => {
        this.#publishProjectionResult(result);
      });
    }
  }

  #createProjectionRegistry(): ProjectionRegistry {
    let registry = createBuiltInProjectionRegistry();
    for (
      const definition
      of this.#args.element.projectionExtensions().definitions
    ) {
      registry = registerProjectionDefinition(registry, definition);
    }
    return registry;
  }

  #publishProjectionResult(result: TCanvasProjectionCoordinatorResult): void {
    this.hooks.projection.call(result);
    if (result.status === "applied" || result.status === "noop") {
      this.#editor?.syncSelection();
    }
  }

  #publishProjectionDiagnostics(): void {
    const projection = this.#coordinator?.lastGoodProjection;
    if (projection === null || projection === undefined) {
      return;
    }
    const generation = fnCanvasProjectionDiagnosticGeneration({
      previousKeys: this.#activeProjectionDiagnosticKeys,
      diagnostics: projection.diagnostics,
    });
    this.#activeProjectionDiagnosticKeys = generation.activeKeys;
    for (const diagnostic of generation.added) {
      const target = diagnostic.target;
      this.hooks.diagnostic.call({
        sequence: -1,
        severity: "error",
        source: "scene",
        code: `PROJECTION_${diagnostic.code}`,
        message: diagnostic.message,
        recoverable: true,
        details: {
          ...(diagnostic.projectorId === undefined
            ? {}
            : { projectorId: diagnostic.projectorId }),
          ...(target === undefined
            ? {}
            : {
                targetKind: target.kind,
                targetId: target.id,
              }),
        },
      });
      this.#args.notification?.showError(
        "Canvas feature rendered as a placeholder",
        `${diagnostic.code}: ${diagnostic.message}`,
      );
    }
  }
}
