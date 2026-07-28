import type { TOrpcSafeClient } from "@vibecanvas/orpc-client";
import type { TCanvas } from "@vibecanvas/service-db/model";
import type { TWidgetPlacementCoordinator } from "../widget-placement/WidgetPlacementCoordinator";

type TApi = TOrpcSafeClient["api"];

export type TSidebarCanvas = TCanvas;

export type TSidebarApiPort = {
  api: {
    canvas: Pick<TApi["canvas"], "create" | "update" | "remove">;
    resource: {
      resources: Pick<TApi["resource"]["resources"], "list" | "create">;
    };
    agent: Pick<TApi["agent"], "events" | "widgets" | "widgetPublish"> & {
      widgetPreview: {
        owner: Pick<TApi["agent"]["widgetPreview"]["owner"], "list">;
      };
    };
  };
};

export type TSidebarApplicationPort = {
  pathname(): string;
  canvases(): readonly TSidebarCanvas[];
  navigate(path: string, options?: { replace?: boolean }): void;
  canvasCreated(canvas: TSidebarCanvas): void;
  canvasUpdated(canvas: TSidebarCanvas): void;
  canvasDeleted(canvas: TSidebarCanvas): void;
  evictCanvas(canvasId: string): void;
  themeAppearance(): "light" | "dark";
  setThemeAppearance(appearance: "light" | "dark"): void;
  toggleSidebar(): void;
  notifyError(title: string, description?: string): void;
  notifySuccess(title: string, description?: string): void;
};

export type TSidebarBrowserPort = {
  createIdempotencyKey(): string;
  setTimeout(callback: () => void, timeout: number): unknown;
  clearTimeout(timer: unknown): void;
};

export type TCatalogInvalidationKind = "resources" | "widgets";

export type TCatalogInvalidationPort = {
  invalidate(kind: TCatalogInvalidationKind): void;
  subscribe(kind: TCatalogInvalidationKind, listener: () => void): () => void;
};

export type TWidgetDetailQueryPort = {
  tab(): string | undefined;
  path(): string | undefined;
  set(values: { tab?: string; path?: string }, options?: { replace?: boolean }): void;
};

export type TSidebarController = {
  apiService: TSidebarApiPort;
  application: TSidebarApplicationPort;
  browser: TSidebarBrowserPort;
  invalidation: TCatalogInvalidationPort;
  widgetPlacement?: TWidgetPlacementCoordinator;
};

export function createCatalogInvalidation(): TCatalogInvalidationPort {
  const listeners = new Map<TCatalogInvalidationKind, Set<() => void>>();

  return {
    invalidate(kind) {
      listeners.get(kind)?.forEach((listener) => listener());
    },
    subscribe(kind, listener) {
      const kindListeners = listeners.get(kind) ?? new Set<() => void>();
      kindListeners.add(listener);
      listeners.set(kind, kindListeners);
      return () => {
        kindListeners.delete(listener);
        if (kindListeners.size === 0) listeners.delete(kind);
      };
    },
  };
}
