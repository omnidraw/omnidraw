import type { TWidgetCatalog } from '@vibecanvas/orpc-client';
import { createContext, createSignal, onCleanup, onMount, useContext, type Accessor, type ParentComponent } from 'solid-js';
import { orpcWebsocketService } from '@/services/orpc-websocket';

type TWidgetCatalogContext = {
  catalog: Accessor<TWidgetCatalog | null>;
  loading: Accessor<boolean>;
  error: Accessor<string>;
  refresh: () => Promise<void>;
};

const WidgetCatalogContext = createContext<TWidgetCatalogContext>();

export const WidgetCatalogProvider: ParentComponent = (props) => {
  const [catalog, setCatalog] = createSignal<TWidgetCatalog | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  let requestId = 0;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let iterator: AsyncIterator<unknown> | undefined;

  const refresh = async () => {
    const currentRequest = ++requestId;
    setLoading(catalog() === null);
    const [loadError, value] = await orpcWebsocketService.apiService.api.agent.widgets.catalog({});
    if (closed || currentRequest !== requestId) return;
    setLoading(false);
    if (loadError) {
      setError(loadError.message);
      return;
    }
    setError('');
    setCatalog((current) => current?.generation === value.generation ? current : value);
  };

  const scheduleRefresh = () => {
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      void refresh();
    }, 80);
  };

  onMount(() => {
    void refresh();
    void (async () => {
      const [eventError, events] = await orpcWebsocketService.apiService.api.agent.events({});
      if (eventError || closed) return;
      iterator = events[Symbol.asyncIterator]();
      try {
        while (!closed) {
          const next = await iterator.next();
          if (next.done || closed) break;
          const event = next.value;
          if (event && typeof event === 'object' && 'kind' in event) {
            const kind = (event as { kind?: string }).kind;
            if (kind === 'widget-draft' || kind === 'widget-published' || kind === 'widgetupdate' || kind === 'widget-catalog') scheduleRefresh();
          }
        }
      } catch {
        // WebSocket reconnects are owned by the shared client; a later provider mount resubscribes.
      }
    })();
  });

  onCleanup(() => {
    closed = true;
    requestId += 1;
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    void iterator?.return?.();
  });

  return <WidgetCatalogContext.Provider value={{ catalog, loading, error, refresh }}>{props.children}</WidgetCatalogContext.Provider>;
};

export function useWidgetCatalog(): TWidgetCatalogContext {
  const context = useContext(WidgetCatalogContext);
  if (!context) throw new Error('WidgetCatalogProvider is missing.');
  return context;
}
