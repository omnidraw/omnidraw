import { baseWidgetOs } from './orpc';
import {
  fnCoalesceWidgetCatalogEvents,
  fnWidgetCatalogCatchUpEvent,
  type TWidgetCatalogPublicEvent,
} from './fn.catalog-event';

type TWidgetCatalogEventOutput = {
  previousGeneration: number | null;
  generation: number;
  fullResync: boolean;
  changedWidgetKeys: string[];
  previewWidgetKeys: string[];
};

const apiWidgetCatalogEvents = baseWidgetOs.catalog.events.handler(async function* ({
  input,
  context,
  signal,
}): AsyncGenerator<TWidgetCatalogEventOutput> {
  const queue: { pending: TWidgetCatalogPublicEvent | null } = { pending: null };
  let wake: (() => void) | null = null;
  const notify = (): void => {
    wake?.();
    wake = null;
  };
  const unsubscribe = context.widgetCatalog.subscribe((event) => {
    queue.pending = fnCoalesceWidgetCatalogEvents({
      pending: queue.pending,
      next: { ...event, fullResync: false },
      maxChangedWidgetKeys: 4_096,
    });
    notify();
  });
  const onAbort = (): void => notify();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const observation = context.widgetCatalog.catalogObservation();
    let latestGeneration = input.afterGeneration ?? 0;
    const catchUp = fnWidgetCatalogCatchUpEvent({
      afterGeneration: input.afterGeneration,
      currentGeneration: observation.generation,
    });
    if (catchUp !== null) {
      latestGeneration = catchUp.generation;
      yield {
        ...catchUp,
        changedWidgetKeys: [...catchUp.changedWidgetKeys],
        previewWidgetKeys: [...catchUp.previewWidgetKeys],
      };
    }
    while (!signal?.aborted) {
      if (queue.pending === null) {
        await new Promise<void>((resolve) => {
          wake = resolve;
          if (signal?.aborted || queue.pending !== null) notify();
        });
      }
      const event = queue.pending;
      queue.pending = null;
      if (event === null || event.generation <= latestGeneration) continue;
      latestGeneration = event.generation;
      yield {
        previousGeneration: event.previousGeneration,
        generation: event.generation,
        fullResync: event.fullResync,
        changedWidgetKeys: [...event.changedWidgetKeys],
        previewWidgetKeys: [...event.previewWidgetKeys],
      };
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    unsubscribe();
    notify();
  }
});

export { apiWidgetCatalogEvents };
