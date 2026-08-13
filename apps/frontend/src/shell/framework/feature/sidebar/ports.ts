import type {
  TWidgetBrowserFunctionDescriptor,
  TWidgetPlacementRef,
  TWidgetPresentationProjection,
  TWidgetResourceRequirement,
} from "@omnidraw/sdk";
import type { TBackendCanvas, TBackendResource } from "@/core/app/backend.types";
import type {
  TPrivateRequestInput,
  TPrivateRequestOutput,
  TPrivateRequestPath,
} from "@/core/app/private-operation-contract";
import type { TFrontendTransportFailure } from "@/core/app/service.frontend-transport";
import type { TWidgetPlacementCoordinator } from "../widget-placement/WidgetPlacementCoordinator";
import type { TFrontendRuntime } from "@/shell/runtime/frontend-runtime";

export type TApiError = TFrontendTransportFailure;
export type TSafeResult<T> = readonly [TApiError | null, T | undefined];
type TSafeCall<TInput, TOutput> = (input: TInput) => Promise<TSafeResult<TOutput>>;
type TSafeOperation<Path extends TPrivateRequestPath> = (
  input: TPrivateRequestInput<Path>,
) => Promise<TSafeResult<TPrivateRequestOutput<Path>>>;

export type TWidgetPublicIssue = Readonly<{ code: string; message: string }>;
export type TWidgetPublicCatalogForm = Readonly<{
  source: "draft" | "published";
  health: "healthy" | "unhealthy";
  manifestDigestSha256: string | null;
  config: TWidgetPresentationProjection | null;
  resources: readonly TWidgetResourceRequirement[];
  functions: readonly TWidgetBrowserFunctionDescriptor[];
  fileCount: number;
  issues: readonly TWidgetPublicIssue[];
}>;
export type TWidgetPublicCatalogDifferences = Readonly<{
  availability: "draft-only" | "published-only" | "draft-and-published";
  manifest: "same" | "different" | "unavailable";
  presentation: "same" | "different" | "unavailable";
  executableManifest: "same" | "different" | "unavailable";
  status: "draft-only" | "published-only" | "matched" | "presentation-changed" | "executable-changed" | "unavailable";
}>;
export type TWidgetPublicCatalogEntry = Readonly<{
  widgetKey: string;
  health: "healthy" | "degraded" | "unhealthy";
  placeable: boolean;
  differences: TWidgetPublicCatalogDifferences;
  draft: TWidgetPublicCatalogForm | null;
  published: TWidgetPublicCatalogForm | null;
  placement: Readonly<{
    reference: Extract<TWidgetPlacementRef, { source: "published" }>;
    bounds: Readonly<{ width: number; height: number }>;
  }> | null;
}>;
export type TWidgetPublicCatalog = Readonly<{
  format: "omnidraw.widget-catalog.public.v1";
  generation: number;
  catalogDigestSha256: string;
  healthy: boolean;
  groups: readonly string[];
  entries: readonly TWidgetPublicCatalogEntry[];
  issues: readonly TWidgetPublicIssue[];
}>;
export type TWidgetPublicFileEntry = Readonly<{ path: string; kind: "file" | "directory"; byteSize: number }>;
export type TWidgetPublicFilePreview = Readonly<{ path: string; byteSize: number; binary: boolean; truncated: boolean; text: string | null }>;

export type TSidebarCanvas = TBackendCanvas;

export type TSidebarApiPort = Readonly<{
  api: Readonly<{
    canvas: Readonly<{
      create: TSafeOperation<"canvas.create">;
      update: TSafeOperation<"canvas.update">;
      remove: TSafeOperation<"canvas.remove">;
    }>;
    resource: Readonly<{ resources: Readonly<{
      list: (input?: TPrivateRequestInput<"resource.resources.list">) => Promise<TSafeResult<TPrivateRequestOutput<"resource.resources.list">>>;
      create: TSafeOperation<"resource.resources.create">;
    }> }>;
    widget: Readonly<{
      catalog: Readonly<{
        get: () => Promise<TSafeResult<TWidgetPublicCatalog>>;
        events: TSafeCall<Record<string, never>, AsyncIterable<unknown>>;
        files: Readonly<{
          list: TSafeOperation<"widget.catalog.files.list">;
          read: TSafeOperation<"widget.catalog.files.read">;
        }>;
      }>;
      config: Readonly<{ saveDraft: TSafeOperation<"widget.config.saveDraft"> }>;
      preview: Readonly<{ rebuildDraft: TSafeOperation<"widget.preview.rebuildDraft"> }>;
      publication: Readonly<{
        publishMetadata: TSafeOperation<"widget.publication.publishMetadata">;
        buildAndPublish: TSafeOperation<"widget.publication.buildAndPublish">;
      }>;
    }>;
  }>;
}>;

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
  subscribeReconnect(listener: () => void): () => void;
  lifecycle: Pick<TFrontendRuntime, "fork">;
  widgetPlacement?: TWidgetPlacementCoordinator;
};

export function createCatalogInvalidation(): TCatalogInvalidationPort {
  const listeners = new Map<TCatalogInvalidationKind, Set<() => void>>();
  return {
    invalidate(kind) { listeners.get(kind)?.forEach((listener) => listener()); },
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
