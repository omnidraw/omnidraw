import {
  createInfiniteCanvas,
  type IInfiniteCanvasEngine,
  type IResourceRegistrationOwner,
  type TAccessibilityConfig,
  type TCanvasEngineConfig,
  type TDiagnosticsConfig,
  type TEngineCapabilities,
  type TEngineEvent,
  type TEngineMetricSnapshot,
  type TFrameMetrics,
  type TJsonObject,
  type TRenderNowOptions,
  type TRenderResult,
  type TSceneTransactionOptions,
  type TSceneSnapshot,
  type TSerializedSceneCommand,
  type TSize2,
} from "@omnidraw/cangine";
import { fnCanvasEngineCapabilityIssues } from "./fn.assert-capabilities";
import { fnCanvasEngineInitialScene } from "./fn.initial-scene";
import {
  CameraEngineBridge,
  type TCameraEngineBridgeArgs,
} from "./camera/CameraEngineBridge";
import { CanvasInputAdapter } from "./input/CanvasInputAdapter";
import type { CanvasTransientTargetRegistry } from "./input/CanvasTransientTargetRegistry";
import type { TCanvasInputAdapterConfig } from "./input/typed";
import { PortalOwnership } from "./portals/PortalOwnership";
import { CanvasProductRuntime } from "./product-runtime/CanvasProductRuntime";
import type {
  TCanvasProductRuntimeData,
  TCanvasProductRuntimeDiagnostic,
} from "./product-runtime/typed";
import { CanvasTransientService } from "./transients/CanvasTransientService";

const REQUIRED_RENDER_PROFILE = {
  vector2D: "webgl2",
  threeD: "disabled",
  portals: "dom",
} as const;

const DEFAULT_DIAGNOSTIC_CAPACITY = 128;

export type TCreateCanvasEngine = (
  config: TCanvasEngineConfig,
) => Promise<IInfiniteCanvasEngine>;

export type TCanvasEngineConfigSeam = Omit<
  TCanvasEngineConfig,
  "host" | "renderProfile" | "accessibility" | "diagnostics"
> & {
  accessibility?: Omit<TAccessibilityConfig, "enabled" | "exposeCanvasNodes">;
  diagnostics?: TDiagnosticsConfig;
};

export type TCanvasEngineAdapterArgs = {
  host: HTMLElement;
  createEngine?: TCreateCanvasEngine;
  engineConfig?: TCanvasEngineConfigSeam;
  diagnosticCapacity?: number;
  onDiagnostic?(diagnostic: TCanvasEngineDiagnostic): void;
};

export type TCanvasEngineAdapterStatus =
  | "idle"
  | "starting"
  | "ready"
  | "suspended"
  | "context-lost"
  | "failed"
  | "destroying"
  | "destroyed";

export type TCanvasEngineDiagnostic = {
  sequence: number;
  severity: "warning" | "error";
  source: "adapter" | "engine" | "ownership" | "scene";
  code: string;
  message: string;
  recoverable: boolean;
  nodeId?: string;
  resourceId?: string;
  details?: TJsonObject;
};

export type TCanvasEngineAdapterEvent =
  | {
      type: "status";
      previous: TCanvasEngineAdapterStatus;
      status: TCanvasEngineAdapterStatus;
    }
  | {
      type: "resize";
      cssSize: TSize2;
      deviceSize: TSize2;
      devicePixelRatio: number;
    }
  | { type: "context-lost"; backendId: string }
  | { type: "context-restored"; backendId: string }
  | { type: "metrics"; metrics: TFrameMetrics }
  | { type: "diagnostic"; diagnostic: TCanvasEngineDiagnostic };

export type TCanvasSceneMutationOptions = {
  source?: string;
  coalesceKey?: string;
  render?: "schedule" | "immediate" | "none";
};

export type TCanvasSceneApplyArgs = TCanvasSceneMutationOptions & {
  snapshot: TSceneSnapshot;
};

export type TCanvasSceneCommandApplyArgs = TCanvasSceneMutationOptions & {
  commands: readonly TSerializedSceneCommand[];
};

export type TCanvasSceneApplyResult =
  | {
      ok: true;
      revision: number;
    }
  | {
      ok: false;
      revision: number;
      error: unknown;
      fatal: boolean;
    };

