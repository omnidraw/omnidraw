import { describe, expect, test } from 'bun:test';
import {
  fnCoalesceWidgetCatalogEvents,
  fnWidgetCatalogCatchUpEvent,
} from './fn.catalog-event';

describe('widget catalog event projection', () => {
  test('forces a full scene resync when a deleted widget was missed during disconnect', () => {
    expect(fnWidgetCatalogCatchUpEvent({
      afterGeneration: 4,
      currentGeneration: 6,
    })).toEqual({
      previousGeneration: 4,
      generation: 6,
      fullResync: true,
      changedWidgetKeys: [],
      previewWidgetKeys: [],
    });
  });

  test('coalesces refreshes into one bounded pending notification', () => {
    const first = fnCoalesceWidgetCatalogEvents({
      pending: null,
      next: {
        previousGeneration: 1,
        generation: 2,
        fullResync: false,
        changedWidgetKeys: ['alpha'],
        previewWidgetKeys: [],
      },
      maxChangedWidgetKeys: 2,
    });
    expect(fnCoalesceWidgetCatalogEvents({
      pending: first,
      next: {
        previousGeneration: 2,
        generation: 4,
        fullResync: false,
        changedWidgetKeys: ['beta', 'gamma'],
        previewWidgetKeys: ['alpha'],
      },
      maxChangedWidgetKeys: 2,
    })).toEqual({
      previousGeneration: 1,
      generation: 4,
      fullResync: true,
      changedWidgetKeys: [],
      previewWidgetKeys: [],
    });
  });

  test('coalesces Preview generations without turning them into catalog changes', () => {
    expect(fnCoalesceWidgetCatalogEvents({
      pending: {
        previousGeneration: 1,
        generation: 2,
        fullResync: false,
        changedWidgetKeys: [],
        previewWidgetKeys: ['alpha'],
      },
      next: {
        previousGeneration: 2,
        generation: 3,
        fullResync: false,
        changedWidgetKeys: ['published'],
        previewWidgetKeys: ['beta'],
      },
      maxChangedWidgetKeys: 4,
    })).toEqual({
      previousGeneration: 1,
      generation: 3,
      fullResync: false,
      changedWidgetKeys: ['published'],
      previewWidgetKeys: ['alpha', 'beta'],
    });
  });
});
