import { describe, expect, test } from 'vitest';
import { fnReduceWidgetCatalogEvent } from '../../src/canvas-extension/fn.widget-catalog-event';

describe('filesystem widget catalog event remounts', () => {
  test('accepts a lower full-resync generation after restart, ignores stale events, then advances', () => {
    const restarted = fnReduceWidgetCatalogEvent(8, {
      generation: 1,
      changedWidgetKeys: [],
      previewWidgetKeys: [],
      fullResync: true,
    });
    expect(restarted).toEqual({
      observedGeneration: 1,
      remount: 'all',
      widgetKeys: [],
      previewWidgetKeys: [],
    });

    const stale = fnReduceWidgetCatalogEvent(restarted.observedGeneration, {
      generation: 1,
      changedWidgetKeys: ['counter'],
      previewWidgetKeys: [],
      fullResync: false,
    });
    expect(stale).toEqual({
      observedGeneration: 1,
      remount: 'none',
      widgetKeys: [],
      previewWidgetKeys: [],
    });

    const advanced = fnReduceWidgetCatalogEvent(stale.observedGeneration, {
      generation: 2,
      changedWidgetKeys: ['counter'],
      previewWidgetKeys: [],
      fullResync: false,
    });
    expect(advanced).toEqual({
      observedGeneration: 2,
      remount: 'keys',
      widgetKeys: ['counter'],
      previewWidgetKeys: [],
    });

    const preview = fnReduceWidgetCatalogEvent(advanced.observedGeneration, {
      generation: 3,
      changedWidgetKeys: [],
      previewWidgetKeys: ['counter'],
      fullResync: false,
    });
    expect(preview).toEqual({
      observedGeneration: 3,
      remount: 'none',
      widgetKeys: [],
      previewWidgetKeys: ['counter'],
    });
  });
});