export type TCanvasEngineAdapterErrorCode =
  | "CAPABILITY_MISMATCH"
  | "DESTROYED"
  | "ENGINE_INITIALIZATION_FAILED"
  | "FAILED"
  | "NOT_STARTED";

export class CanvasEngineAdapterError extends Error {
  readonly code: TCanvasEngineAdapterErrorCode;
  readonly cause: unknown;

  constructor(
    code: TCanvasEngineAdapterErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "CanvasEngineAdapterError";
    this.code = code;
    this.cause = cause;
  }
}

function emptyMetrics(): TEngineMetricSnapshot {
  return {
    latestFrame: null,
    frameCount: 0,
    droppedFrameEstimate: 0,
    sceneRevision: 0,
    resourceCount: 0,
    portalCount: 0,
    transientOwnerCount: 0,
    transientNodeCount: 0,
    contextLossCount: 0,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown, fallback: string): string {
  if (
    typeof error === "object"
    && error !== null
    && "code" in error
    && typeof error.code === "string"
  ) {
    return error.code;
  }
  return fallback;
}

function cloneFrameMetrics(metrics: TFrameMetrics): TFrameMetrics {
  return { ...metrics };
}

function cloneMetricSnapshot(snapshot: TEngineMetricSnapshot): TEngineMetricSnapshot {
  return {
    ...snapshot,
    latestFrame: snapshot.latestFrame === null
      ? null
      : cloneFrameMetrics(snapshot.latestFrame),
  };
}

function engineHasFailed(engine: IInfiniteCanvasEngine): boolean {
  return engine.status === "failed";
}

type TSceneMutation = {
  failureCode: string;
  options: TCanvasSceneMutationOptions;
  apply(
    engine: IInfiniteCanvasEngine,
    transactionOptions: TSceneTransactionOptions,
  ): void;
};

/**
 * The only stateful composition boundary for canvas-engine. Product services
 * receive serializable snapshots and canvas-owned wrappers, never the engine.
 */
export class CanvasEngineAdapter {
  readonly #host: HTMLElement;
  readonly #createEngine: TCreateCanvasEngine;
  readonly #engineConfig: TCanvasEngineConfigSeam;
  readonly #diagnosticCapacity: number;
  readonly #onDiagnostic: ((diagnostic: TCanvasEngineDiagnostic) => void) | undefined;
  readonly #listeners = new Set<(event: TCanvasEngineAdapterEvent) => void>();
  readonly #diagnostics: TCanvasEngineDiagnostic[] = [];

  #status: TCanvasEngineAdapterStatus = "idle";
  #engine: IInfiniteCanvasEngine | null = null;
  #portalOwnership: PortalOwnership | null = null;
  #transientService: CanvasTransientService | null = null;
  #engineUnsubscribe: (() => void) | null = null;
  #metricsUnsubscribe: (() => void) | null = null;
  #startPromise: Promise<void> | null = null;
  #destroyPromise: Promise<void> | null = null;
  #destroyRequested = false;
  #terminalError: unknown = null;
  #capabilities: TEngineCapabilities | null = null;
  #lastMetrics: TEngineMetricSnapshot = emptyMetrics();
  #diagnosticSequence = 0;
  #sceneApplyActive = false;
  #errorDuringSceneApply: TCanvasEngineDiagnostic | null = null;
  #fallbackElement: HTMLDivElement | null = null;
  #fallbackPreviousPosition: string | null = null;

  constructor(args: TCanvasEngineAdapterArgs) {
    this.#host = args.host;
    this.#createEngine = args.createEngine ?? createInfiniteCanvas;
    this.#engineConfig = args.engineConfig ?? {};
    this.#diagnosticCapacity = Math.max(
      1,
      Math.floor(args.diagnosticCapacity ?? DEFAULT_DIAGNOSTIC_CAPACITY),
    );
    this.#onDiagnostic = args.onDiagnostic;
  }

  get status(): TCanvasEngineAdapterStatus {
    return this.#status;
  }

  get capabilities(): TEngineCapabilities | null {
    return this.#capabilities;
  }

  get portals(): PortalOwnership {
    if (this.#portalOwnership === null) {
      throw this.#unavailableError();
    }
    return this.#portalOwnership;
  }

  get transients(): CanvasTransientService {
    if (this.#transientService === null) {
      throw this.#unavailableError();
    }
    return this.#transientService;
  }

  get sceneRevision(): number {
    return this.#requireEngine().scene.revision;
  }

  createCameraBridge(
    args: Omit<TCameraEngineBridgeArgs, "camera"> = {},
  ): CameraEngineBridge {
    return new CameraEngineBridge({
      ...args,
      camera: this.#requireEngine().camera,
    });
  }

  createInputAdapter(
    args: Omit<TCanvasInputAdapterConfig, "input">,
  ): CanvasInputAdapter {
    return new CanvasInputAdapter({
      ...args,
      input: this.#requireEngine().input,
    });
  }

  createResourceRegistrationOwner(ownerId: string): IResourceRegistrationOwner {
    return this.#requireEngine().resources.createRegistrationOwner(ownerId);
  }

  createProductRuntime(
    args: TCanvasProductRuntimeData & {
      transientTargets: CanvasTransientTargetRegistry;
      onDiagnostic?(diagnostic: TCanvasProductRuntimeDiagnostic): void;
    },
  ): CanvasProductRuntime {
    const engine = this.#requireEngine();
    return new CanvasProductRuntime({
      ...args,
      camera: engine.camera,
      geometry: engine.geometry,
      interactions: engine.interactions,
      scene: engine.scene,
      text: engine.text,
      transforms: engine.transforms,
      transients: this.transients,
    });
  }

  sceneSnapshot(): TSceneSnapshot {
    return this.#requireEngine().scene.snapshot();
  }

  diagnostics(): readonly TCanvasEngineDiagnostic[] {
    return this.#diagnostics.map((diagnostic) => ({
      ...diagnostic,
      ...(diagnostic.details === undefined
        ? {}
        : { details: { ...diagnostic.details } }),
    }));
  }

  metricsSnapshot(): TEngineMetricSnapshot {
    const metrics = this.#engine?.metrics.snapshot() ?? this.#lastMetrics;
    return cloneMetricSnapshot(metrics);
  }

  recentFrames(limit?: number): readonly TFrameMetrics[] {
    return (this.#engine?.metrics.recentFrames(limit) ?? [])
      .map((metrics) => cloneFrameMetrics(metrics));
  }

  subscribe(listener: (event: TCanvasEngineAdapterEvent) => void): () => void {
    this.#listeners.add(listener);
    try {
      listener({
        type: "status",
        previous: this.#status,
        status: this.#status,
      });
    } catch {
      // Match subsequent event delivery: observers cannot break lifecycle.
    }
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      this.#listeners.delete(listener);
    };
  }

  start(): Promise<void> {
    if (this.#startPromise !== null) {
      return this.#startPromise;
    }
    if (this.#status === "destroying" || this.#status === "destroyed") {
      return Promise.reject(new CanvasEngineAdapterError(
        "DESTROYED",
        "CanvasEngineAdapter is destroyed.",
      ));
    }
    if (this.#status === "failed") {
      return Promise.reject(new CanvasEngineAdapterError(
        "FAILED",
        "CanvasEngineAdapter failed to start.",
        this.#terminalError,
      ));
    }

    this.#transition("starting");
    this.#startPromise = this.#start();
    return this.#startPromise;
  }

  resize(size?: TSize2): void {
    this.#requireEngine().resize(size);
  }

  suspend(): void {
    this.#requireEngine().suspend();
  }

  resume(): void {
    this.#requireEngine().resume();
  }

  render(options?: TRenderNowOptions): Promise<TRenderResult> {
    return this.#requireEngine().renderNow(options);
  }

  async applyScene(args: TCanvasSceneApplyArgs): Promise<TCanvasSceneApplyResult> {
    return this.#applyMutation({
      failureCode: "SCENE_REPLACE_FAILED",
      options: args,
      apply: (engine, transactionOptions) => {
        engine.scene.replace(args.snapshot, transactionOptions);
      },
    });
  }

  async applyCommands(
    args: TCanvasSceneCommandApplyArgs,
  ): Promise<TCanvasSceneApplyResult> {
    if (args.commands.some((command) => command.type === "replace-snapshot")) {
      throw new TypeError(
        "applyCommands accepts incremental commands only; use applyScene for snapshot replacement.",
      );
    }
    const commands = [...args.commands];
    return this.#applyMutation({
      failureCode: "SCENE_COMMANDS_FAILED",
      options: args,
      apply: (engine, transactionOptions) => {
        engine.scene.apply(commands, transactionOptions);
      },
    });
  }

  async #applyMutation(mutation: TSceneMutation): Promise<TCanvasSceneApplyResult> {
    const engine = this.#requireEngine();

    this.#errorDuringSceneApply = null;
    this.#sceneApplyActive = true;
    try {
      mutation.apply(engine, {
        source: mutation.options.source ?? "vibecanvas:projection",
        render: "none",
        ...(mutation.options.coalesceKey === undefined
          ? {}
          : { coalesceKey: mutation.options.coalesceKey }),
      });
    } catch (error) {
      this.#sceneApplyActive = false;
      const fatal = engineHasFailed(engine);
      this.#publishDiagnostic({
        severity: "error",
        source: "scene",
        code: errorCode(error, mutation.failureCode),
        message: errorMessage(error),
        recoverable: !fatal,
      });
      return {
        ok: false,
        revision: engine.scene.revision,
        error,
        fatal,
      };
    } finally {
      this.#sceneApplyActive = false;
    }

    const sceneApplyError = this.#errorDuringSceneApply as TCanvasEngineDiagnostic | null;
    if (sceneApplyError?.recoverable === false || engineHasFailed(engine)) {
      const error = new CanvasEngineAdapterError(
        "FAILED",
        sceneApplyError?.message ?? "The canvas engine failed while applying a scene.",
      );
      return {
        ok: false,
        revision: engine.scene.revision,
        error,
        fatal: true,
      };
    }

    try {
      if (mutation.options.render === "immediate") {
        await engine.renderNow();
      } else if (mutation.options.render !== "none") {
        engine.invalidate("vibecanvas:scene-apply");
      }
    } catch (error) {
      this.#publishDiagnostic({
        severity: "error",
        source: "engine",
        code: errorCode(error, "SCENE_RENDER_FAILED"),
        message: errorMessage(error),
        recoverable: !engineHasFailed(engine),
      });
      if (!engineHasFailed(engine)) {
        return {
          ok: true,
          revision: engine.scene.revision,
        };
      }
      return {
        ok: false,
        revision: engine.scene.revision,
        error,
        fatal: true,
      };
    }

    return {
      ok: true,
      revision: engine.scene.revision,
    };
  }

  destroy(): Promise<void> {
    if (this.#destroyPromise !== null) {
      return this.#destroyPromise;
    }
    this.#destroyRequested = true;
    this.#transition("destroying");
    this.#destroyPromise = (async () => {
      await this.#startPromise?.catch(() => undefined);
      await this.#disposeEngine();
      this.#removeFatalFallback();
      this.#transition("destroyed");
      this.#listeners.clear();
    })();
    return this.#destroyPromise;
  }

  async #start(): Promise<void> {
    try {
      const engine = await this.#createEngine(this.#createConfig());
      this.#engine = engine;
      if (this.#destroyRequested) {
        return;
      }

      const issues = fnCanvasEngineCapabilityIssues(engine.capabilities);
      if (issues.length > 0) {
        const message = issues
          .map((issue) => `${issue.capability}: expected ${issue.expected}, got ${issue.actual}`)
          .join("; ");
        throw new CanvasEngineAdapterError(
          "CAPABILITY_MISMATCH",
          `Canvas engine capability mismatch: ${message}`,
        );
      }

      this.#capabilities = engine.capabilities;
      this.#engineUnsubscribe = engine.subscribe((event) => {
        this.#handleEngineEvent(event);
      });
      this.#metricsUnsubscribe = engine.metrics.subscribe((metrics) => {
        this.#lastMetrics = engine.metrics.snapshot();
        this.#emit({ type: "metrics", metrics: cloneFrameMetrics(metrics) });
      });
      this.#portalOwnership = new PortalOwnership({ portals: engine.portals });
      this.#transientService = new CanvasTransientService({
        transients: engine.transients,
      });

      const initial = await this.applyScene({
        snapshot: fnCanvasEngineInitialScene(),
        source: "vibecanvas:initialize",
        render: "none",
      });
      if (!initial.ok) {
        throw new CanvasEngineAdapterError(
          "ENGINE_INITIALIZATION_FAILED",
          "Canvas engine could not install the initial scene.",
          initial.error,
        );
      }
      if (this.#destroyRequested) {
        return;
      }
      this.#removeFatalFallback();
      this.#transition(engine.status === "suspended" ? "suspended" : "ready");
    } catch (error) {
      this.#terminalError = error;
      if (!this.#destroyRequested) {
        const code = errorCode(error, "ENGINE_INITIALIZATION_FAILED");
        const diagnostic = this.#publishFatalDiagnostic({
          source: "adapter",
          code,
          message: errorMessage(error),
        });
        this.#showFatalFallback(diagnostic);
        this.#transition("failed");
      }
      await this.#disposeEngine();
      throw error;
    }
  }

  #createConfig(): TCanvasEngineConfig {
    const seam = this.#engineConfig;
    return {
      ...seam,
      host: this.#host,
      renderProfile: { ...REQUIRED_RENDER_PROFILE },
      accessibility: {
        ...seam.accessibility,
        enabled: true,
        exposeCanvasNodes: true,
      },
      diagnostics: {
        ...seam.diagnostics,
        enabled: true,
        collectFrameMetrics: true,
      },
    };
  }

  #handleEngineEvent(event: TEngineEvent): void {
    switch (event.type) {
      case "ready":
        this.#capabilities = event.capabilities;
        return;
      case "resize":
        this.#emit({
          type: "resize",
          cssSize: { ...event.cssSize },
          deviceSize: { ...event.deviceSize },
          devicePixelRatio: event.devicePixelRatio,
        });
        return;
      case "frame":
        this.#lastMetrics = this.#engine?.metrics.snapshot() ?? this.#lastMetrics;
        return;
      case "context-lost":
        this.#publishDiagnostic({
          severity: "warning",
          source: "engine",
          code: "CONTEXT_LOST",
          message: `Canvas backend '${event.backendId}' lost its render context.`,
          recoverable: true,
        });
        if (this.#status !== "failed") {
          this.#transition("context-lost");
        }
        this.#emit({ type: "context-lost", backendId: event.backendId });
        return;
      case "context-restored":
        if (this.#status !== "failed") {
          this.#transition(this.#engine?.status === "suspended" ? "suspended" : "ready");
        }
        this.#emit({ type: "context-restored", backendId: event.backendId });
        return;
      case "suspended":
        if (this.#status !== "failed") {
          this.#transition("suspended");
        }
        return;
      case "resumed":
        if (this.#status !== "failed") {
          this.#transition(this.#engine?.status === "context-lost"
            ? "context-lost"
            : "ready");
        }
        return;
      case "warning":
        this.#publishDiagnostic({
          severity: "warning",
          source: "engine",
          code: event.warning.code,
          message: event.warning.message,
          recoverable: true,
          ...(event.warning.nodeId === undefined
            ? {}
            : { nodeId: event.warning.nodeId }),
          ...(event.warning.resourceId === undefined
            ? {}
            : { resourceId: event.warning.resourceId }),
          ...(event.warning.details === undefined
            ? {}
            : { details: event.warning.details }),
        });
        return;
      case "error": {
        const diagnostic = this.#publishDiagnostic({
          severity: "error",
          source: "engine",
          code: event.error.code,
          message: event.error.message,
          recoverable: event.error.recoverable,
          ...(event.error.nodeId === undefined ? {} : { nodeId: event.error.nodeId }),
          ...(event.error.resourceId === undefined
            ? {}
            : { resourceId: event.error.resourceId }),
          ...(event.error.details === undefined ? {} : { details: event.error.details }),
        });
        if (this.#sceneApplyActive) {
          this.#errorDuringSceneApply = diagnostic;
        }
        if (!event.error.recoverable) {
          this.#terminalError = event.error;
          this.#showFatalFallback(diagnostic);
          this.#transition("failed");
        }
        return;
      }
      case "destroyed":
        return;
    }
  }

  #publishFatalDiagnostic(args: {
    source: TCanvasEngineDiagnostic["source"];
    code: string;
    message: string;
  }): TCanvasEngineDiagnostic {
    const diagnostic = this.#publishDiagnostic({
      severity: "error",
      source: args.source,
      code: args.code,
      message: args.message,
      recoverable: false,
    });
    this.#terminalError = new CanvasEngineAdapterError(
      "FAILED",
      args.message,
    );
    this.#showFatalFallback(diagnostic);
    this.#transition("failed");
    return diagnostic;
  }

  #publishDiagnostic(
    diagnostic: Omit<TCanvasEngineDiagnostic, "sequence">,
  ): TCanvasEngineDiagnostic {
    const retained: TCanvasEngineDiagnostic = {
      sequence: ++this.#diagnosticSequence,
      ...diagnostic,
    };
    this.#diagnostics.push(retained);
    if (this.#diagnostics.length > this.#diagnosticCapacity) {
      this.#diagnostics.splice(0, this.#diagnostics.length - this.#diagnosticCapacity);
    }
    try {
      this.#onDiagnostic?.(retained);
    } catch {
      // Diagnostics must never destabilize the renderer boundary.
    }
    this.#emit({ type: "diagnostic", diagnostic: retained });
    return retained;
  }

  async #disposeEngine(): Promise<void> {
    this.#metricsUnsubscribe?.();
    this.#metricsUnsubscribe = null;
    this.#engineUnsubscribe?.();
    this.#engineUnsubscribe = null;

    try {
      this.#transientService?.destroy();
    } catch (error) {
      this.#teardownDiagnostic("TRANSIENT_TEARDOWN_FAILED", error);
    }
    this.#transientService = null;

    try {
      await this.#portalOwnership?.destroy();
    } catch (error) {
      this.#teardownDiagnostic("PORTAL_TEARDOWN_FAILED", error);
    }
    this.#portalOwnership = null;

    const engine = this.#engine;
    if (engine !== null) {
      this.#lastMetrics = engine.metrics.snapshot();
      try {
        await engine.destroy();
      } catch (error) {
        this.#teardownDiagnostic("ENGINE_TEARDOWN_FAILED", error);
      }
    }
    this.#engine = null;
  }

  #teardownDiagnostic(code: string, error: unknown): void {
    this.#publishDiagnostic({
      severity: "error",
      source: "adapter",
      code,
      message: errorMessage(error),
      recoverable: false,
    });
  }

  #showFatalFallback(diagnostic: TCanvasEngineDiagnostic): void {
    if (this.#destroyRequested) {
      return;
    }
    if (this.#fallbackElement === null) {
      const element = this.#host.ownerDocument.createElement("div");
      element.dataset.vibecanvasEngineFallback = "true";
      element.setAttribute("role", "alert");
      element.setAttribute("aria-live", "assertive");
      element.style.position = "absolute";
      element.style.inset = "0";
      element.style.display = "grid";
      element.style.placeItems = "center";
      element.style.padding = "24px";
      element.style.background = "rgba(20, 20, 24, 0.92)";
      element.style.color = "#fff";
      element.style.zIndex = "2147483647";
      element.style.whiteSpace = "pre-wrap";
      element.style.textAlign = "center";
      this.#fallbackElement = element;
      if (this.#host.style.position === "") {
        this.#fallbackPreviousPosition = "";
        this.#host.style.position = "relative";
      }
      this.#host.append(element);
    }
    this.#fallbackElement.textContent = [
      "Canvas unavailable",
      `${diagnostic.code}: ${diagnostic.message}`,
    ].join("\n");
  }

  #removeFatalFallback(): void {
    this.#fallbackElement?.remove();
    this.#fallbackElement = null;
    if (
      this.#fallbackPreviousPosition !== null
      && this.#host.style.position === "relative"
    ) {
      this.#host.style.position = this.#fallbackPreviousPosition;
    }
    this.#fallbackPreviousPosition = null;
  }

  #transition(status: TCanvasEngineAdapterStatus): void {
    if (this.#status === status) {
      return;
    }
    const previous = this.#status;
    this.#status = status;
    this.#emit({ type: "status", previous, status });
  }

  #emit(event: TCanvasEngineAdapterEvent): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch {
        // A product observer cannot interrupt engine lifecycle or teardown.
      }
    }
  }

  #requireEngine(): IInfiniteCanvasEngine {
    if (this.#engine !== null && this.#status !== "failed") {
      return this.#engine;
    }
    throw this.#unavailableError();
  }

  #unavailableError(): CanvasEngineAdapterError {
    if (this.#status === "destroying" || this.#status === "destroyed") {
      return new CanvasEngineAdapterError(
        "DESTROYED",
        "CanvasEngineAdapter is destroyed.",
      );
    }
    if (this.#status === "failed") {
      return new CanvasEngineAdapterError(
        "FAILED",
        "CanvasEngineAdapter has failed.",
        this.#terminalError,
      );
    }
    return new CanvasEngineAdapterError(
      "NOT_STARTED",
      "CanvasEngineAdapter has not started.",
    );
  }
}
