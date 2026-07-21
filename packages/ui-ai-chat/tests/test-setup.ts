import type { DocHandle } from "@automerge/automerge-repo";
import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TAiChatApplicationPort, TAiChatBrowserPort, TWidgetBrowserPort } from "../src/ports";

export function ensureDom() {
  if (typeof document === "undefined" || typeof window === "undefined") {
    throw new Error("AI Chat tests require the jsdom environment");
  }
}

export function ensureCanvasDom() {
  ensureDom();
  if (typeof ResizeObserver === "undefined") {
    class TestResizeObserver {
      observe() {}
      disconnect() {}
    }
    Object.assign(globalThis, { ResizeObserver: TestResizeObserver });
  }
  if (typeof Range.prototype.getBoundingClientRect !== "function") {
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(),
    });
  }
  if (typeof Range.prototype.getClientRects !== "function") {
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => Object.assign([], { item: () => null }),
    });
  }
}

export function createMockDocHandle(overrides?: Partial<TCanvasDoc>): DocHandle<TCanvasDoc> {
  const docState: TCanvasDoc = {
    id: "ai-chat-test-doc",
    name: "ai-chat-test-doc",
    elements: {},
    groups: {},
    ...overrides,
  };
  const listeners = new Set<(payload: unknown) => void>();
  const handle = {
    doc: () => docState,
    change: (callback: (doc: TCanvasDoc) => void) => callback(docState),
    on: (event: string, listener: (payload: unknown) => void) => {
      if (event === "change") listeners.add(listener);
      return handle;
    },
    off: (event: string, listener: (payload: unknown) => void) => {
      if (event === "change") listeners.delete(listener);
      return handle;
    },
  };
  return handle as unknown as DocHandle<TCanvasDoc>;
}

export function createTestContainer(args?: { width?: number; height?: number }) {
  ensureDom();
  const container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", { configurable: true, value: args?.width ?? 800 });
  Object.defineProperty(container, "clientHeight", { configurable: true, value: args?.height ?? 600 });
  document.body.appendChild(container);
  return container;
}

export function createTestChatBrowser(): TAiChatBrowserPort {
  return {
    document,
    createResizeObserver: () => ({
      observe: () => {},
      disconnect: () => {},
    }),
    createId: () => "00000000-0000-4000-8000-000000000001",
    createObjectUrl: () => "blob:test",
    revokeObjectUrl: () => {},
    readFileAsDataUrl: async () => "data:image/png;base64,dGVzdA==",
    writeClipboardText: async () => {},
    formatTime: () => "12:00:00 AM",
    setInterval: (callback, timeout) => window.setInterval(callback, timeout),
    clearInterval: (timer) => window.clearInterval(timer as number),
    requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
    cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
  };
}

export function createTestWidgetBrowser(): TWidgetBrowserPort {
  return {
    document,
    createId: () => "00000000-0000-4000-8000-000000000001",
    now: () => 1,
    nowDate: () => new Date(1),
    setTimeout: (callback, timeout) => window.setTimeout(callback, timeout),
    clearTimeout: (timer) => window.clearTimeout(timer as number),
    setInterval: (callback, timeout) => window.setInterval(callback, timeout),
    clearInterval: (timer) => window.clearInterval(timer as number),
  };
}

export function createTestApplication(): TAiChatApplicationPort {
  return {
    invalidateResourceCatalog: () => {},
    logError: () => {},
  };
}
