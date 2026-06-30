import Konva from "konva";
import { AsyncParallelHook, SyncExitHook, SyncHook } from "@vibecanvas/tapable";
import { describe, expect, test, vi } from "vitest";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ELEMENT_DATA_ATTR } from "../../../src/core/CONSTANTS";
import { createImagePlugin } from "../../../src/plugins/image/Image.plugin";
import { CrdtService } from "../../../src/services/crdt/CrdtService";
import { ElementService } from "../../../src/services/element/ElementService";
import { SceneService } from "../../../src/services/scene/SceneService";
import { createMockDocHandle, createNewCanvasHarness, flushCanvasEffects } from "../../new-test-setup";
import { createTestContainer, ensureDom, ensureRangeGeometryMocks, ensureResizeObserver } from "../../test-setup";

function createImageElement(overrides?: Partial<TElement>): TElement {
  return {
    id: "image-1",
    x: 120,
    y: 80,
    rotation: 0,
    bindings: [],
    createdAt: 1,
    updatedAt: 2,
    locked: false,
    parentGroupId: null,
    zIndex: "z0001",
    style: { opacity: 0.7 },
    data: {
      type: "image",
      url: "https://cdn.test/image.png",
      base64: null,
      w: 320,
      h: 180,
      crop: {
        x: 0,
        y: 0,
        width: 320,
        height: 180,
        naturalWidth: 640,
        naturalHeight: 360,
      },
    },
    ...overrides,
  } as TElement;
}

function createImageTestHooks() {
  return {
    init: new SyncHook(),
    initAsync: new AsyncParallelHook(),
    destroy: new SyncHook(),
    pointerDown: new SyncHook(),
    pointerUp: new SyncHook(),
    pointerOut: new SyncHook(),
    pointerOver: new SyncHook(),
    pointerMove: new SyncHook(),
    pointerWheel: new SyncHook(),
    pointerCancel: new SyncHook(),
    keydown: new SyncHook(),
    keyup: new SyncHook(),
    gridVisible: new SyncHook(),
    toolSelect: new SyncHook(),
    elementPointerClick: new SyncExitHook(),
    elementPointerDown: new SyncExitHook(),
    elementPointerDoubleClick: new SyncExitHook(),
  };
}

function createImagePluginUnitHarness(args?: {
  uploadImage?: ReturnType<typeof vi.fn>;
}) {
  ensureDom();
  ensureResizeObserver();
  ensureRangeGeometryMocks();

  const container = createTestContainer() as HTMLDivElement;
  const scene = new SceneService({ container });
  scene.start();

  const hooks = createImageTestHooks();
  const crdt = new CrdtService({ docHandle: createMockDocHandle() });
  const element = new ElementService();
  const servicesByName = new Map<string, unknown>([
    ["contextMenu", { registerProvider: vi.fn(), unregisterProvider: vi.fn() }],
    ["crdt", crdt],
    ["element", element],
    ["group", {}],
    ["history", { record: vi.fn() }],
    ["scene", scene],
    ["renderOrder", {
      assignOrderOnInsert: vi.fn(),
      setNodeZIndex: vi.fn(),
      sortChildren: vi.fn(),
    }],
    ["selection", {
      mode: "select",
      selection: [],
      setSelection: vi.fn(),
      setFocusedNode: vi.fn(),
      clear: vi.fn(),
    }],
    ["session", { editingId: null }],
    ["tool", { registerTool: vi.fn(), unregisterTool: vi.fn() }],
  ]);

  const uploadImage = args?.uploadImage ?? vi.fn(async () => [null, { url: "https://cdn.test/uploaded.png" }] as const);
  const plugin = createImagePlugin();
  void plugin.apply({
    hooks,
    services: {
      get: (name: string) => servicesByName.get(name),
      require: (name: string) => {
        const service = servicesByName.get(name);
        if (!service) throw new Error(`Missing service ${name}`);
        return service;
      },
      getStore: () => servicesByName,
      getRegistrations: () => [],
      provide: () => undefined,
    },
    config: {
      apiService: {
        api: {
          file: {
            put: uploadImage,
            clone: vi.fn(),
          },
        },
      },
      notification: { showError: vi.fn(), showInfo: vi.fn(), showSuccess: vi.fn() },
    },
  } as never);

  return {
    hooks,
    scene,
    element,
    uploadImage,
    destroy: () => {
      hooks.destroy.call();
      scene.stop();
      container.remove();
    },
  };
}

