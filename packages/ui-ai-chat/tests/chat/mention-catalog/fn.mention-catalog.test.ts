import { describe, expect, it } from 'vitest';
import {
  fnIsWidgetCatalogEventKind,
  fnProjectMentionCatalog,
} from '../../../src/chat/mention-catalog/fn.mention-catalog';
import {
  publicCatalog,
  publicEntry,
  publicForm,
} from '../../widget-public-catalog.fixture';

describe('mention catalog projection', () => {
  it('uses widget keys and configured browser-safe icons', () => {
    const mentions = fnProjectMentionCatalog([{
      id: 'db-1',
      kind: 'db',
      name: 'Camera',
      status: 'ready',
    }], publicCatalog([publicEntry('camera-internal', {
      draft: publicForm('draft', { name: 'Camera' }),
      published: publicForm('published', { name: 'Camera' }),
    })]));

    expect(mentions.map((mention) => mention.id)).toEqual([
      'resource:db-1',
      'widget:draft:camera-internal',
      'widget:published:camera-internal',
    ]);
    expect(mentions[0]).toMatchObject({
      target: { type: 'resource', resourceId: 'db-1' },
      icon: { type: 'resource', kind: 'db' },
    });
    expect(mentions[1]).toMatchObject({
      kind: 'Draft widget · camera-internal',
      target: { type: 'widget', name: 'camera-internal', source: 'draft' },
    });
    expect(mentions[1]?.icon).toEqual({
      type: 'widget',
      icon: { lucidIcon: 'Camera' },
    });
  });

  it('collapses matched draft and published forms to the published target', () => {
    const mentions = fnProjectMentionCatalog([], publicCatalog([
      publicEntry('camera', { status: 'matched' }),
    ]));
    expect(mentions.map((mention) => mention.target)).toEqual([{
      type: 'widget',
      name: 'camera',
      source: 'published',
    }]);
  });

  it('refreshes only for the filesystem catalog event stream', () => {
    expect(fnIsWidgetCatalogEventKind('widget-catalog')).toBe(true);
    expect(fnIsWidgetCatalogEventKind('widget-draft')).toBe(false);
    expect(fnIsWidgetCatalogEventKind('widget-published')).toBe(false);
    expect(fnIsWidgetCatalogEventKind('approval')).toBe(false);
  });
});
