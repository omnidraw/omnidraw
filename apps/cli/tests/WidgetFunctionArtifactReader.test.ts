import { describe, expect, test } from 'bun:test';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type { TWidgetServerArtifactCapability } from '../src/services/WidgetServicePool';
import { WidgetFunctionArtifactReader } from '../src/services/WidgetFunctionArtifactReader';

const tenant: TTenantContext = Object.freeze({
  orgId: 'org-a',
  accountId: 'account-a',
  cellId: 'cell-a',
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'request-a',
});

const serverArtifact = Object.freeze({
  orgId: tenant.orgId,
  id: 'artifact-a',
  kind: 'server' as const,
  digestSha256: 'a'.repeat(64),
  byteSize: 3,
  retentionState: 'pinned' as const,
  retainUntilMs: 10_000,
  createdAtMs: 1,
});

const requestPins = Object.freeze({
  widgetDefinitionId: 'definition-a',
  widgetRevisionId: 'preview-revision-a',
  artifactId: serverArtifact.id,
  artifactDigestSha256: serverArtifact.digestSha256,
  contractDigestSha256: 'b'.repeat(64),
  runtimeAbi: 'vibecanvas:test',
});

describe('WidgetFunctionArtifactReader', () => {
  test('uses only preview_server authority for an immutable preview subject', async () => {
    const calls: Array<readonly [string, unknown]> = [];
    const widgets = {
      getPreviewRevision: async (_tenant: TTenantContext, request: unknown) => {
        calls.push(['getPreviewRevision', request]);
        return {
          id: 'preview-revision-a',
          previewId: 'preview-a',
          definitionId: requestPins.widgetDefinitionId,
          contractDigestSha256: requestPins.contractDigestSha256,
          manifest: {
            schemaVersion: 2,
            name: 'Preview',
            slug: 'preview',
            ui: { entry: 'ui/main.ts' },
            server: { entry: 'server/index.ts', runtimeAbi: requestPins.runtimeAbi },
          },
          serverArtifact,
        };
      },
      issueServerPreviewArtifactReadCapability: async (_tenant: TTenantContext, request: unknown) => {
        calls.push(['issueServerPreviewArtifactReadCapability', request]);
        return 'preview-capability';
      },
      readArtifact: async (_tenant: TTenantContext, request: unknown) => {
        calls.push(['readArtifact', request]);
        return new Uint8Array([1, 2, 3]);
      },
      getRevision: async () => {
        throw new Error('published revision path must not run');
      },
      issueServerExecutionArtifactReadCapability: async () => {
        throw new Error('server_execution authority must not run');
      },
    } as unknown as TWidgetServerArtifactCapability;
    const reader = new WidgetFunctionArtifactReader({
      widgets,
      nowMs: () => 100,
      capabilityTtlMs: 1_000,
    });

    await expect(reader.readExactServerArtifact(tenant, {
      ...requestPins,
      subject: {
        kind: 'agent_preview',
        previewId: 'preview-a',
        previewRevisionId: 'preview-revision-a',
      },
    })).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(calls).toEqual([
      ['getPreviewRevision', {
        previewId: 'preview-a',
        revisionId: 'preview-revision-a',
        nowMs: 100,
      }],
      ['issueServerPreviewArtifactReadCapability', {
        previewId: 'preview-a',
        previewRevisionId: 'preview-revision-a',
        artifactId: serverArtifact.id,
        artifactKind: 'server',
        digestSha256: serverArtifact.digestSha256,
        expiresAtMs: 1_100,
      }],
      ['readArtifact', {
        artifactId: serverArtifact.id,
        readCapability: 'preview-capability',
        purpose: 'preview_server',
      }],
    ]);
  });

  test('rejects a preview revision mismatch before issuing artifact authority', async () => {
    let issueCalls = 0;
    const widgets = {
      getPreviewRevision: async () => ({
        id: 'preview-revision-a',
        previewId: 'preview-a',
        definitionId: requestPins.widgetDefinitionId,
        contractDigestSha256: requestPins.contractDigestSha256,
        manifest: {
          schemaVersion: 2,
          name: 'Preview',
          slug: 'preview',
          ui: { entry: 'ui/main.ts' },
          server: { entry: 'server/index.ts', runtimeAbi: requestPins.runtimeAbi },
        },
        serverArtifact,
      }),
      issueServerPreviewArtifactReadCapability: async () => {
        issueCalls += 1;
        return 'preview-capability';
      },
    } as unknown as TWidgetServerArtifactCapability;
    const reader = new WidgetFunctionArtifactReader({ widgets, nowMs: () => 100 });

    await expect(reader.readExactServerArtifact(tenant, {
      ...requestPins,
      widgetRevisionId: 'preview-revision-other',
      subject: {
        kind: 'agent_preview',
        previewId: 'preview-a',
        previewRevisionId: 'preview-revision-a',
      },
    })).rejects.toMatchObject({ code: 'FUNCTION_REVISION_NOT_AVAILABLE' });
    expect(issueCalls).toBe(0);
  });
});
