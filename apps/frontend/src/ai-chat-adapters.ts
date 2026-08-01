import { showErrorToast, showSuccessToast, showToast } from "@/components/ui/Toast";
import { getBrowserTenantActivation, getBrowserTenantScope } from "@/services/tenant";
import { orpcWebsocketService } from "@/services/orpc-websocket";
import { themeService, txSetThemeAppearance } from "@/services/theme";
import { widgetCollaborativeStatePort } from "@/services/widget-collaborative-state";
import { fnWidgetCapsuleTheme } from "@/services/fn.widget-capsule-theme";
import { txRouteWidgetCapsuleOutput } from "@/services/tx.route-widget-capsule-output";
import { setStore, store } from "@/store";
import {
  createAiChatCanvasExtension,
  createCatalogInvalidation,
  createWidgetPlacementCoordinator,
  type TAiChatApiPort,
  type TAiChatBrowserPort,
  type TSidebarApiPort,
  type TSidebarController,
  type TWidgetBrowserPort,
  type TWidgetTransportPort,
} from "@omnidraw/ui-ai-chat";
import type {
  TWidgetCapsuleHostCatalog,
  TWidgetCapsulePublicSigningKey,
} from "@omnidraw/ui-ai-chat/widget-runtime";
import type { TCanvasImagePort } from "@omnidraw/canvas";

export const catalogInvalidation = createCatalogInvalidation();
export const widgetPlacementCoordinator = createWidgetPlacementCoordinator();

export const chatBrowserPort: TAiChatBrowserPort = {
  document,
  createResizeObserver: (callback) => new ResizeObserver(callback),
  createId: () => crypto.randomUUID(),
  createObjectUrl: (file) => URL.createObjectURL(file),
  revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  readFileAsDataUrl: (file) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("Image file did not produce a data URL"));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image file"));
    reader.readAsDataURL(file);
  }),
  writeClipboardText: (text) => navigator.clipboard.writeText(text),
  formatTime: (value) => new Date(value).toLocaleTimeString(),
  setInterval: (callback, timeout) => window.setInterval(callback, timeout),
  clearInterval: (timer) => window.clearInterval(timer as number),
  requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
  cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
};

export const widgetBrowserPort: TWidgetBrowserPort = {
  document,
  createId: () => crypto.randomUUID(),
  organizationId: () => getBrowserTenantScope().orgId,
  tenantAuthorityKey: () => {
    const activation = getBrowserTenantActivation();
    return JSON.stringify([
      activation.generation,
      activation.scope.deploymentOrigin,
      activation.scope.orgId,
      activation.scope.accountId,
      activation.scope.cellId,
      activation.scope.placementEpoch,
    ]);
  },
  now: () => Date.now(),
  nowDate: () => new Date(),
  setTimeout: (callback, timeout) => window.setTimeout(callback, timeout),
  clearTimeout: (timer) => window.clearTimeout(timer as number),
  setInterval: (callback, timeout) => window.setInterval(callback, timeout),
  clearInterval: (timer) => window.clearInterval(timer as number),
  decodeBase64: (value) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0)),
  digestSha256: async (value) => {
    const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  },
};

const apiService = orpcWebsocketService.apiService;
let widgetCapsuleHostCatalogOperation:
  Promise<TWidgetCapsuleHostCatalog> | undefined;

async function importWidgetCapsuleVerificationKey(
  key: TWidgetCapsulePublicSigningKey,
): Promise<readonly [string, CryptoKey]> {
  const publicBytes = widgetBrowserPort.decodeBase64(key.publicKeyBase64);
  const imported = await crypto.subtle.importKey(
    key.format,
    Uint8Array.from(publicBytes),
    { name: key.algorithm },
    false,
    ["verify"],
  );
  if (
    imported.type !== "public"
    || imported.extractable
    || imported.algorithm.name !== "Ed25519"
    || imported.usages.length !== 1
    || imported.usages[0] !== "verify"
  ) {
    throw new Error(`Capsule signing key "${key.keyId}" is not a verification-only public key.`);
  }
  return Object.freeze([key.keyId, imported] as const);
}

async function loadWidgetCapsuleHostCatalog(): Promise<TWidgetCapsuleHostCatalog> {
  const [error, configuration] = await apiService.api.widget.runtime.config();
  if (error || !configuration) {
    throw new Error("Widget Capsule host configuration is unavailable.");
  }
  const importedKeys = await Promise.all(
    configuration.signingKeys.map(importWidgetCapsuleVerificationKey),
  );
  const trustedSigningKeys = new Map(importedKeys);
  if (trustedSigningKeys.size !== configuration.signingKeys.length) {
    throw new Error("Widget Capsule host configuration contains duplicate signing keys.");
  }
  return Object.freeze({
    generation: configuration.generation,
    allowedApis: Object.freeze([...configuration.allowedApis]),
    limits: Object.freeze({ ...configuration.limits }),
    previewSigningKeyId: configuration.previewSigningKeyId,
    releaseSigningKeyId: configuration.releaseSigningKeyId,
    trustedSigningKeys,
  });
}

