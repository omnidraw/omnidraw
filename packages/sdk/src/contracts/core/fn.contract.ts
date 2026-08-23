import type { TWidgetContractPayloadInput } from '../types';
import {
  fnNormalizeWidgetRuntimeApiContract,
  fnNormalizeWidgetRuntimeBudgetRequest,
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

function normalizedContractTail(
  input: TWidgetContractPayloadInput,
) {
  return {
    capabilityContractDigestSha256: input.capabilityContractDigestSha256,
    channelContractDigestSha256: input.channelContractDigestSha256,
    signatureKeyIds: normalizedSignatureKeyIds(input.signatureKeyIds),
    serverModuleFormat: input.serverModuleFormat,
    serverModuleAbi: input.serverModuleAbi,
    serverModuleDigestSha256: input.serverModuleDigestSha256,
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
  };
}

/** Stable payload used to hash and independently verify a published widget contract. */
export function fnCanonicalizeWidgetContractPayload(
  input: TWidgetContractPayloadInput,
): string {
  return JSON.stringify({
    format: 'omnidraw.widget-contract.v5',
    canonicalManifestJson: input.canonicalManifestJson,
    uiDigestSha256: input.uiDigestSha256,
    artifactHash: input.artifactHash,
    apiContract: fnNormalizeWidgetRuntimeApiContract(input.apiContract),
    budgets: fnNormalizeWidgetRuntimeBudgetRequest(input.budgets),
    ...normalizedContractTail(input),
  });
}
