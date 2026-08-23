import type {
  IAiChatPort,
  TAiChatContextCatalog,
  TAiChatMention,
} from "../../contracts.js";
import type { AiChatEffectRuntime, TAiChatStreamLifecycle } from "../../internal/stream-lifecycle.js";

export type TMentionCatalogResource = TAiChatContextCatalog["resources"][number];

export type TMentionCatalogSnapshot = Readonly<{
  mentions: readonly TAiChatMention[];
  resources: readonly TMentionCatalogResource[];
}>;

type TMentionCatalogRefreshArgs = Readonly<{
  onSuccess?(snapshot: TMentionCatalogSnapshot): void;
  onError?(error: unknown): void;
}>;

export type TMentionCatalogController = Readonly<{
  snapshot(): TMentionCatalogSnapshot;
  refresh(args?: TMentionCatalogRefreshArgs): TAiChatStreamLifecycle;
  subscribe(listener: (snapshot: TMentionCatalogSnapshot) => void): () => void;
  dispose(): void;
}>;

/**
 * Creates one catalog owner per mounted AI Chat. The component's existing
 * ManagedRuntime owns request replacement and disposal; no module-global cache
 * or native Promise lock survives the component instance.
 */
export function createMentionCatalog(
  port: IAiChatPort,
  runtime: AiChatEffectRuntime,
): TMentionCatalogController {
  const listeners = new Set<(snapshot: TMentionCatalogSnapshot) => void>();
  let current: TMentionCatalogSnapshot = Object.freeze({
    mentions: Object.freeze([]),
    resources: Object.freeze([]),
  });
  let disposed = false;

  const publish = (catalog: TAiChatContextCatalog): TMentionCatalogSnapshot => {
    if (disposed) return current;
    current = Object.freeze({
      mentions: Object.freeze([...catalog.mentions]),
      resources: Object.freeze([...catalog.resources]),
    });
    for (const listener of listeners) listener(current);
    return current;
  };

  const refresh = (args: TMentionCatalogRefreshArgs = {}): TAiChatStreamLifecycle => {
    if (disposed) throw new Error("The AI Chat mention catalog is disposed.");
    return runtime.startLatest("mention-catalog:refresh", {
      run: () => port.actions.getContextCatalog(),
      onSuccess(catalog) {
        const snapshot = publish(catalog);
        args.onSuccess?.(snapshot);
      },
      onError(error) {
        args.onError?.(error);
      },
    });
  };

  return Object.freeze({
    snapshot: () => current,
    refresh,
    subscribe(listener) {
      if (disposed) throw new Error("The AI Chat mention catalog is disposed.");
      const firstListener = listeners.size === 0;
      listeners.add(listener);
      listener(current);
      if (firstListener) refresh();
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      runtime.close("mention-catalog:refresh");
      listeners.clear();
    },
  });
}
