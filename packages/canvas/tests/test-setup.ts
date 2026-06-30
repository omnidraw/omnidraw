import Konva from "konva";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { JSDOM } from "jsdom";
import type { DocHandle } from "@automerge/automerge-repo";
import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { createRoot } from "solid-js";
import { vi } from "vitest";
import type { IPlugin, IPluginContext, IServiceMap } from "@vibecanvas/runtime";

type TLegacyCanvasService = {
  initialized: Promise<void>;
  destroy(): void;
};

type TCanvasTestHarness = {
  service: TLegacyCanvasService;
  stage: Konva.Stage;
  staticBackgroundLayer: Konva.Layer;
  staticForegroundLayer: Konva.Layer;
  dynamicLayer: Konva.Layer;
  destroy: () => void;
};

export function ensureDom() {
  if (typeof document !== "undefined" && typeof window !== "undefined") {
    return;
  }

  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  vi.stubGlobal?.("window", dom.window);
  vi.stubGlobal?.("document", dom.window.document);
  vi.stubGlobal?.("navigator", dom.window.navigator);
  vi.stubGlobal?.("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal?.("HTMLInputElement", dom.window.HTMLInputElement);
  vi.stubGlobal?.("HTMLTextAreaElement", dom.window.HTMLTextAreaElement);
  vi.stubGlobal?.("MouseEvent", dom.window.MouseEvent);
  vi.stubGlobal?.("KeyboardEvent", dom.window.KeyboardEvent);
  vi.stubGlobal?.("Event", dom.window.Event);
  vi.stubGlobal?.("Range", dom.window.Range);
  vi.stubGlobal?.("DOMRect", dom.window.DOMRect);

  if (typeof window === "undefined") {
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      navigator: dom.window.navigator,
      HTMLElement: dom.window.HTMLElement,
      HTMLInputElement: dom.window.HTMLInputElement,
      HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
      MouseEvent: dom.window.MouseEvent,
      KeyboardEvent: dom.window.KeyboardEvent,
      Event: dom.window.Event,
      Range: dom.window.Range,
      DOMRect: dom.window.DOMRect,
    });
  }
}

export function ensureResizeObserver() {
  if (typeof ResizeObserver !== "undefined") {
    return;
  }

  class MockResizeObserver {
    observe() { }
    disconnect() { }
  }

  vi.stubGlobal?.("ResizeObserver", MockResizeObserver);
  if (typeof ResizeObserver === "undefined") {
    Object.assign(globalThis, { ResizeObserver: MockResizeObserver });
  }
}

function createEmptyDomRect(): DOMRect {
  return {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON() {
      return {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      };
    },
  } as DOMRect;
}

function createEmptyDomRectList(): DOMRectList {
  const rects = [] as unknown as DOMRectList;
  rects.item = () => null;
  return rects;
}

export function ensureRangeGeometryMocks() {
  if (typeof Range === "undefined") return;

  if (typeof Range.prototype.getBoundingClientRect !== "function") {
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => createEmptyDomRect(),
    });
  }

  if (typeof Range.prototype.getClientRects !== "function") {
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => createEmptyDomRectList(),
    });
  }
}

export function createMockDocHandle(overrides?: Partial<TCanvasDoc>): DocHandle<TCanvasDoc> {
  const docState: TCanvasDoc = {
    id: "test-doc",
    name: "test-doc",
    elements: {},
    groups: {},
    ...overrides,
  };
  const changeListeners = new Set<(payload: { handle: DocHandle<TCanvasDoc>; doc: TCanvasDoc; patches: unknown[]; patchInfo: unknown }) => void>();

  const emitChange = () => {
    const payload = {
      handle: docHandle as DocHandle<TCanvasDoc>,
      doc: docState,
      patches: [],
      patchInfo: { before: null, after: null, source: "change" },
    };
    changeListeners.forEach((listener) => listener(payload));
  };

  const docHandle = {
    doc: () => docState,
    change: (callback: (doc: TCanvasDoc) => void) => {
      callback(docState);
    },
    on: (event: string, callback: (payload: { handle: DocHandle<TCanvasDoc>; doc: TCanvasDoc; patches: unknown[]; patchInfo: unknown }) => void) => {
      if (event === "change") changeListeners.add(callback);
      return docHandle;
    },
    off: (event: string, callback: (payload: { handle: DocHandle<TCanvasDoc>; doc: TCanvasDoc; patches: unknown[]; patchInfo: unknown }) => void) => {
      if (event === "change") changeListeners.delete(callback);
      return docHandle;
    },
    __emitChange: emitChange,
  };

  return docHandle as unknown as DocHandle<TCanvasDoc>;
}

