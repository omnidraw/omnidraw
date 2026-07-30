import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  fnCanonicalizeWidgetCapsuleCapabilityRequests,
  fnCanonicalizeWidgetCapsuleChannelContract,
  fnCanonicalizeWidgetContractPayload,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  type IWidgetArtifactBuilder,
  type TWidgetBuildResult,
  type TWidgetSourceSnapshot,
} from '../src';
import { WidgetPreviewService } from '../src/local';
import {
  CAPSULE_BUILD_IDENTITY,
  CAPSULE_MANIFEST,
  CAPSULE_RUNTIME_DESCRIPTOR,
} from './capsule.fixture';

const tenant: TTenantContext = Object.freeze({
  orgId: 'org-preview', accountId: 'account-preview', cellId: 'cell-preview',
  placementEpoch: 1, roles: ['owner'], capabilities: ['*'], requestId: 'request-preview',
});
const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const bytes = new TextEncoder().encode('document.body.textContent = "preview";');
const snapshot: TWidgetSourceSnapshot = Object.freeze({
  id: 'source-ui',
  digestSha256: sha256(bytes),
  files: Object.freeze([Object.freeze({ path: 'src/ui.tsx', bytes })]),
  createdAtMs: 1,
});

function builder(): IWidgetArtifactBuilder {
  return {
    async build(_tenant, request): Promise<TWidgetBuildResult> {
      expect(request.signingPurpose).toBe('preview');
      const uiBytes = new TextEncoder().encode(`ui:${request.snapshot.digestSha256}`);
      const uiDigestSha256 = sha256(uiBytes);
      const functionDescriptors = Object.freeze([]);
      const functionDescriptorsDigestSha256 = sha256(
        fnCanonicalizeWidgetServerFunctionDescriptors(functionDescriptors),
      );
      const capabilityContractDigestSha256 = sha256(
        fnCanonicalizeWidgetCapsuleCapabilityRequests([]),
      );
      const channelContractDigestSha256 = sha256(
        fnCanonicalizeWidgetCapsuleChannelContract(null),
      );
      const contractDigestSha256 = sha256(fnCanonicalizeWidgetContractPayload({
        canonicalManifestJson: request.canonicalManifestJson,
        uiDigestSha256,
        capsuleArtifactHash: CAPSULE_RUNTIME_DESCRIPTOR.capsuleArtifactHash,
        apiContract: CAPSULE_RUNTIME_DESCRIPTOR.apiContract,
        budgets: CAPSULE_RUNTIME_DESCRIPTOR.budgets,
        capabilityContractDigestSha256,
        channelContractDigestSha256,
        signatureKeyIds: CAPSULE_RUNTIME_DESCRIPTOR.signatureKeyIds,
        serverDigestSha256: null,
        serverRuntimeAbi: null,
        functionDescriptorsDigestSha256,
        sourceDigestSha256: request.snapshot.digestSha256,
        builderIdentity: request.builderIdentity,
        capsuleBuildIdentity: request.capsuleBuildIdentity,
        buildPolicyId: request.buildPolicyId,
      }));
      return Object.freeze({
        sourceSnapshotId: request.snapshot.id,
        sourceDigestSha256: request.snapshot.digestSha256,
        builderIdentity: request.builderIdentity,
        capsuleBuildIdentity: request.capsuleBuildIdentity,
        buildPolicyId: request.buildPolicyId,
        canonicalManifestJson: request.canonicalManifestJson,
        constructionContractDigestSha256: sha256(
          `construction:${request.snapshot.digestSha256}`,
        ),
        distributionProvenance: Object.freeze({
          kind: 'external-distribution' as const,
          producer: Object.freeze({
            name: 'widget-preview-test',
            version: '1',
            digest: `sha256:${'c'.repeat(64)}` as const,
          }),
          sourceRevision: request.snapshot.digestSha256,
          dependencyLockDigest: `sha256:${'d'.repeat(64)}` as const,
          buildConfigurationDigest: `sha256:${'e'.repeat(64)}` as const,
        }),
        functionDescriptors,
        functionDescriptorsDigestSha256,
        capabilityContractDigestSha256,
        channelContractDigestSha256,
        contractDigestSha256,
        uiArtifact: Object.freeze({
          kind: 'ui' as const,
          digestSha256: uiDigestSha256,
          bytes: uiBytes,
          capsuleArtifactHash: CAPSULE_RUNTIME_DESCRIPTOR.capsuleArtifactHash,
          runtimeDescriptor: CAPSULE_RUNTIME_DESCRIPTOR,
          builderIdentity: request.builderIdentity,
          capsuleBuildIdentity: request.capsuleBuildIdentity,
        }),
        sourceMapArtifact: null,
        serverArtifact: null,
        diagnostics: Object.freeze([]),
      });
    },
  };
}

function request(draftRevisionSha256 = snapshot.digestSha256) {
  return {
    draftId: 'draft-ui',
    definitionId: 'definition-ui',
    draftRevisionSha256,
    committedMutationId: 'mutation-ui-1',
    snapshot,
    manifest: CAPSULE_MANIFEST,
    builderIdentity: 'preview-builder-v1',
    capsuleBuildIdentity: CAPSULE_BUILD_IDENTITY,
    buildPolicyId: 'vibecanvas-capsule-widget-v1',
  };
}

describe('stateless Capsule widget preview', () => {
  test('returns verified exact signed UI bytes without durable storage', async () => {
    const result = await new WidgetPreviewService({ builder: builder() })
      .buildPreview(tenant, request());
    expect(result.draftRevisionSha256).toBe(snapshot.digestSha256);
    expect(new TextDecoder().decode(result.uiArtifact.bytes))
      .toBe(`ui:${snapshot.digestSha256}`);
    expect(result.uiArtifact.runtimeDescriptor.signatureKeyIds)
      .toEqual(['vibecanvas-preview-v1']);
  });

  test('rejects a mismatched current-draft digest before building', async () => {
    await expect(new WidgetPreviewService({ builder: builder() }).buildPreview(
      tenant,
      request('c'.repeat(64)),
    )).rejects.toMatchObject({ code: 'WIDGET_PREVIEW_DRAFT_STALE' });
  });
});
