import { LOCAL_BROWSER_TENANT_SCOPE } from "@vibecanvas/canvas/CONSTANTS";
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
    organizationId: () => LOCAL_BROWSER_TENANT_SCOPE.orgId,
    tenantAuthorityKey: () => 'test-tenant-authority',
    now: () => 1,
    nowDate: () => new Date(1),
    setTimeout: (callback, timeout) => window.setTimeout(callback, timeout),
    clearTimeout: (timer) => window.clearTimeout(timer as number),
    setInterval: (callback, timeout) => window.setInterval(callback, timeout),
    clearInterval: (timer) => window.clearInterval(timer as number),
    decodeBase64: (value) => Uint8Array.from(window.atob(value), (character) => character.charCodeAt(0)),
    decodeUtf8: (value) => new TextDecoder().decode(value),
    digestSha256: async (value) => {
      const digest = await window.crypto.subtle.digest('SHA-256', value as Uint8Array<ArrayBuffer>);
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    },
  };
}

export function createTestApplication(): TAiChatApplicationPort {
  return {
    invalidateResourceCatalog: () => {},
    logError: () => {},
  };
}
