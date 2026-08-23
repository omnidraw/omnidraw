import { describe, expect, test } from 'bun:test';
import { apiWidgetCatalogEvents } from './api.catalog-events';

describe('widget catalog event stream', () => {
  test('keeps an empty initial subscription pending until generation 1', async () => {
    type TEvent = Readonly<{
      previousGeneration: number | null;
      generation: number;
      changedWidgetKeys: readonly string[];
      previewWidgetKeys: readonly string[];
    }>;
    let publish: (event: TEvent) => void = () => undefined;
    const unsubscribe = () => undefined;
    const widgetCatalog = {
      catalogObservation: () => ({ generation: 0, widgetKeys: [] }),
      subscribe: (next: (event: TEvent) => void) => {
        publish = next;
        return unsubscribe;
      },
    };
    const abort = new AbortController();
    const open = apiWidgetCatalogEvents.callable({
      context: { widgetCatalog } as never,
    });
    const stream = await open({}, { signal: abort.signal });
    const first = stream.next();
    let settled = false;
    void first.then(() => { settled = true; });

    await Bun.sleep(10);
    expect(settled).toBe(false);

    publish({
      previousGeneration: null,
      generation: 1,
      changedWidgetKeys: ['click-counter'],
      previewWidgetKeys: [],
    });
    expect(await first).toEqual({
      done: false,
      value: {
        previousGeneration: null,
        generation: 1,
        fullResync: false,
        changedWidgetKeys: ['click-counter'],
        previewWidgetKeys: [],
      },
    });

    abort.abort();
    await stream.return();
  });
});