function widgetCapsuleHostCatalog(): Promise<TWidgetCapsuleHostCatalog> {
  if (widgetCapsuleHostCatalogOperation !== undefined) {
    return widgetCapsuleHostCatalogOperation;
  }
  const operation = loadWidgetCapsuleHostCatalog();
  widgetCapsuleHostCatalogOperation = operation;
  void operation.then(
    () => {
      if (widgetCapsuleHostCatalogOperation === operation) {
        widgetCapsuleHostCatalogOperation = undefined;
      }
    },
    () => {
      if (widgetCapsuleHostCatalogOperation === operation) {
        widgetCapsuleHostCatalogOperation = undefined;
      }
    },
  );
  return operation;
}

export const canvasImagePort: TCanvasImagePort = {
  async uploadImage(body) {
    const [error, result] = await apiService.api.file.put({
      body: {
        data: new Blob([new Uint8Array(body.data)], { type: body.mime_type }),
        mime_type: body.mime_type,
      },
    });
    if (error) throw error;
    if (!result.url) throw new Error("Image upload returned no URL");
    return { url: result.url };
  },
  async cloneImage(body) {
    const [error, result] = await apiService.api.file.clone({ body });
    if (error) throw error;
    if (!result.url) throw new Error("Image clone returned no URL");
    return { url: result.url };
  },
  async deleteImage(body) {
    const [error, result] = await apiService.api.file.remove({ body });
    if (error) throw error;
    return result;
  },
};

export function createFrontendAiChatExtension(args: { navigate(path: string): void }) {
  return createAiChatCanvasExtension({
    chatApi: apiService as TAiChatApiPort,
    widgetTransport: apiService as TWidgetTransportPort,
    chatBrowser: chatBrowserPort,
    widgetBrowser: widgetBrowserPort,
    widgetCapsuleHostCatalog,
    widgetCapsuleTheme: {
      read: () => fnWidgetCapsuleTheme(themeService.getTheme()),
      subscribe(listener) {
        return themeService.subscribeThemeChange((theme) => {
          listener(fnWidgetCapsuleTheme(theme));
        });
      },
    },
    widgetCapsuleOutput: {
      notification(output) {
        txRouteWidgetCapsuleOutput({
          showError: showErrorToast,
          showInfo: showToast,
          showSuccess: showSuccessToast,
        }, { output });
      },
    },
    application: {
      openResource: (resourceId) => args.navigate(`/resources/${encodeURIComponent(resourceId)}`),
      invalidateResourceCatalog: () => catalogInvalidation.invalidate("resources"),
      invalidateWidgetCatalog: () => catalogInvalidation.invalidate("widgets"),
      subscribeCatalogInvalidation: (kind, listener) => catalogInvalidation.subscribe(kind, listener),
      logError: (error) => console.error(error),
    },
    widgetPlacement: widgetPlacementCoordinator,
    widgetCollaborativeState: widgetCollaborativeStatePort,
  });
}

export function createFrontendSidebarController(args: {
  pathname(): string;
  navigate(path: string, options?: { replace?: boolean }): void;
}): TSidebarController {
  return {
    apiService: apiService as TSidebarApiPort,
    browser: {
      createIdempotencyKey: () => crypto.randomUUID(),
      setTimeout: (callback, timeout) => window.setTimeout(callback, timeout),
      clearTimeout: (timer) => window.clearTimeout(timer as number),
    },
    invalidation: catalogInvalidation,
    widgetPlacement: widgetPlacementCoordinator,
    application: {
      pathname: args.pathname,
      canvases: () => store.canvases,
      navigate: args.navigate,
      canvasCreated: (canvas) => setStore("canvases", (current) => [...current, canvas]),
      canvasUpdated: (canvas) => setStore("canvases", (current) => current.map((item) => item.id === canvas.id ? canvas : item)),
      canvasDeleted: (canvas) => setStore("canvases", (current) => current.filter((item) => item.id !== canvas.id)),
      evictCanvas: () => undefined,
      themeAppearance: () => {
        void store.theme;
        return themeService.getTheme().appearance;
      },
      setThemeAppearance: txSetThemeAppearance,
      toggleSidebar: () => setStore("sidebarVisible", (visible) => !visible),
      notifyError: showErrorToast,
      notifySuccess: showSuccessToast,
    },
  };
}
