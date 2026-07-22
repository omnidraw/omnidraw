import type {
  TWidgetBuildResult,
  TWidgetManifestV2,
  TWidgetSourceSnapshot,
} from '../types';
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
        | 'function_descriptors_invalid'
        | 'function_descriptors_digest_mismatch'
        | 'contract_digest_mismatch';
    }>;

export type TWidgetBuildIntegrityArgs = Readonly<{
  snapshot: TWidgetSourceSnapshot;
  manifest: TWidgetManifestV2;
  canonicalManifestJson: string;
  builderIdentity: string;
  build: TWidgetBuildResult;
  digestSha256: (canonicalValue: string) => string;
}>;

/** Validates that one build result is bound to its exact immutable inputs and contract. */
export function fnValidateWidgetBuildIntegrity(
  args: TWidgetBuildIntegrityArgs,
): TWidgetBuildIntegrityValidation {
  if (
    args.build.sourceSnapshotId !== args.snapshot.id
    || args.build.sourceDigestSha256 !== args.snapshot.digestSha256
    || args.build.canonicalManifestJson !== args.canonicalManifestJson
    || args.build.builderIdentity !== args.builderIdentity
  ) return { valid: false, reason: 'immutable_input_mismatch' };

  if (
    args.build.uiArtifact.kind !== 'ui'
    || (args.manifest.server === undefined) !== (args.build.serverArtifact === null)
    || (args.build.serverArtifact !== null && args.build.serverArtifact.kind !== 'server')
  ) return { valid: false, reason: 'artifact_set_mismatch' };

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

  const contractDigestSha256 = args.digestSha256(fnCanonicalizeWidgetContractPayload({
    canonicalManifestJson: args.canonicalManifestJson,
    uiDigestSha256: args.build.uiArtifact.digestSha256,
    serverDigestSha256: args.build.serverArtifact?.digestSha256 ?? null,
    runtimeAbi: args.manifest.server?.runtimeAbi ?? null,
    functionDescriptorsDigestSha256,
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
