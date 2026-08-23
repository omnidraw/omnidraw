import type { TWidgetConstructionContractPayloadInput } from '../types';
import {
  fnNormalizeWidgetRuntimeApiContract,
  fnNormalizeWidgetRuntimeBudgetRequest,
} from './fn.capsule';

/** Stable payload used to hash and verify an unsigned guest construction. */
export function fnCanonicalizeWidgetConstructionContractPayload(
  input: TWidgetConstructionContractPayloadInput,
): string {
  return JSON.stringify({
    format: 'omnidraw.widget-construction-contract.v4',
    sourceSnapshotId: input.sourceSnapshotId,
    sourceDigestSha256: input.sourceDigestSha256,
    sourceArtifactDigestSha256: input.sourceArtifactDigestSha256,
    sourceMapArtifactDigestSha256: input.sourceMapArtifactDigestSha256,
    canonicalManifestJson: input.canonicalManifestJson,
    unsignedUiDigestSha256: input.unsignedUiDigestSha256,
    artifactHash: input.artifactHash,
    apiContract: fnNormalizeWidgetRuntimeApiContract(input.apiContract),
    budgets: fnNormalizeWidgetRuntimeBudgetRequest(input.budgets),
    capabilityContractDigestSha256: input.capabilityContractDigestSha256,
    channelContractDigestSha256: input.channelContractDigestSha256,
    serverModuleFormat: input.serverModuleFormat,
    serverModuleAbi: input.serverModuleAbi,
    serverModuleDigestSha256: input.serverModuleDigestSha256,
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
