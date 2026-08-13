import type { TWidgetPublicCatalog } from '../ports';
import { Effect, Stream } from 'effect';
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
  let cancelRefreshDelay: () => void = () => undefined;
  let cancelEventStream: () => void = () => undefined;
  let closed = false;

  const refresh = async () => {
    const currentRequest = ++requestId;
    setLoading(catalog() === null);
    const [loadError, value] = await props.controller.apiService.api.widget.catalog.get();
    if (closed || currentRequest !== requestId) return;
    setLoading(false);
    if (loadError || !value) {
      setError(loadError?.message ?? "The widget catalog is unavailable.");
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
    cancelRefreshDelay();
    cancelRefreshDelay = props.controller.lifecycle.fork(
      Effect.sleep(80).pipe(
        Effect.andThen(Effect.sync(() => {
          cancelRefreshDelay = () => undefined;
          void refresh();
        })),
      ),
    );
  };

  onMount(() => {
    void refresh();
    const eventStream = Effect.tryPromise({
      try: () => props.controller.apiService.api.widget.catalog.events({}),
      catch: (cause) => cause,
    }).pipe(
      Effect.flatMap(([eventError, events]) => {
        if (eventError || !events) {
          return Effect.fail(eventError ?? new Error('Widget catalog updates are unavailable.'));
        }
        return Stream.fromAsyncIterable(events, (cause) => cause).pipe(
          Stream.runForEach(() => Effect.sync(scheduleRefresh)),
        );
      }),
    );
    cancelEventStream = props.controller.lifecycle.fork(eventStream, {
      onError(streamError) {
        if (closed) return;
        const message = streamError instanceof Error
          ? streamError.message
          : 'Widget catalog updates stopped unexpectedly.';
        setError(`Widget catalog updates are unavailable: ${message}`);
      },
    });
    const unsubscribe = props.controller.invalidation.subscribe('widgets', scheduleRefresh);
    const unsubscribeReconnect = props.controller.subscribeReconnect(scheduleRefresh);
    onCleanup(unsubscribe);
    onCleanup(unsubscribeReconnect);
  });

  onCleanup(() => {
    closed = true;
    requestId += 1;
    cancelRefreshDelay();
    cancelRefreshDelay = () => undefined;
    cancelEventStream();
    cancelEventStream = () => undefined;
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
