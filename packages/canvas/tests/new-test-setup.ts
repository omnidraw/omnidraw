import type { DocHandle } from "@automerge/automerge-repo";
import {
  createInfiniteCanvas,
  type TEngineMetricSnapshot,
} from "@omnidraw/cangine";
import { ManualClock } from "@omnidraw/cangine/testing";
import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ThemeService } from "@vibecanvas/service-theme";
import { LOCAL_BROWSER_TENANT_SCOPE } from "../src/CONSTANTS";
import type { ICanvasRuntimeExtension } from "../src/extension";
import { buildRuntime } from "../src/runtime";
import { SceneService } from "../src/services/scene/SceneService";
import {
  createMockDocHandle,
  createTestContainer,
  ensureDom,
  ensureRangeGeometryMocks,
  ensureResizeObserver,
  flushCanvasEffects,
} from "./test-setup";
import { CanvasEngineTestFactory } from "./engine/engine-test-backend";

export type TNewCanvasHarness = {
  runtime: ReturnType<typeof buildRuntime>;
  docHandle: DocHandle<TCanvasDoc>;
  container: HTMLDivElement;
  clock: ManualClock;
  scene: SceneService;
  metrics(): TEngineMetricSnapshot;
  flush(): Promise<void>;
  destroy(): Promise<void>;
};

async function drainClock(clock: ManualClock): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    await Promise.resolve();
    if (clock.pendingFrameCount > 0) {
      clock.advance(16);
    }
  }
}

export async function createNewCanvasHarness(args?: {
  canvasId?: string;
  docHandle?: DocHandle<TCanvasDoc>;
  width?: number;
  height?: number;
  extensions?: readonly ICanvasRuntimeExtension[];
  image?: {
    uploadImage(body: {
      data: Uint8Array;
      mime_type: string;
    }): Promise<{ url: string | null }>;
    cloneImage(body: { url: string }): Promise<{ url: string | null }>;
    deleteImage(body: { url: string }): Promise<{ ok: true }>;
  };
  notification?: {
    showSuccess(title: string, description?: string): void;
    showError(title: string, description?: string): void;
    showInfo(title: string, description?: string): void;
  };
}): Promise<TNewCanvasHarness> {
  ensureDom();
  ensureResizeObserver();
  ensureRangeGeometryMocks();

  const container = createTestContainer({
    width: args?.width,
    height: args?.height,
  });
  const docHandle = args?.docHandle ?? createMockDocHandle();
  const clock = new ManualClock();
  const backend = new CanvasEngineTestFactory();
  const runtime = buildRuntime({
    canvasId: args?.canvasId ?? "test-canvas",
    tenant: LOCAL_BROWSER_TENANT_SCOPE,
    container,
    docHandle,
    onToggleSidebar: () => undefined,
    env: { DEV: true },
    themeService: new ThemeService(),
    image: {
      uploadImage: async (body) => {
        const result = await args?.image?.uploadImage(body)
          ?? { url: "memory://uploaded-image" };
        if (!result.url) {
          throw new Error("Image upload returned no URL");
        }
        return { url: result.url };
      },
      cloneImage: async (body) => {
        const result = await args?.image?.cloneImage(body)
          ?? { url: "memory://cloned-image" };
        if (!result.url) {
          throw new Error("Image clone returned no URL");
        }
        return { url: result.url };
      },
      deleteImage: async (body) => {
        return args?.image?.deleteImage(body) ?? { ok: true };
      },
    },
    notification: args?.notification,
  }, args?.extensions, {
    createScene: (sceneArgs) => new SceneService({
      ...sceneArgs,
      createEngine: (config) => createInfiniteCanvas(config),
      engineConfig: {
        backendFactories: [backend],
        clock,
      },
    }),
  });

  const boot = runtime.boot();
  await drainClock(clock);
  await boot;
  await flushCanvasEffects();
  await drainClock(clock);
  const scene = runtime.services.require("scene");

  return {
    runtime,
    docHandle,
    container,
    clock,
    scene,
    metrics: () => scene.metricsSnapshot(),
    flush: async () => {
      await flushCanvasEffects();
      await drainClock(clock);
    },
    destroy: async () => {
      await runtime.shutdown();
      container.remove();
    },
  };
}

export { createMockDocHandle, flushCanvasEffects };
