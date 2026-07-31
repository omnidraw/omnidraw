import { describe, expect, test } from 'bun:test';
import type { TWidgetCatalog, TWidgetVariantSummary } from '@omnidraw/service-agent/widget-management/types';
import { fnWidgetGroupMembers } from './fn.widget-groups';

function variant(source: 'published' | 'draft', group: string | null): TWidgetVariantSummary {
  return {
    draftId: null,
    source,
    displayName: 'Camera',
    kind: 'widget',
    slug: 'camera',
    description: null,
    revision: source,
    contentFingerprint: source,
    updatedAt: null,
    tool: { label: 'Camera', icon: null, group, priority: null, behaviorType: 'action' },
    validation: null,
  };
}

describe('widget group mutation membership', () => {
  test('finds published and draft variants independently', () => {
    const catalog: TWidgetCatalog = {
      generation: 'one',
      groups: [{ name: 'Media', icon: null }],
      widgets: [{
        name: 'Camera',
        relation: 'different',
        published: variant('published', 'Media'),
        draft: variant('draft', 'Draft Media'),
        problem: null,
      }],
    };
    expect(fnWidgetGroupMembers(catalog, 'Media')).toEqual([{ name: 'Camera', source: 'published' }]);
    expect(fnWidgetGroupMembers(catalog, 'Draft Media')).toEqual([{ name: 'Camera', source: 'draft' }]);
    expect(fnWidgetGroupMembers(catalog, 'Empty')).toEqual([]);
  });
});
