import type {
  TWidgetArtifactDigest,
  TWidgetCapsuleBuildIdentity,
  TWidgetPreviewPublicationIdentity,
  TWidgetSourceSnapshot,
} from '../types';
import { fnWidgetSourceSnapshotIdentityMatches } from './fn.build-integrity';

type TArgs = Readonly<{
  identity: TWidgetPreviewPublicationIdentity;
  digestSha256(value: string): TWidgetArtifactDigest;
}>;

type TPreviewConstructionIdentity = Readonly<{
  sourceSnapshotId: string;
  sourceDigestSha256: string;
  canonicalManifestJson: string;
  builderIdentity: string;
  capsuleBuildIdentity: TWidgetCapsuleBuildIdentity;
  uiArtifact: Readonly<{
    builderIdentity: string;
    capsuleBuildIdentity: TWidgetCapsuleBuildIdentity;
  }>;
}>;

type TArgsConstructionMatchesPublication = Readonly<{
  snapshot: Pick<TWidgetSourceSnapshot, 'id' | 'digestSha256'>;
  construction: TPreviewConstructionIdentity;
  canonicalManifestJson: string;
}>;

export function fnWidgetPreviewConstructionMatchesPublication(
  args: TArgsConstructionMatchesPublication,
): boolean {
  return fnWidgetSourceSnapshotIdentityMatches(
    args.snapshot,
    args.construction.sourceSnapshotId,
  )
    && args.construction.sourceDigestSha256 === args.snapshot.digestSha256
    && args.construction.canonicalManifestJson === args.canonicalManifestJson
    && args.construction.builderIdentity === args.construction.uiArtifact.builderIdentity
    && JSON.stringify(args.construction.capsuleBuildIdentity)
      === JSON.stringify(args.construction.uiArtifact.capsuleBuildIdentity);
}

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
    sourceMapArtifactDigestSha256: identity.sourceMapArtifactDigestSha256,
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
