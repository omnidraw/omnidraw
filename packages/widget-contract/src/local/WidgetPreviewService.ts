import { createHash } from 'node:crypto';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  ZWidgetManifestV2,
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
    const manifest = ZWidgetManifestV2.parse(request.manifest);
    const canonicalManifestJson = fnCanonicalizeWidgetManifest(manifest);
    const build = await this.config.builder.build(tenant, {
      snapshot: request.snapshot,
      manifest,
      canonicalManifestJson,
      builderIdentity: request.builderIdentity,
    });
    const parsedDescriptors = ZWidgetServerFunctionDescriptors.safeParse(build.functionDescriptors);
    if (!parsedDescriptors.success) {
      throw previewError(
        'WIDGET_BUILD_INTEGRITY_FAILED',
        'Widget builder returned malformed server-function descriptors.',
      );
    }
    const integrity = fnValidateWidgetBuildIntegrity({
      snapshot: request.snapshot,
      manifest,
      canonicalManifestJson,
      builderIdentity: request.builderIdentity,
      build: { ...build, functionDescriptors: parsedDescriptors.data },
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
      uiArtifact: Object.freeze({
        digestSha256: build.uiArtifact.digestSha256,
        bytes: build.uiArtifact.bytes,
      }),
      functionDescriptors: parsedDescriptors.data,
      contractDigestSha256: integrity.contractDigestSha256,
    });
  }
}
