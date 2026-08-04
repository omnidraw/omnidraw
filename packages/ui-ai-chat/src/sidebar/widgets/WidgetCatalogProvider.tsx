import type { TWidgetPublicCatalog } from '@omnidraw/orpc-client';
import {
  createContext,
  createSignal,
  onCleanup,
  onMount,
  useContext,
  type Accessor,
  type ParentComponent,
} from 'solid-js';
import type { TSidebarController } from '../ports';

type TWidgetCatalogContext = {
  catalog: Accessor<TWidgetPublicCatalog | null>;
  loading: Accessor<boolean>;
  error: Accessor<string>;
  refresh: () => Promise<void>;
};

const WidgetCatalogContext = createContext<TWidgetCatalogContext>();

export const WidgetCatalogProvider: ParentComponent<{ controller: TSidebarController }> = (props) => {
  const [catalog, setCatalog] = createSignal<TWidgetPublicCatalog | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  let requestId = 0;
  let refreshTimer: unknown | undefined;
  let closed = false;
  let iterator: AsyncIterator<unknown> | undefined;

  const closeIterator = (candidate: AsyncIterator<unknown> | undefined) => {
    if (!candidate?.return) return;
    try {
      const closing = candidate.return();
      if (closing) void Promise.resolve(closing).catch(() => undefined);
    } catch {
      // Stream cleanup must remain safe when an iterator closes synchronously.
    }
  };

  const refresh = async () => {
    const currentRequest = ++requestId;
    setLoading(catalog() === null);
    const [loadError, value] = await props.controller.apiService.api.widget.catalog.get();
    if (closed || currentRequest !== requestId) return;
    setLoading(false);
    if (loadError) {
      setError(loadError.message);
      return;
    }
    setError('');
    setCatalog((current) => (
      current?.generation === value.generation
      && current.catalogDigestSha256 === value.catalogDigestSha256
        ? current
        : value
    ));
  };

  const scheduleRefresh = () => {
    if (refreshTimer !== undefined) props.controller.browser.clearTimeout(refreshTimer);
    refreshTimer = props.controller.browser.setTimeout(() => {
      refreshTimer = undefined;
      void refresh();
    }, 80);
  };

  onMount(() => {
    void refresh();
    void (async () => {
      const [eventError, events] = await props.controller.apiService.api.widget.catalog.events({});
      if (eventError) return;
      const currentIterator = events[Symbol.asyncIterator]();
      if (closed) {
        closeIterator(currentIterator);
        return;
      }
      iterator = currentIterator;
      try {
        while (!closed) {
          const next = await currentIterator.next();
          if (next.done || closed) break;
          scheduleRefresh();
        }
      } catch {
        // Reconnection is owned by the shared client; the current catalog remains visible.
      } finally {
        if (iterator === currentIterator) {
          iterator = undefined;
          closeIterator(currentIterator);
        }
      }
    })();
    const unsubscribe = props.controller.invalidation.subscribe('widgets', scheduleRefresh);
    onCleanup(unsubscribe);
  });

  onCleanup(() => {
    closed = true;
    requestId += 1;
    if (refreshTimer !== undefined) props.controller.browser.clearTimeout(refreshTimer);
    const activeIterator = iterator;
    iterator = undefined;
    closeIterator(activeIterator);
  });

  return <WidgetCatalogContext.Provider value={{ catalog, loading, error, refresh }}>
    {props.children}
  </WidgetCatalogContext.Provider>;
};

export function useWidgetCatalog(): TWidgetCatalogContext {
  const context = useContext(WidgetCatalogContext);
  if (!context) throw new Error('WidgetCatalogProvider is missing.');
  return context;
}
