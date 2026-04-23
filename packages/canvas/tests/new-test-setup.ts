import Konva from "konva";
import type { DocHandle } from "@automerge/automerge-repo";
import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ThemeService } from "@vibecanvas/service-theme";
import { buildRuntime } from "../src/runtime";
import { createMockDocHandle, createTestContainer, ensureDom, ensureRangeGeometryMocks, ensureResizeObserver, flushCanvasEffects } from "./test-setup";

export type TNewCanvasHarness = {
  runtime: ReturnType<typeof buildRuntime>;
  docHandle: DocHandle<TCanvasDoc>;
  stage: Konva.Stage;
  staticBackgroundLayer: Konva.Layer;
  staticForegroundLayer: Konva.Layer;
  dynamicLayer: Konva.Layer;
  destroy: () => Promise<void>;
};

export async function createNewCanvasHarness(args?: {
  canvasId?: string;
  docHandle?: DocHandle<TCanvasDoc>;
  width?: number;
  height?: number;
  image?: {
    uploadImage: ({ base64, format }: { base64: string; format: string }) => Promise<{ url: string | null }>;
    cloneImage: ({ url }: { url: string }) => Promise<{ url: string | null }>;
    deleteImage: ({ url }: { url: string }) => Promise<{ ok: true }>;
  };
  notification?: {
    showSuccess(title: string, description?: string): void;
    showError(title: string, description?: string): void;
    showInfo(title: string, description?: string): void;
  };
}) {
  ensureDom();
  ensureResizeObserver();
  ensureRangeGeometryMocks();

  const container = createTestContainer({ width: args?.width, height: args?.height }) as HTMLDivElement;
  const docHandle = args?.docHandle ?? createMockDocHandle();
  const runtime = buildRuntime({
    canvasId: args?.canvasId ?? "test-canvas",
    container,
    docHandle,
    onToggleSidebar: () => {},
    env: { DEV: true },
    themeService: new ThemeService(),
    image: args?.image,
    notification: args?.notification,
  });

  await runtime.boot();
  await flushCanvasEffects();

  const render = runtime.services.require("scene");

  return {
    runtime,
    docHandle,
    stage: render.stage,
    staticBackgroundLayer: render.staticBackgroundLayer,
    staticForegroundLayer: render.staticForegroundLayer,
    dynamicLayer: render.dynamicLayer,
    destroy: async () => {
      await runtime.shutdown();
      container.remove();
    },
  } satisfies TNewCanvasHarness;
}

export { createMockDocHandle, flushCanvasEffects };
