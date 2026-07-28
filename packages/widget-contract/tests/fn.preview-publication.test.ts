import { describe, expect, test } from 'bun:test';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  fnCanonicalizeWidgetManifest,
  fnWidgetPreviewConstructionMatchesPublication,
  type IWidgetArtifactBuilder,
  type IWidgetArtifactConstructionSigner,
  type IWidgetArtifactMutationCoordinator,
  type IWidgetArtifactStore,
  type IWidgetControlStore,
  type TWidgetArtifactConstructionResult,
  type TWidgetManifestV3,
  type TWidgetPublishConstructionRequest,
} from '../src';
import { WidgetPublicationService } from '../src/local';

const digest = 'a'.repeat(64);
const capsuleBuildIdentity = {
  packageName: '@omnidraw/capsule' as const,
  packageVersion: '1.0.0',
  packageDigest: `sha256:${'b'.repeat(64)}` as const,
  buildApiVersion: '1',
  runtimeBuildDigest: `sha256:${'c'.repeat(64)}` as const,
};
const construction = {
  sourceSnapshotId: 'legacy-capture-id',
  sourceDigestSha256: digest,
  canonicalManifestJson: '{"schemaVersion":3}',
  builderIdentity: 'builder-1',
  capsuleBuildIdentity,
  uiArtifact: {
    builderIdentity: 'builder-1',
    capsuleBuildIdentity,
  },
};
const args = {
  snapshot: {
    id: 'legacy-capture-id',
    digestSha256: digest,
  },
  construction,
  canonicalManifestJson: '{"schemaVersion":3}',
};
const tenant = {
  orgId: 'org-1',
  accountId: 'account-1',
  cellId: 'cell-1',
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'legacy-publication-test',
} as TTenantContext;
const manifest: TWidgetManifestV3 = {
  schemaVersion: 3,
  name: 'Legacy Preview',
  slug: 'legacy-preview',
  ui: {
    runtime: 'capsule',
    entry: 'ui/main.ts',
    target: {
      runtimeAbi: 'quickjs-release-sync-v1',
      domProfile: 'dom-core-v2',
      featureProfiles: [],
    },
  },
};

describe('Preview construction publication compatibility', () => {
  test('accepts a retained legacy identity only for the exact source digest', () => {
    expect(fnWidgetPreviewConstructionMatchesPublication(args)).toBe(true);
    expect(fnWidgetPreviewConstructionMatchesPublication({
      ...args,
      construction: {
        ...construction,
        sourceDigestSha256: 'd'.repeat(64),
      },
    })).toBe(false);
  });

  test('rejects unrelated identities and other stale construction inputs', () => {
    const variants = [
      { ...construction, sourceSnapshotId: 'other-capture-id' },
      { ...construction, canonicalManifestJson: '{"schemaVersion":4}' },
      {
        ...construction,
        uiArtifact: { ...construction.uiArtifact, builderIdentity: 'builder-2' },
      },
      {
        ...construction,
        uiArtifact: {
          ...construction.uiArtifact,
          capsuleBuildIdentity: {
            ...capsuleBuildIdentity,
            packageVersion: '2.0.0',
          },
        },
      },
    ];

    for (const variant of variants) {
      expect(fnWidgetPreviewConstructionMatchesPublication({
        ...args,
        construction: variant,
      })).toBe(false);
    }
  });

  test('allows a digest-proven legacy construction through the publication gate', async () => {
    const signed = Object.assign(new Error('Legacy construction reached the signer.'), {
      code: 'LEGACY_CONSTRUCTION_SIGNED',
    });
    let signCalls = 0;
    const service = new WidgetPublicationService({
      builder: {
        build: async () => {
          throw new Error('Unexpected rebuild.');
        },
      } as IWidgetArtifactBuilder,
      constructionSigner: {
        signConstruction: async () => {
          signCalls += 1;
          throw signed;
        },
      } as IWidgetArtifactConstructionSigner,
      artifacts: {} as IWidgetArtifactStore,
      controlStore: {} as IWidgetControlStore,
      mutationCoordinator: {} as IWidgetArtifactMutationCoordinator,
    });
    const request = {
      definitionId: 'definition-1',
      expectedActiveRevisionId: null,
      revisionId: 'revision-1',
      snapshot: {
        id: 'legacy-capture-id',
        digestSha256: digest,
        files: [],
        createdAtMs: 1,
      },
      manifest,
      bindings: [],
      construction: {
        ...construction,
        canonicalManifestJson: fnCanonicalizeWidgetManifest(manifest),
      } as unknown as TWidgetArtifactConstructionResult,
      publicationIdentity: {},
      nowMs: 2,
    } as unknown as TWidgetPublishConstructionRequest;

    await expect(service.publishConstruction(tenant, request)).rejects.toBe(signed);
    expect(signCalls).toBe(1);

    await expect(service.publishConstruction(tenant, {
      ...request,
      construction: {
        ...request.construction,
        sourceDigestSha256: 'd'.repeat(64),
      },
    })).rejects.toMatchObject({ code: 'WIDGET_PREVIEW_PROMOTION_STALE' });
    expect(signCalls).toBe(1);
  });
});
