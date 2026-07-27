import type {
  TWidgetCapsuleBuildIdentity,
  TWidgetBuildResult,
  TWidgetManifestV3,
  TWidgetSourceSnapshot,
} from '../types';
import {
  fnCanonicalizeWidgetCapsuleCapabilityRequests,
  fnCanonicalizeWidgetCapsuleChannelContract,
  fnNormalizeWidgetCapsuleBudgetRequest,
  fnNormalizeWidgetCapsuleBudgets,
  fnNormalizeWidgetCapsuleRuntimeDescriptor,
  fnNormalizeWidgetCapsuleTarget,
} from './fn.capsule';
import { fnCanonicalizeWidgetContractPayload } from './fn.contract';
import {
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnValidateWidgetServerFunctionDescriptors,
} from './fn.function-descriptor';

export type TWidgetBuildIntegrityValidation =
  | Readonly<{
      valid: true;
      functionDescriptorsDigestSha256: string;
      contractDigestSha256: string;
    }>
  | Readonly<{
      valid: false;
      reason:
        | 'immutable_input_mismatch'
        | 'artifact_set_mismatch'
        | 'runtime_descriptor_mismatch'
        | 'function_descriptors_invalid'
        | 'function_descriptors_digest_mismatch'
        | 'capability_contract_digest_mismatch'
        | 'channel_contract_digest_mismatch'
        | 'contract_digest_mismatch';
    }>;

export type TWidgetBuildIntegrityArgs = Readonly<{
  snapshot: TWidgetSourceSnapshot;
  manifest: TWidgetManifestV3;
  canonicalManifestJson: string;
  builderIdentity: string;
  capsuleBuildIdentity: TWidgetCapsuleBuildIdentity;
  buildPolicyId: string;
  build: TWidgetBuildResult;
  digestSha256: (canonicalValue: string) => string;
}>;

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Validates that one build result is bound to its exact immutable inputs and contract. */
export function fnValidateWidgetBuildIntegrity(
  args: TWidgetBuildIntegrityArgs,
): TWidgetBuildIntegrityValidation {
  if (
    args.build.sourceSnapshotId !== args.snapshot.id
    || args.build.sourceDigestSha256 !== args.snapshot.digestSha256
    || args.build.canonicalManifestJson !== args.canonicalManifestJson
    || args.build.builderIdentity !== args.builderIdentity
    || !sameJson(args.build.capsuleBuildIdentity, args.capsuleBuildIdentity)
    || args.build.buildPolicyId !== args.buildPolicyId
  ) return { valid: false, reason: 'immutable_input_mismatch' };

  if (
    args.build.uiArtifact.kind !== 'ui'
    || (args.manifest.server === undefined) !== (args.build.serverArtifact === null)
    || (args.build.serverArtifact !== null && args.build.serverArtifact.kind !== 'server')
    || (
      args.build.serverArtifact !== null
      && args.build.serverArtifact.runtimeAbi !== args.manifest.server?.runtimeAbi
    )
  ) return { valid: false, reason: 'artifact_set_mismatch' };

  const runtime = fnNormalizeWidgetCapsuleRuntimeDescriptor(
    args.build.uiArtifact.runtimeDescriptor,
  );
  if (
    args.build.uiArtifact.capsuleArtifactHash !== runtime.capsuleArtifactHash
    || args.build.uiArtifact.builderIdentity !== args.builderIdentity
    || !sameJson(args.build.uiArtifact.capsuleBuildIdentity, args.capsuleBuildIdentity)
    || !sameJson(runtime.target, fnNormalizeWidgetCapsuleTarget(args.manifest.ui.target))
    || !sameJson(
      args.build.uiArtifact.requestedBudgets,
      fnNormalizeWidgetCapsuleBudgetRequest(args.manifest.ui.budgets ?? {}),
    )
    || !sameJson(
      args.build.uiArtifact.effectiveBudgets,
      fnNormalizeWidgetCapsuleBudgets(runtime.budgets),
    )
  ) return { valid: false, reason: 'runtime_descriptor_mismatch' };

  const functionValidation = fnValidateWidgetServerFunctionDescriptors(
    args.manifest,
    args.build.functionDescriptors,
  );
  if (!functionValidation.valid) {
    return { valid: false, reason: 'function_descriptors_invalid' };
  }

  const functionDescriptorsDigestSha256 = args.digestSha256(
    fnCanonicalizeWidgetServerFunctionDescriptors(args.build.functionDescriptors),
  );
  if (args.build.functionDescriptorsDigestSha256 !== functionDescriptorsDigestSha256) {
    return { valid: false, reason: 'function_descriptors_digest_mismatch' };
  }

  const capabilityContractDigestSha256 = args.digestSha256(
    fnCanonicalizeWidgetCapsuleCapabilityRequests(runtime.capabilityRequests),
  );
  if (args.build.capabilityContractDigestSha256 !== capabilityContractDigestSha256) {
    return { valid: false, reason: 'capability_contract_digest_mismatch' };
  }

  const channelContractDigestSha256 = args.digestSha256(
    fnCanonicalizeWidgetCapsuleChannelContract(runtime.channels),
  );
  if (args.build.channelContractDigestSha256 !== channelContractDigestSha256) {
    return { valid: false, reason: 'channel_contract_digest_mismatch' };
  }

  const contractDigestSha256 = args.digestSha256(fnCanonicalizeWidgetContractPayload({
    canonicalManifestJson: args.canonicalManifestJson,
    uiDigestSha256: args.build.uiArtifact.digestSha256,
    capsuleArtifactHash: runtime.capsuleArtifactHash,
    target: runtime.target,
    budgets: runtime.budgets,
    capabilityContractDigestSha256,
    channelContractDigestSha256,
    signatureKeyIds: runtime.signatureKeyIds,
    serverDigestSha256: args.build.serverArtifact?.digestSha256 ?? null,
    serverRuntimeAbi: args.build.serverArtifact?.runtimeAbi ?? null,
    functionDescriptorsDigestSha256,
    sourceDigestSha256: args.snapshot.digestSha256,
    builderIdentity: args.builderIdentity,
    capsuleBuildIdentity: args.capsuleBuildIdentity,
    buildPolicyId: args.buildPolicyId,
  }));
  if (args.build.contractDigestSha256 !== contractDigestSha256) {
    return { valid: false, reason: 'contract_digest_mismatch' };
  }

  return Object.freeze({
    valid: true,
    functionDescriptorsDigestSha256,
    contractDigestSha256,
  });
}