export function createTestContainer(args?: { width?: number; height?: number }) {
  const width = args?.width ?? 800;
  const height = args?.height ?? 600;
  const container = document.createElement("div");

  Object.defineProperty(container, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(container, "clientHeight", { configurable: true, value: height });

  document.body.appendChild(container);

  return container;
}

type TLegacyAppCapabilities = {
  uploadImage?: unknown;
  cloneImage?: unknown;
  deleteImage?: unknown;
  notification?: unknown;
  terminal?: unknown;
  filetree?: unknown;
  file?: unknown;
};

export async function createCanvasTestHarness(args: {
  plugins: IPlugin[];
  initializeScene?: (context: IPluginContext<IServiceMap, object, object>) => void;
  docHandle?: DocHandle<TCanvasDoc>;
  width?: number;
  height?: number;
  appCapabilities?: TLegacyAppCapabilities;
}): Promise<TCanvasTestHarness> {
  ensureDom();
  ensureResizeObserver();
  ensureRangeGeometryMocks();

  const container = createTestContainer({ width: args.width, height: args.height });
  const docHandle = args.docHandle ?? createMockDocHandle();

  let disposeRoot: (() => void) | undefined;
  let service: TLegacyCanvasService | undefined;

  createRoot((dispose) => {
    disposeRoot = dispose;
  });

  const legacyCanvasServicePath = "../src/services/canvas/Canvas.service";
  const legacyModule = await import(/* @vite-ignore */ legacyCanvasServicePath).catch(() => null) as null | {
    CanvasService: new (
      container: HTMLDivElement,
      docHandle: DocHandle<TCanvasDoc>,
      plugins: IPlugin[],
      appCapabilities?: TLegacyAppCapabilities,
    ) => TLegacyCanvasService;
  };

  if (!legacyModule) {
    throw new Error("Legacy CanvasService is not available in this rewrite-aware test harness");
  }

  service = new legacyModule.CanvasService(
    container,
    docHandle,
    [
      ...args.plugins,
      {
        name: "test-initialize-scene",
        apply(context) {
          args.initializeScene?.(context as IPluginContext<IServiceMap, object, object>);
        },
      },
    ],
    args.appCapabilities,
  );

  await service.initialized;

  const stage = (window as typeof window & { stage?: Konva.Stage }).stage ?? null;
  if (!stage) {
    throw new Error("CanvasService did not expose stage on window");
  }

  const [staticBackgroundLayer, staticForegroundLayer, dynamicLayer] = stage.getLayers();

  if (!staticBackgroundLayer || !staticForegroundLayer || !dynamicLayer) {
    throw new Error("CanvasService did not initialize expected layers");
  }

  return {
    service: service!,
    stage,
    staticBackgroundLayer,
    staticForegroundLayer,
    dynamicLayer,
    destroy: () => {
      service?.destroy();
      disposeRoot?.();
      container.remove();
    },
  };
}

export async function flushCanvasEffects() {
  await Promise.resolve();
  if (vi.isFakeTimers()) {
    vi.runAllTimers();
  }
  await Promise.resolve();
}

export function createStagePointerEvent(stage: Konva.Stage, args?: { x?: number; y?: number; type?: string }) {
  const evt = new MouseEvent(args?.type ?? "pointermove", {
    bubbles: true,
    clientX: args?.x ?? stage.width() / 2,
    clientY: args?.y ?? stage.height() / 2,
  });

  stage.setPointersPositions(evt);
  return evt;
}

export async function exportStageSnapshot(args: {
  stage: Konva.Stage;
  label: string;
  relativeFilePath: string;
  pixelRatio?: number;
  waitMs?: number;
}) {
  const backgroundLayer = new Konva.Layer({ listening: false });
  const labelLayer = new Konva.Layer({ listening: false });
  const stageWidth = args.stage.width();
  const stageHeight = args.stage.height();

  const background = new Konva.Rect({
    x: 0,
    y: 0,
    width: stageWidth,
    height: stageHeight,
    fill: "#ffffff",
  });

  backgroundLayer.add(background);

  for (let x = 0; x <= stageWidth; x += 50) {
    backgroundLayer.add(new Konva.Line({
      points: [x, 0, x, stageHeight],
      stroke: x % 100 === 0 ? "#d1d5db" : "#e5e7eb",
      strokeWidth: x % 100 === 0 ? 1.5 : 1,
    }));
  }

  for (let y = 0; y <= stageHeight; y += 50) {
    backgroundLayer.add(new Konva.Line({
      points: [0, y, stageWidth, y],
      stroke: y % 100 === 0 ? "#d1d5db" : "#e5e7eb",
      strokeWidth: y % 100 === 0 ? 1.5 : 1,
    }));
  }

  backgroundLayer.add(new Konva.Line({
    points: [0, stageHeight / 2, stageWidth, stageHeight / 2],
    stroke: "#94a3b8",
    strokeWidth: 2,
  }));
  backgroundLayer.add(new Konva.Line({
    points: [stageWidth / 2, 0, stageWidth / 2, stageHeight],
    stroke: "#94a3b8",
    strokeWidth: 2,
  }));

  for (let x = 0; x <= stageWidth; x += 100) {
    backgroundLayer.add(new Konva.Text({
      x: x + 4,
      y: stageHeight - 22,
      text: String(x),
      fontSize: 12,
      fontFamily: "monospace",
      fill: "#475569",
    }));
  }

  for (let y = 0; y <= stageHeight; y += 100) {
    backgroundLayer.add(new Konva.Text({
      x: 4,
      y: y + 4,
      text: String(y),
      fontSize: 12,
      fontFamily: "monospace",
      fill: "#475569",
    }));
  }

  const labelBackground = new Konva.Rect({
    x: 12,
    y: 12,
    width: 520,
    height: 48,
    fill: "rgba(255,255,255,0.9)",
    stroke: "#111111",
    strokeWidth: 1,
  });
  const labelText = new Konva.Text({
    x: 20,
    y: 22,
    text: args.label,
    fontSize: 20,
    fontFamily: "monospace",
    fill: "#111111",
  });

  labelLayer.add(labelBackground);
  labelLayer.add(labelText);
  args.stage.add(backgroundLayer);
  args.stage.add(labelLayer);
  backgroundLayer.moveToBottom();
  labelLayer.moveToTop();
  args.stage.draw();

  if ((args.waitMs ?? 0) > 0) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, args.waitMs));
    args.stage.draw();
  }

  const dataUrl = args.stage.toDataURL({
    pixelRatio: args.pixelRatio ?? 2,
  });

  backgroundLayer.destroy();
  labelLayer.destroy();
  args.stage.draw();

  const filePath = resolve(process.cwd(), args.relativeFilePath);
  await mkdir(dirname(filePath), { recursive: true });
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  await writeFile(filePath, Buffer.from(base64, "base64"));

  return filePath;
}
