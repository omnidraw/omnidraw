import { describe, expect, test } from 'vitest';
import type { TWidgetCatalog, TWidgetVariantSummary } from '@vibecanvas/orpc-client';
import { fnFindWidgetSelectionGroup, fnProjectWidgetCatalog, fnWidgetSelection } from '../../src/sidebar/widgets/fn.widget-catalog';

function variant(source: 'published' | 'draft', group: string | null): TWidgetVariantSummary {
  return {
    source,
    displayName: 'Camera',
    kind: 'actor-widget',
    slug: 'camera',
    description: null,
    revision: source,
    contentFingerprint: source,
    updatedAt: null,
    tool: { label: 'Camera', icon: null, group, priority: null, behaviorType: 'action' },
    validation: source === 'draft' ? { status: 'unknown', errors: [], warnings: [] } : null,
  };
}

describe('widget catalog projection', () => {
  test('hides an identical draft and keeps empty groups', () => {
    const projection = fnProjectWidgetCatalog({
      generation: 'one',
      groups: [{ name: 'Media', icon: null }, { name: 'Empty', icon: null }],
      widgets: [{ name: 'Camera', relation: 'same', published: variant('published', 'Media'), draft: variant('draft', 'Media'), problem: null }],
    });
    expect(projection.groups.map((group) => [group.name, group.rows.length])).toEqual([['Empty', 0], ['Media', 1]]);
    expect(projection.groups[1]?.rows[0]?.source).toBe('published');
  });

  test('shows divergent sources in their own groups and surfaces missing references', () => {
    const catalog: TWidgetCatalog = {
      generation: 'two',
      groups: [{ name: 'Media', icon: null }],
      widgets: [{ name: 'Camera', relation: 'different', published: variant('published', 'Media'), draft: variant('draft', 'Missing'), problem: null }],
    };
    const projection = fnProjectWidgetCatalog(catalog);
    expect(projection.groups[0]?.rows[0]?.source).toBe('published');
    expect(projection.ungrouped[0]).toMatchObject({ source: 'draft', missingGroup: 'Missing' });
    expect(fnFindWidgetSelectionGroup(projection, 'published', 'Camera')).toBe('Media');
    expect(fnFindWidgetSelectionGroup(projection, 'draft', 'Camera')).toBeNull();
    expect(fnWidgetSelection('/widgets/draft/Camera')).toEqual({ source: 'draft', encodedName: 'Camera' });
  });

  test('matches only exact published and draft detail routes', () => {
    expect(fnWidgetSelection('/widgets/published/Camera%20Feed')).toEqual({ source: 'published', encodedName: 'Camera%20Feed' });
    expect(fnWidgetSelection('/widgets/preview/Camera')).toBeNull();
    expect(fnWidgetSelection('/widgets/draft/Camera/files')).toBeNull();
  });
});
