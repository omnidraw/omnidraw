import { describe, expect, test } from 'bun:test';
import { fnResolveWidgetAuthoringDraft } from './fn.resolve-draft';
import type { TWidgetAuthoringCatalog } from './interface';

const catalog: TWidgetAuthoringCatalog = Object.freeze({
  generation: 7,
  digestSha256: 'a'.repeat(64),
  entries: Object.freeze([
    Object.freeze({
      widgetKey: 'healthy-draft',
      displayName: 'Healthy Draft',
      draft: Object.freeze({
        health: 'healthy' as const,
        digestSha256: 'b'.repeat(64),
        relativePath: 'drafts/healthy-draft',
      }),
      published: false,
    }),
    Object.freeze({
      widgetKey: 'published-only',
      displayName: 'Published Only',
      draft: null,
      published: true,
    }),
    Object.freeze({
      widgetKey: 'broken-draft',
      displayName: 'Broken Draft',
      draft: Object.freeze({
        health: 'unhealthy' as const,
        digestSha256: 'c'.repeat(64),
        relativePath: 'drafts/broken-draft',
      }),
      published: false,
    }),
  ]),
});

describe('fnResolveWidgetAuthoringDraft', () => {
  test('pins one exact healthy key to the selected catalog generation', () => {
    expect(fnResolveWidgetAuthoringDraft({
      catalog,
      selector: { widgetKey: 'healthy-draft' },
    })).toEqual({
      ok: true,
      resolution: {
        catalogGeneration: 7,
        catalogDigestSha256: 'a'.repeat(64),
        widgetKey: 'healthy-draft',
        displayName: 'Healthy Draft',
        draftDigestSha256: 'b'.repeat(64),
        draftRelativePath: 'drafts/healthy-draft',
      },
    });
  });

  test('does not materialize published-only or unhealthy drafts', () => {
    expect(fnResolveWidgetAuthoringDraft({
      catalog,
      selector: { widgetKey: 'published-only' },
    })).toMatchObject({ ok: false, failure: { code: 'DRAFT_REQUIRED' } });
    expect(fnResolveWidgetAuthoringDraft({
      catalog,
      selector: { widgetKey: 'broken-draft' },
    })).toMatchObject({ ok: false, failure: { code: 'DRAFT_UNHEALTHY' } });
  });

  test('requires exact display-name spelling and rejects collisions', () => {
    expect(fnResolveWidgetAuthoringDraft({
      catalog,
      selector: { name: 'healthy draft' },
    })).toMatchObject({ ok: false, failure: { code: 'WIDGET_NOT_FOUND' } });
    expect(fnResolveWidgetAuthoringDraft({
      catalog: {
        ...catalog,
        entries: [
          ...catalog.entries,
          {
            widgetKey: 'healthy-draft-copy',
            displayName: 'healthy draft',
            draft: {
              health: 'healthy',
              digestSha256: 'd'.repeat(64),
              relativePath: 'drafts/healthy-draft-copy',
            },
            published: false,
          },
        ],
      },
      selector: { name: 'Healthy Draft' },
    })).toMatchObject({ ok: false, failure: { code: 'WIDGET_NAME_CASE_COLLISION' } });
  });
});
