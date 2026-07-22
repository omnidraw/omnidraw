import { describe, expect, test } from 'bun:test';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import { WidgetFunctionArtifactReader } from '../src/services/WidgetFunctionArtifactReader';

const tenant: TTenantContext = Object.freeze({
  orgId: 'org-a', accountId: 'account-a', cellId: 'cell-a', placementEpoch: 1,
  roles: ['owner'], capabilities: ['*'], requestId: 'request-a',
});
const artifact = { id: 'artifact-a', kind: 'server', digestSha256: 'a'.repeat(64) } as const;
const request = {
  widgetDefinitionId: 'definition-a', widgetRevisionId: 'revision-a',
  artifactId: artifact.id, artifactDigestSha256: artifact.digestSha256,
  contractDigestSha256: 'b'.repeat(64), runtimeAbi: 'vibecanvas:test',
  subject: { kind: 'widget_instance' as const, canvasId: 'canvas-a', widgetInstanceId: 'widget-a' },
};

describe('WidgetFunctionArtifactReader', () => {
  test('issues exact server execution authority for the pinned published revision', async () => {
    const calls: Array<readonly [string, unknown]> = [];
    const widgets = {
      getRevision: async () => ({
        definitionId: request.widgetDefinitionId,
        contractDigestSha256: request.contractDigestSha256,
        manifest: { server: { runtimeAbi: request.runtimeAbi } },
        serverArtifact: artifact,
      }),
      issueServerExecutionArtifactReadCapability: async (_tenant: TTenantContext, value: unknown) => {
        calls.push(['issue', value]);
        return 'capability';
      },
      readArtifact: async (_tenant: TTenantContext, value: unknown) => {
        calls.push(['read', value]);
        return new Uint8Array([1, 2, 3]);
      },
    };
    const reader = new WidgetFunctionArtifactReader({ widgets: widgets as never, nowMs: () => 100, capabilityTtlMs: 1_000 });
    await expect(reader.readExactServerArtifact(tenant, request)).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(calls).toEqual([
      ['issue', {
        definitionId: request.widgetDefinitionId,
        revisionId: request.widgetRevisionId,
        artifactId: artifact.id,
        artifactKind: 'server',
        digestSha256: artifact.digestSha256,
        expiresAtMs: 1_100,
      }],
      ['read', { artifactId: artifact.id, readCapability: 'capability', purpose: 'server_execution' }],
    ]);
  });
});
