import { describe, expect, test } from 'vitest';
import {
  fnFindWidgetSelectionGroup,
  fnProjectWidgetCatalog,
  fnWidgetSelection,
} from '../../../src/shell/framework/feature/sidebar/widgets/fn.widget-catalog';
import {
  publicCatalog,
  publicEntry,
  publicForm,
} from '../widget-public-catalog.fixture';

describe('filesystem widget catalog projection', () => {
  test('renders both observed forms inside their implicit manifest group', () => {
    const projection = fnProjectWidgetCatalog(publicCatalog([
      publicEntry('camera'),
    ]));

    expect(projection.groups.map((group) => [group.name, group.rows.length]))
      .toEqual([['media', 2]]);
    expect(projection.groups[0]?.rows.map((row) => [row.source, row.action]))
      .toEqual([['published', 'add'], ['draft', 'preview']]);
    expect(fnFindWidgetSelectionGroup(projection, 'published', 'camera')).toBe('media');
    expect(fnFindWidgetSelectionGroup(projection, 'draft', 'camera')).toBe('media');
  });

  test('hides the draft row once the publication matches the draft', () => {
    const matched = fnProjectWidgetCatalog(publicCatalog([
      publicEntry('camera', { status: 'matched' }),
    ]));
    expect(matched.groups[0]?.rows.map((row) => row.source)).toEqual(['published']);

    const draftOnly = fnProjectWidgetCatalog(publicCatalog([
      publicEntry('camera', { published: null, status: 'draft-only' }),
    ]));
    expect(draftOnly.groups[0]?.rows.map((row) => [row.source, row.action]))
      .toEqual([['draft', 'preview']]);

    const changed = fnProjectWidgetCatalog(publicCatalog([
      publicEntry('camera', { status: 'executable-changed' }),
    ]));
    expect(changed.groups[0]?.rows.map((row) => row.source))
      .toEqual(['published', 'draft']);

    const unavailable = fnProjectWidgetCatalog(publicCatalog([
      {
        ...publicEntry('camera', { status: 'unavailable' }),
        health: 'unhealthy',
        differences: {
          ...publicEntry('camera', { status: 'unavailable' }).differences,
          manifest: 'unavailable',
        },
        draft: {
          ...publicForm('draft', { health: 'unhealthy' }),
          manifestDigestSha256: null,
          config: null,
          issues: [{ code: 'MANIFEST_INVALID', message: 'Unreadable manifest.' }],
        },
      },
    ]));
    expect(unavailable.ungrouped.map((row) => [row.source, row.widgetKey]))
      .toContainEqual(['draft', 'camera']);
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
