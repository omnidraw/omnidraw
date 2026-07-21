import { describe, expect, test } from 'bun:test';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  fnWidgetManifestAllowsResource,
  fnWidgetRevisionArtifactsMatchManifest,
  type IWidgetRevisionReader,
  type TWidgetRevisionDescriptor,
} from '../src';

const tenant: TTenantContext = {
  orgId: 'org-a',
  accountId: 'account-a',
  cellId: 'cell-a',
  placementEpoch: 1,
  roles: ['member'],
  capabilities: [],
  requestId: 'request-a',
};

const revision: TWidgetRevisionDescriptor = {
  orgId: 'org-a',
  id: 'revision-a',
  definitionId: 'definition-a',
  revisionNumber: 1,
  manifest: {
    schemaVersion: 2,
    name: 'Example',
    slug: 'example',
    ui: { entry: 'src/ui.tsx' },
    server: { entry: 'src/server.ts', runtimeAbi: 'vibecanvas:1' },
    resources: [{ slot: 'preferences', kind: 'kv', effect: 'read' }],
  },
  contractDigestSha256: 'contract-digest',
  uiArtifact: {
    orgId: 'org-a',
    id: 'artifact-ui',
    kind: 'ui',
    digestSha256: 'ui-digest',
    byteSize: 100,
  },
  serverArtifact: {
    orgId: 'org-a',
    id: 'artifact-server',
    kind: 'server',
    digestSha256: 'server-digest',
    byteSize: 200,
  },
};

describe('widget-contract public contracts', () => {
  test('declares only logical resource access', () => {
    expect(fnWidgetManifestAllowsResource(revision.manifest, {
      slot: 'preferences',
      kind: 'kv',
      effect: 'read',
    })).toBe(true);
    expect(fnWidgetManifestAllowsResource(revision.manifest, {
      slot: 'preferences',
      kind: 'kv',
      effect: 'write',
    })).toBe(false);
  });

  test('keeps required UI and optional server artifacts internally consistent', () => {
    expect(fnWidgetRevisionArtifactsMatchManifest(revision)).toBe(true);
    expect(fnWidgetRevisionArtifactsMatchManifest({
      ...revision,
      serverArtifact: null,
    })).toBe(false);
  });

  test('supports a fake immutable revision reader', async () => {
    const reader: IWidgetRevisionReader = {
      getRevision: async (_tenant, id) => id === revision.id ? revision : null,
      getActiveRevision: async (_tenant, definitionId) => (
        definitionId === revision.definitionId ? revision : null
      ),
    };

    expect(await reader.getRevision(tenant, 'revision-a')).toEqual(revision);
    expect(await reader.getRevision(tenant, 'missing')).toBeNull();
  });
});
