import { describe, expect, test } from 'bun:test';
import { apiWidgetConfigSaveDraft } from './api.config-save';
import {
  apiWidgetBuildAndPublish,
  apiWidgetPublishMetadata,
} from './api.publication';

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
});
