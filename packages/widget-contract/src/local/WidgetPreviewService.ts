import { createHash } from 'node:crypto';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  ZWidgetCapsuleRuntimeDescriptor,
  ZWidgetManifestV3,
  ZWidgetServerFunctionDescriptors,
  fnCanonicalizeWidgetManifest,
  fnValidateWidgetBuildIntegrity,
} from '..';
import type {
  IWidgetArtifactBuilder,
  IWidgetPreviewService,
  TWidgetPreviewBuildRequest,
  TWidgetPreviewBuildResult,
} from '..';
import { fnValidateArtifactDigest } from './fn.artifact-path';

export type TWidgetPreviewServiceConfig = Readonly<{
  builder: IWidgetArtifactBuilder;
}>;

function previewError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** Builds one coherent draft snapshot in memory without creating durable preview authority. */
export class WidgetPreviewService implements IWidgetPreviewService {
  constructor(readonly config: TWidgetPreviewServiceConfig) {}

  async buildPreview(
    tenant: TTenantContext,
    request: TWidgetPreviewBuildRequest,
  ): Promise<TWidgetPreviewBuildResult> {
    fnValidateArtifactDigest(request.draftRevisionSha256);
    if (request.draftRevisionSha256 !== request.snapshot.digestSha256) {
      throw previewError(
        'WIDGET_PREVIEW_DRAFT_STALE',
        'Widget preview snapshot does not match the current draft revision.',
      );
    }
    const manifest = ZWidgetManifestV3.parse(request.manifest);
    const canonicalManifestJson = fnCanonicalizeWidgetManifest(manifest);
    const build = await this.config.builder.build(tenant, {
      snapshot: request.snapshot,
      manifest,
      canonicalManifestJson,
      builderIdentity: request.builderIdentity,
      capsuleBuildIdentity: request.capsuleBuildIdentity,
      buildPolicyId: request.buildPolicyId,
      signingPurpose: 'preview',
    });
    const parsedDescriptors = ZWidgetServerFunctionDescriptors.safeParse(build.functionDescriptors);
    if (!parsedDescriptors.success) {
      throw previewError(
        'WIDGET_BUILD_INTEGRITY_FAILED',
        'Widget builder returned malformed server-function descriptors.',
      );
    }
    const runtimeDescriptor = ZWidgetCapsuleRuntimeDescriptor.parse(
      build.uiArtifact.runtimeDescriptor,
    );
    const normalizedBuild = {
      ...build,
      functionDescriptors: parsedDescriptors.data,
      uiArtifact: { ...build.uiArtifact, runtimeDescriptor },
    };
    const integrity = fnValidateWidgetBuildIntegrity({
      snapshot: request.snapshot,
      manifest,
      canonicalManifestJson,
      builderIdentity: request.builderIdentity,
      capsuleBuildIdentity: request.capsuleBuildIdentity,
      buildPolicyId: request.buildPolicyId,
      build: normalizedBuild,
      digestSha256: (value) => createHash('sha256').update(value).digest('hex'),
    });
    if (!integrity.valid) {
      throw previewError(
        'WIDGET_BUILD_INTEGRITY_FAILED',
        `Widget builder integrity check failed: ${integrity.reason}.`,
      );
    }
    return Object.freeze({
      draftId: request.draftId,
      definitionId: request.definitionId,
      draftRevisionSha256: request.draftRevisionSha256,
      manifest,
      builderIdentity: request.builderIdentity,
      capsuleBuildIdentity: request.capsuleBuildIdentity,
      buildPolicyId: request.buildPolicyId,
      uiArtifact: Object.freeze(normalizedBuild.uiArtifact),
      functionDescriptors: parsedDescriptors.data,
      functionDescriptorsDigestSha256: integrity.functionDescriptorsDigestSha256,
      capabilityContractDigestSha256: build.capabilityContractDigestSha256,
      channelContractDigestSha256: build.channelContractDigestSha256,
      contractDigestSha256: integrity.contractDigestSha256,
      diagnostics: build.diagnostics,
    });
  }
}
