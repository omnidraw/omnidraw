import type { TWidgetConstructionContractPayloadInput } from '../types';
import {
  fnNormalizeWidgetCapsuleBudgets,
  fnNormalizeWidgetCapsuleTarget,
} from './fn.capsule';

/** Stable payload used to hash and verify an unsigned guest construction. */
export function fnCanonicalizeWidgetConstructionContractPayload(
  input: TWidgetConstructionContractPayloadInput,
): string {
  return JSON.stringify({
    format: 'vibecanvas.widget-construction-contract.v1',
    sourceSnapshotId: input.sourceSnapshotId,
    sourceDigestSha256: input.sourceDigestSha256,
    sourceArtifactDigestSha256: input.sourceArtifactDigestSha256,
    canonicalManifestJson: input.canonicalManifestJson,
    unsignedUiDigestSha256: input.unsignedUiDigestSha256,
    capsuleArtifactHash: input.capsuleArtifactHash,
    target: fnNormalizeWidgetCapsuleTarget(input.target),
    budgets: fnNormalizeWidgetCapsuleBudgets(input.budgets),
    capabilityContractDigestSha256: input.capabilityContractDigestSha256,
    channelContractDigestSha256: input.channelContractDigestSha256,
    serverDigestSha256: input.serverDigestSha256,
    serverRuntimeAbi: input.serverRuntimeAbi,
    functionDescriptorsDigestSha256: input.functionDescriptorsDigestSha256,
    builderIdentity: input.builderIdentity,
    capsuleBuildIdentity: {
      packageName: '@omnidraw/capsule',
      packageVersion: input.capsuleBuildIdentity.packageVersion,
      packageDigest: input.capsuleBuildIdentity.packageDigest,
      buildApiVersion: input.capsuleBuildIdentity.buildApiVersion,
      runtimeBuildDigest: input.capsuleBuildIdentity.runtimeBuildDigest,
    },
    buildPolicyId: input.buildPolicyId,
    distributionProvenance: {
      kind: 'external-distribution',
      producer: {
        name: input.distributionProvenance.producer.name,
        version: input.distributionProvenance.producer.version,
        digest: input.distributionProvenance.producer.digest,
      },
      sourceRevision: input.distributionProvenance.sourceRevision,
      dependencyLockDigest: input.distributionProvenance.dependencyLockDigest,
      buildConfigurationDigest: input.distributionProvenance.buildConfigurationDigest,
    },
  });
}