async function waitForMicrotasks(count = 12) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

async function waitForAsyncImageInsert() {
  await waitForMicrotasks();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await waitForMicrotasks();
}

describe("Image plugin", () => {
  test("registers the image tool and hydrates persisted image elements", async () => {
    const imageElement = createImageElement();
    const harness = await createNewCanvasHarness({
      docHandle: createMockDocHandle({
        elements: {
          [imageElement.id]: imageElement,
        },
      }),
      image: {
        uploadImage: async () => ({ url: "https://cdn.test/uploaded.png" }),
        cloneImage: async ({ url }) => ({ url: `${url}?clone=1` }),
        deleteImage: async () => ({ ok: true }),
      },
    });

    const tool = harness.runtime.services.require("tool");
    const element = harness.runtime.services.require("element");

    expect(tool.getTool("image")?.id).toBe("image");
    expect(element.getSelectionStyleMenuConfigById({ id: "image" })).toBeNull();

    await flushCanvasEffects();

    const node = harness.staticForegroundLayer.findOne((candidate: Konva.Node) => {
      return candidate instanceof Konva.Image && candidate.id() === imageElement.id;
    });

    expect(node).toBeInstanceOf(Konva.Image);
    expect(element.toElement(node as Konva.Image)?.data.type).toBe("image");

    await harness.destroy();
  });

  test("created image nodes include element metadata required by delete", () => {
    const harness = createImagePluginUnitHarness();
    try {
      const imageElement = createImageElement();
      const node = harness.element.createNodeFromElement(imageElement);
      const builder = {} as { deleteElement: ReturnType<typeof vi.fn> };
      builder.deleteElement = vi.fn(() => builder);

      expect(node).toBeInstanceOf(Konva.Image);
      expect((node as Konva.Image).getAttr(ELEMENT_DATA_ATTR)).toMatchObject({ type: "image" });
      expect(() => harness.element.removeElement(node, builder as never)).not.toThrow();
      expect(builder.deleteElement).toHaveBeenCalledWith(imageElement.id, expect.any(Object));
    } finally {
      harness.destroy();
    }
  });

  test("paste from document inserts an image even when the stage container is not focused", async () => {
    const originalFileReader = globalThis.FileReader;
    const originalWindowFileReader = window.FileReader;
    const originalWindowImage = window.Image;
    const uploadImage = vi.fn(async () => [null, { url: "https://cdn.test/pasted.png" }] as const);

    class MockFileReader {
      result: string | ArrayBuffer | null = null;
      error: Error | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      readAsDataURL() {
        this.result = "data:image/png;base64,ZmFrZQ==";
        queueMicrotask(() => this.onload?.());
      }

      readAsArrayBuffer() {
        this.result = new Uint8Array([1, 2, 3]).buffer;
        queueMicrotask(() => this.onload?.());
      }
    }

    class MockImage {
      constructor() {
        const canvas = document.createElement("canvas");
        canvas.width = 100;
        canvas.height = 50;
        Object.defineProperty(canvas, "src", {
          configurable: true,
          set() {
            queueMicrotask(() => canvas.onload?.(new Event("load")));
          },
        });
        return canvas;
      }
    }

    vi.stubGlobal("FileReader", MockFileReader);
    Object.defineProperty(window, "FileReader", { configurable: true, value: MockFileReader });
    Object.defineProperty(window, "Image", { configurable: true, value: MockImage });

    const harness = createImagePluginUnitHarness({ uploadImage });
    try {
      harness.hooks.init.call();

      const pasteEvent = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(pasteEvent, "clipboardData", {
        configurable: true,
        value: {
          files: [new File(["fake"], "pasted.png", { type: "image/png" })],
          items: [],
        },
      });

      document.dispatchEvent(pasteEvent);
      await waitForAsyncImageInsert();

      expect(uploadImage).toHaveBeenCalledOnce();
      expect(harness.scene.staticForegroundLayer.getChildren((node) => node instanceof Konva.Image)).toHaveLength(1);
    } finally {
      harness.destroy();
      vi.stubGlobal("FileReader", originalFileReader);
      Object.defineProperty(window, "FileReader", { configurable: true, value: originalWindowFileReader });
      Object.defineProperty(window, "Image", { configurable: true, value: originalWindowImage });
    }
  });
});
