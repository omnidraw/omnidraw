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
  const apiService = {
    api: {
      file: {
        put: async ({ body }: { body: { base64: string; format: string } }) => {
          const result = await args?.image?.uploadImage(body) ?? { url: null };
          return [null, result] as const;
        },
        clone: async ({ body }: { body: { url: string } }) => {
          const result = await args?.image?.cloneImage(body) ?? { url: null };
          return [null, result] as const;
        },
        remove: async ({ body }: { body: { url: string } }) => {
          const result = await args?.image?.deleteImage(body) ?? { ok: true as const };
          return [null, result] as const;
        },
      },
      actors: {
        revisions: {
          list: async () => [null, []] as const,
          register: async () => [null, {
            definition: {
              id: "actor-definition-1",
              name: "Todo",
              slug: "todo",
              description: null,
              created_by_system_id: "system",
              created_at: new Date(0),
            },
            revision: {
              id: "actor-revision-1",
              actor_definition_id: "actor-definition-1",
              version: 1,
              machine_schema: {},
              machine_config: {},
              contract_schema: {},
              output_schema: {},
              server_manifest: {},
              ui_manifest: {},
              server_bundle_file_id: null,
              ui_bundle_file_id: null,
              source_archive_file_id: null,
              created_by_system_id: "system",
              created_at: new Date(0),
            },
          }] as const,
          get: async () => [null, null] as const,
        },
        instances: {
          list: async () => [null, []] as const,
          get: async () => [null, null] as const,
          create: async () => [null, null] as const,
          remove: async () => [null, null] as const,
        },
        connections: {
          list: async () => [null, []] as const,
          create: async () => [null, null] as const,
          update: async () => [null, null] as const,
          remove: async () => [null, null] as const,
        },
        messages: {
          send: async () => [null, null] as const,
        },
        outputs: {
          list: async () => [null, []] as const,
        },
        events: async () => [null, (async function* () {
          yield {
            type: "actor.snapshot" as const,
            canvasId: args?.canvasId ?? "test-canvas",
            instances: [],
            connections: [],
          };
        })()] as const,
      },
    },
  };

  const runtime = buildRuntime({
    canvasId: args?.canvasId ?? "test-canvas",
    container,
    docHandle,
    onToggleSidebar: () => {},
    env: { DEV: true },
    themeService: new ThemeService(),
    apiService: apiService as never,
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
