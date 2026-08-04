import { describe, expect, test } from 'vitest';
import {
  fnFindWidgetSelectionGroup,
  fnProjectWidgetCatalog,
  fnWidgetSelection,
} from '../../src/sidebar/widgets/fn.widget-catalog';
import {
  publicCatalog,
  publicEntry,
  publicForm,
} from '../widget-public-catalog.fixture';

describe('filesystem widget catalog projection', () => {
  test('renders both observed forms inside their implicit manifest group', () => {
    const projection = fnProjectWidgetCatalog(publicCatalog([
      publicEntry('camera', { status: 'matched' }),
    ]));

    expect(projection.groups.map((group) => [group.name, group.rows.length]))
      .toEqual([['media', 2]]);
    expect(projection.groups[0]?.rows.map((row) => row.source))
      .toEqual(['published', 'draft']);
    expect(fnFindWidgetSelectionGroup(projection, 'published', 'camera')).toBe('media');
    expect(fnFindWidgetSelectionGroup(projection, 'draft', 'camera')).toBe('media');
  });

  test('orders implicit-group rows by ascending priority before name and source', () => {
    const projection = fnProjectWidgetCatalog(publicCatalog([
      publicEntry('zebra', {
        draft: null,
        published: publicForm('published', { name: 'Zebra', priority: -10 }),
        status: 'published-only',
      }),
      publicEntry('alpha', {
        draft: null,
        published: publicForm('published', { name: 'Alpha', priority: 20 }),
        status: 'published-only',
      }),
    ]));

    expect(projection.groups[0]?.rows.map((row) => row.widgetKey))
      .toEqual(['zebra', 'alpha']);
  });

  test('keeps sources with no known implicit group ungrouped', () => {
    const projection = fnProjectWidgetCatalog(publicCatalog([
      publicEntry('camera', {
        draft: publicForm('draft', { group: null }),
        published: publicForm('published', { group: 'media' }),
      }),
    ]));

    expect(projection.groups[0]?.rows).toHaveLength(1);
    expect(projection.groups[0]?.rows[0]?.source).toBe('published');
    expect(projection.ungrouped).toHaveLength(1);
    expect(projection.ungrouped[0]).toMatchObject({
      widgetKey: 'camera',
      source: 'draft',
      placement: {
        reference: { source: 'draft', widgetKey: 'camera' },
      },
    });
  });

  test('matches only exact draft and published widget-key routes', () => {
    expect(fnWidgetSelection('/widgets/published/camera-feed')).toEqual({
      source: 'published',
      encodedWidgetKey: 'camera-feed',
    });
    expect(fnWidgetSelection('/widgets/draft/camera%20feed')).toEqual({
      source: 'draft',
      encodedWidgetKey: 'camera%20feed',
    });
    expect(fnWidgetSelection('/widgets/preview/camera')).toBeNull();
    expect(fnWidgetSelection('/widgets/draft/camera/files')).toBeNull();
  });
});
