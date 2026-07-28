import type {
  TWidgetArtifactDigest,
  TWidgetPreviewPublicationIdentity,
} from '../types';

type TArgs = Readonly<{
  identity: TWidgetPreviewPublicationIdentity;
  digestSha256(value: string): TWidgetArtifactDigest;
}>;

export function fnCanonicalizeWidgetPreviewPublicationIdentity(
  identity: TWidgetPreviewPublicationIdentity,
): string {
  return JSON.stringify({
    bindingPlanDigestSha256: identity.bindingPlanDigestSha256,
    bindingRevision: identity.bindingRevision,
    buildPolicyId: identity.buildPolicyId,
    builderIdentity: identity.builderIdentity,
    canonicalManifestDigestSha256: identity.canonicalManifestDigestSha256,
    canvasId: identity.canvasId,
    capabilityContractDigestSha256: identity.capabilityContractDigestSha256,
    capsuleArtifactHash: identity.capsuleArtifactHash,
    capsuleBuildIdentity: {
      buildApiVersion: identity.capsuleBuildIdentity.buildApiVersion,
      packageDigest: identity.capsuleBuildIdentity.packageDigest,
      packageName: identity.capsuleBuildIdentity.packageName,
      packageVersion: identity.capsuleBuildIdentity.packageVersion,
      runtimeBuildDigest: identity.capsuleBuildIdentity.runtimeBuildDigest,
    },
    channelContractDigestSha256: identity.channelContractDigestSha256,
    committedMutationId: identity.committedMutationId,
    constructionContractDigestSha256: identity.constructionContractDigestSha256,
    definitionId: identity.definitionId,
    draftId: identity.draftId,
    draftRevisionSha256: identity.draftRevisionSha256,
    expectedActiveRevisionId: identity.expectedActiveRevisionId,
    frameNodeId: identity.frameNodeId,
    functionDescriptorsDigestSha256: identity.functionDescriptorsDigestSha256,
    idempotencyKey: identity.idempotencyKey,
    previewContractDigestSha256: identity.previewContractDigestSha256,
    previewId: identity.previewId,
    previewRevisionId: identity.previewRevisionId,
    previewUiArtifactDigestSha256: identity.previewUiArtifactDigestSha256,
    serverArtifactDigestSha256: identity.serverArtifactDigestSha256,
    sourceArtifactDigestSha256: identity.sourceArtifactDigestSha256,
    sourceDigestSha256: identity.sourceDigestSha256,
    sourceSnapshotId: identity.sourceSnapshotId,
    unsignedUiArtifactDigestSha256: identity.unsignedUiArtifactDigestSha256,
  });
}

export function fnWidgetPreviewPublicationFingerprint(
  args: TArgs,
): TWidgetArtifactDigest {
  return args.digestSha256(
    fnCanonicalizeWidgetPreviewPublicationIdentity(args.identity),
  );
}
