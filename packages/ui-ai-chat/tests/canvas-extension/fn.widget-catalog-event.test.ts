import { describe, expect, test } from 'vitest';
import { fnReduceWidgetCatalogEvent } from '../../src/canvas-extension/fn.widget-catalog-event';

describe('filesystem widget catalog event remounts', () => {
  test('accepts a lower full-resync generation after restart, ignores stale events, then advances', () => {
    const restarted = fnReduceWidgetCatalogEvent(8, {
      generation: 1,
      changedWidgetKeys: [],
      fullResync: true,
    });
    expect(restarted).toEqual({
      observedGeneration: 1,
      remount: 'all',
      widgetKeys: [],
    });

    const stale = fnReduceWidgetCatalogEvent(restarted.observedGeneration, {
      generation: 1,
      changedWidgetKeys: ['counter'],
      fullResync: false,
    });
    expect(stale).toEqual({
      observedGeneration: 1,
      remount: 'none',
      widgetKeys: [],
    });

    const advanced = fnReduceWidgetCatalogEvent(stale.observedGeneration, {
      generation: 2,
      changedWidgetKeys: ['counter'],
      fullResync: false,
    });
    expect(advanced).toEqual({
      observedGeneration: 2,
      remount: 'keys',
      widgetKeys: ['counter'],
    });
  });
});
