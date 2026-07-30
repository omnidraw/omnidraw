import type {
  TWidgetContractPayloadInput,
  TWidgetLegacyContractPayloadInput,
} from '../types';
import {
  fnNormalizeWidgetCapsuleApiContract,
  fnNormalizeWidgetCapsuleBudgetRequest,
  fnNormalizeWidgetCapsuleBudgets,
  fnNormalizeWidgetCapsuleTarget,
} from './fn.capsule';

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedSignatureKeyIds(values: readonly string[]): readonly string[] {
  const sorted = [...values].sort(compareText);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1] === sorted[index]) {
      throw new TypeError('Capsule signature key IDs must not contain duplicates.');
    }
  }
  return sorted;
}

/** Stable payload used to hash and independently verify a published widget contract. */
export function fnCanonicalizeWidgetContractPayload(
  input: TWidgetContractPayloadInput,
): string {
  return JSON.stringify({
    format: 'vibecanvas.widget-contract.v4',
    canonicalManifestJson: input.canonicalManifestJson,
    uiDigestSha256: input.uiDigestSha256,
    capsuleArtifactHash: input.capsuleArtifactHash,
    apiContract: fnNormalizeWidgetCapsuleApiContract(input.apiContract),
    budgets: fnNormalizeWidgetCapsuleBudgetRequest(input.budgets),
    capabilityContractDigestSha256: input.capabilityContractDigestSha256,
    channelContractDigestSha256: input.channelContractDigestSha256,
    signatureKeyIds: normalizedSignatureKeyIds(input.signatureKeyIds),
    serverDigestSha256: input.serverDigestSha256,
    serverRuntimeAbi: input.serverRuntimeAbi,
    functionDescriptorsDigestSha256: input.functionDescriptorsDigestSha256,
    sourceDigestSha256: input.sourceDigestSha256,
    builderIdentity: input.builderIdentity,
    capsuleBuildIdentity: {
      packageName: '@omnidraw/capsule',
      packageVersion: input.capsuleBuildIdentity.packageVersion,
      packageDigest: input.capsuleBuildIdentity.packageDigest,
      buildApiVersion: input.capsuleBuildIdentity.buildApiVersion,
      runtimeBuildDigest: input.capsuleBuildIdentity.runtimeBuildDigest,
    },
    buildPolicyId: input.buildPolicyId,
  });
}

/**
 * Frozen verifier for immutable Capsule 0.9.4 publication digests. New
 * construction never calls this legacy exact-target contract.
 */
export function fnCanonicalizeLegacyWidgetContractPayload(
  input: TWidgetLegacyContractPayloadInput,
): string {
  return JSON.stringify({
    format: 'vibecanvas.widget-contract.v3',
    canonicalManifestJson: input.canonicalManifestJson,
    uiDigestSha256: input.uiDigestSha256,
    capsuleArtifactHash: input.capsuleArtifactHash,
    target: fnNormalizeWidgetCapsuleTarget(input.target),
    budgets: fnNormalizeWidgetCapsuleBudgets(input.budgets),
    capabilityContractDigestSha256: input.capabilityContractDigestSha256,
    channelContractDigestSha256: input.channelContractDigestSha256,
    signatureKeyIds: normalizedSignatureKeyIds(input.signatureKeyIds),
    serverDigestSha256: input.serverDigestSha256,
    serverRuntimeAbi: input.serverRuntimeAbi,
    functionDescriptorsDigestSha256: input.functionDescriptorsDigestSha256,
    sourceDigestSha256: input.sourceDigestSha256,
    builderIdentity: input.builderIdentity,
    capsuleBuildIdentity: {
      packageName: '@omnidraw/capsule',
      packageVersion: input.capsuleBuildIdentity.packageVersion,
      packageDigest: input.capsuleBuildIdentity.packageDigest,
      buildApiVersion: input.capsuleBuildIdentity.buildApiVersion,
      runtimeBuildDigest: input.capsuleBuildIdentity.runtimeBuildDigest,
    },
    buildPolicyId: input.buildPolicyId,
  });
}
