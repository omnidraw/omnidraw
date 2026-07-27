import type {
  IInfiniteCanvasEngine,
  ISceneStore,
  TCanvasEngineConfig,
  TEngineCapabilities,
  TSceneNode,
} from "@omnidraw/cangine";
import { CanvasEngineError } from "@omnidraw/cangine";
import type {
  IRenderBackendFactory,
  IRenderPassBackend,
  TBackendEffectiveSceneChange,
  TBackendInitContext,
  TBackendRenderResult,
  TBackendResizeContext,
  TRenderFrameContext,
} from "@omnidraw/cangine/backend";

export class CanvasEngineTestPass implements IRenderPassBackend {
  readonly id = "vibecanvas-engine-boundary-test";
  readonly kind = "vector-2d" as const;
  readonly order = 100;
  readonly changes: TBackendEffectiveSceneChange[] = [];
  readonly resizes: TBackendResizeContext[] = [];
  readonly unsupportedNodeKinds: TSceneNode["kind"][];
  context: TBackendInitContext | null = null;
  renderCount = 0;
  destroyCount = 0;
  contextRestoreCount = 0;
  failNextSceneApply = false;
  failContextRestore = false;

  constructor(args?: { unsupportedNodeKinds?: TSceneNode["kind"][] }) {
    this.unsupportedNodeKinds = [...(args?.unsupportedNodeKinds ?? [])];
  }

  initialize(context: TBackendInitContext): void {
    this.context = context;
  }

  capabilities(): Partial<TEngineCapabilities> {
    return {
      supportsGpuPicking: false,
      supportsSvgExport: true,
      unsupportedNodeKinds: this.unsupportedNodeKinds,
    };
  }

  resize(context: TBackendResizeContext): void {
    this.resizes.push(context);
  }

  applySceneChanges(
    change: TBackendEffectiveSceneChange,
    _scene: ISceneStore,
  ): void {
    if (this.failNextSceneApply) {
      this.failNextSceneApply = false;
      throw new CanvasEngineError(
        "INTERNAL",
        "intentional retained backend failure",
        { recoverable: false },
      );
    }
    this.changes.push(change);
  }

  prepareFrame(_context: TRenderFrameContext): void {}

  render(_context: TRenderFrameContext): TBackendRenderResult {
    this.renderCount += 1;
    return {
      drawCalls: 1,
      renderedNodeCount: 1,
      culledNodeCount: 0,
      missingResources: [],
    };
  }

  contextRestored(): void {
    this.contextRestoreCount += 1;
    if (this.failContextRestore) {
      throw new Error("intentional context restore failure");
    }
  }

  destroy(): void {
    this.destroyCount += 1;
  }

  reportContextLost(): void {
    if (this.context === null) {
      throw new Error("Test backend has not initialized.");
    }
    this.context.lifecycle.reportContextLost();
  }

  requestContextRestore(): void {
    if (this.context === null) {
      throw new Error("Test backend has not initialized.");
    }
    this.context.lifecycle.requestContextRestore();
  }
}

export class CanvasEngineTestFactory implements IRenderBackendFactory {
  readonly id = "webgl2";
  readonly pass: CanvasEngineTestPass;
  readonly configs: TCanvasEngineConfig[] = [];

  constructor(args?: { unsupportedNodeKinds?: TSceneNode["kind"][] }) {
    this.pass = new CanvasEngineTestPass(args);
  }

  supports(config: TCanvasEngineConfig): boolean {
    return config.renderProfile.vector2D === "webgl2";
  }

  create(config: TCanvasEngineConfig): IRenderPassBackend[] {
    this.configs.push(config);
    return [this.pass];
  }
}

export type TCreateEngineProbe = {
  configs: TCanvasEngineConfig[];
  create(config: TCanvasEngineConfig): Promise<IInfiniteCanvasEngine>;
};
