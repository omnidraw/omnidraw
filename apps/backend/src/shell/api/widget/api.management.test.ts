import { describe, expect, test } from 'bun:test';
import { apiWidgetConfigSaveDraft } from './api.config-save';
import {
  apiWidgetBuildAndPublish,
  apiWidgetPublishMetadata,
} from './api.publication';
import {
  apiWidgetDeletionCommit,
  apiWidgetDeletionPlan,
} from './api.deletion';

const MANIFEST_DIGEST = 'a'.repeat(64);
const CATALOG_DIGEST = 'b'.repeat(64);
const mutation = Object.freeze({
  widgetKey: 'notes-board',
  generation: 9,
  catalogDigestSha256: CATALOG_DIGEST,
  snapshot: Object.freeze({
    rootIdentity: '/private/managed/widgets:44:91',
    entries: {},
  }),
});

describe('filesystem widget management API', () => {
  test('returns only the minimal mutation identity and keeps actions explicit', async () => {
    const calls: Array<readonly [string, unknown]> = [];
    const context = {
      widgetCatalog: {
        async saveDraftConfig(input: unknown) {
          calls.push(['save', input]);
          return mutation;
        },
        async publishMetadata(input: unknown) {
          calls.push(['metadata', input]);
          return mutation;
        },
        async buildAndPublish(input: unknown) {
          calls.push(['build', input]);
          return mutation;
        },
      },
    } as never;
    const save = apiWidgetConfigSaveDraft.callable({ context });
    const metadata = apiWidgetPublishMetadata.callable({ context });
    const build = apiWidgetBuildAndPublish.callable({ context });
    const config = {
      name: 'Notes Board',
      description: 'Filesystem widget.',
      tool: { label: 'Notes', icon: null, group: 'writing', priority: 10 },
    };

    const saved = await save({
      widgetKey: 'notes-board',
      expectedManifestDigestSha256: MANIFEST_DIGEST,
      config,
    });
    const publicationInput = {
      widgetKey: 'notes-board',
      expectedManifestDigestSha256: MANIFEST_DIGEST,
      expectedCatalogDigestSha256: CATALOG_DIGEST,
    };
    const metadataResult = await metadata(publicationInput);
    const buildResult = await build(publicationInput);

    for (const result of [saved, metadataResult, buildResult]) {
      expect(result).toEqual({
        widgetKey: 'notes-board',
        generation: 9,
        catalogDigestSha256: CATALOG_DIGEST,
      });
      expect(JSON.stringify(result)).not.toContain('rootIdentity');
      expect(JSON.stringify(result)).not.toContain('snapshot');
    }
    expect(calls.map(([kind]) => kind)).toEqual(['save', 'metadata', 'build']);
    expect(calls[1]?.[1]).toMatchObject(publicationInput);
    expect(calls[2]?.[1]).toMatchObject(publicationInput);
  });

  test('delegates opaque deletion plan and commit values without exposing filesystem paths', async () => {
    const calls: Array<readonly [string, unknown]> = [];
    const plan = {
      planToken: 'plan_1',
      widgetKey: 'notes-board',
      source: 'published' as const,
      catalogDigestSha256: CATALOG_DIGEST,
      pairedDraftPresent: true,
      placementCount: 2,
      previewPlacementCount: 1,
      publishedPlacementCount: 1,
      chatMountCount: 3,
      resourcesPreserved: true as const,
    };
    const result = {
      status: 'committed' as const,
      operationId: 'operation_1',
      widgetKey: 'notes-board',
      source: 'published' as const,
      generation: 10,
      catalogDigestSha256: CATALOG_DIGEST,
      removedPlacementCount: 2,
      removedChatMountCount: 3,
      resourcesPreserved: true as const,
    };
    const context = {
      widgetCatalog: {
        async planDeletion(input: unknown) { calls.push(['plan', input]); return plan; },
        async commitDeletion(input: unknown) { calls.push(['commit', input]); return result; },
      },
    } as never;
    const resolvePlan = apiWidgetDeletionPlan.callable({ context });
    const commit = apiWidgetDeletionCommit.callable({ context });

    expect(await resolvePlan({ widgetKey: 'notes-board', source: 'published' })).toEqual(plan);
    expect(await commit({ planToken: 'plan_1', operationId: 'operation_1' })).toEqual(result);
    expect(calls[0]).toEqual(['plan', { widgetKey: 'notes-board', source: 'published' }]);
    expect(calls[1]?.[0]).toBe('commit');
    expect(calls[1]?.[1]).toMatchObject({ planToken: 'plan_1', operationId: 'operation_1' });
    expect(JSON.stringify([plan, result])).not.toContain('relativePath');
    expect(JSON.stringify([plan, result])).not.toContain('.trash');
  });
});
