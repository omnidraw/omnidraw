import type { DocHandle } from "@automerge/automerge-repo";
import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { JSDOM } from "jsdom";
import { vi } from "vitest";

export function ensureDom(): void {
  if (typeof document === "undefined" || typeof window === "undefined") {
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
  }
  const CanvasElement = document.createElement("canvas")
    .constructor as typeof HTMLCanvasElement;
  Object.defineProperty(CanvasElement.prototype, "getContext", {
    configurable: true,
    value: (kind: string) => kind === "2d"
      ? {
          direction: "ltr",
          font: "",
          beginPath() {},
          bezierCurveTo() {},
          clearRect() {},
          clip() {},
          closePath() {},
          createLinearGradient: () => ({ addColorStop() {} }),
          createPattern: () => null,
          createRadialGradient: () => ({ addColorStop() {} }),
          drawImage() {},
          fill() {},
          fillRect() {},
          fillText() {},
          getImageData: () => ({ data: new Uint8ClampedArray() }),
          lineTo() {},
          save() {},
          restore() {},
          moveTo() {},
          putImageData() {},
          quadraticCurveTo() {},
          rect() {},
          scale() {},
          setLineDash() {},
          setTransform() {},
          stroke() {},
          strokeText() {},
          translate() {},
          measureText(text: string) {
            return {
              width: text.length * 8,
              actualBoundingBoxAscent: 10,
              actualBoundingBoxDescent: 3,
            };
          },
        }
      : null,
  });
  Object.defineProperty(CanvasElement.prototype, "toDataURL", {
    configurable: true,
    value: () => "data:image/png;base64,AA==",
  });
}

export function ensureResizeObserver(): void {
  if (typeof ResizeObserver !== "undefined") {
    return;
  }

  class MockResizeObserver {
    observe(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal?.("ResizeObserver", MockResizeObserver);
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

export function ensureRangeGeometryMocks(): void {
  ensureDom();
  if (typeof Range === "undefined") {
    return;
  }
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

export function createMockDocHandle(
  overrides?: Partial<TCanvasDoc>,
): DocHandle<TCanvasDoc> {
  const docState: TCanvasDoc = {
    id: "test-doc",
    name: "test-doc",
    elements: {},
    groups: {},
    ...overrides,
  };
  type TChangePayload = {
    handle: DocHandle<TCanvasDoc>;
    doc: TCanvasDoc;
    patches: unknown[];
    patchInfo: unknown;
  };
  const changeListeners = new Set<(payload: TChangePayload) => void>();

  const docHandle = {
    doc: () => docState,
    change: (callback: (doc: TCanvasDoc) => void) => {
      callback(docState);
      docHandle.__emitChange();
    },
    on: (event: string, callback: (payload: TChangePayload) => void) => {
      if (event === "change") {
        changeListeners.add(callback);
      }
      return docHandle;
    },
    off: (event: string, callback: (payload: TChangePayload) => void) => {
      if (event === "change") {
        changeListeners.delete(callback);
      }
      return docHandle;
    },
    __emitChange: () => {
      const payload: TChangePayload = {
        handle: docHandle as unknown as DocHandle<TCanvasDoc>,
        doc: docState,
        patches: [],
        patchInfo: {
          before: null,
          after: null,
          source: "change",
        },
      };
      for (const listener of changeListeners) {
        listener(payload);
      }
    },
  };

  return docHandle as unknown as DocHandle<TCanvasDoc>;
}

export function createTestContainer(args?: {
  width?: number;
  height?: number;
}): HTMLDivElement {
  const width = args?.width ?? 800;
  const height = args?.height ?? 600;
  const container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(container, "clientHeight", {
    configurable: true,
    value: height,
  });
  Object.defineProperty(container, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    }),
  });
  document.body.append(container);
  return container;
}

export async function flushCanvasEffects(): Promise<void> {
  await Promise.resolve();
  if (vi.isFakeTimers()) {
    vi.runAllTimers();
  }
  await Promise.resolve();
}
