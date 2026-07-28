import type {
  TWidgetCapsuleBuildIdentity,
  TWidgetCapsuleHash,
} from '../types';

export type TWidgetPreviewBuildEnvironment = Readonly<{
  runnerIdentity: string;
  nodeVersion: string;
  packageManager: string;
  packageManagerVersion: string;
  platform: string;
  architecture: string;
}>;

export type TWidgetPreviewBuildKeyInput = Readonly<{
  sourceDigestSha256: string;
  canonicalManifestJson: string;
  dependencyLockDigest: TWidgetCapsuleHash;
  sdkContractIdentity: string;
  generatedContractDigest: TWidgetCapsuleHash;
  builderIdentity: string;
  capsuleBuildIdentity: TWidgetCapsuleBuildIdentity;
  buildPolicyId: string;
  approvedTransformsDigest: TWidgetCapsuleHash;
  buildConfigurationDigest: TWidgetCapsuleHash;
  environment: TWidgetPreviewBuildEnvironment;
}>;

/**
 * Inputs known before guest execution at the authoritative construction cache.
 *
 * The source digest binds every captured file, including the lockfile, SDK,
 * manifest, contracts, and project configuration. The injected environment
 * identity binds the selected runner/toolchain plus host-approved transforms
 * and build configuration.
 */
export type TWidgetPreviewConstructionKeyInput = Readonly<{
  tenant: Readonly<{
    orgId: string;
    accountId: string;
    cellId: string;
    placementEpoch: number;
  }>;
  sourceDigestSha256: string;
  canonicalManifestJson: string;
  builderIdentity: string;
  capsuleBuildIdentity: TWidgetCapsuleBuildIdentity;
  buildPolicyId: string;
  environmentIdentity: string;
}>;

export type TWidgetPreviewWorkspaceKeyInput = Readonly<{
  tenant: Readonly<{
    orgId: string;
    accountId: string;
    cellId: string;
    placementEpoch: number;
  }>;
  draftId: string;
}>;

type TArgsBuildKey = Readonly<{
  input: TWidgetPreviewBuildKeyInput;
  digestSha256(value: string): string;
}>;

type TArgsConstructionKey = Readonly<{
  input: TWidgetPreviewConstructionKeyInput;
  digestSha256(value: string): string;
}>;

export function fnCanonicalizeWidgetPreviewBuildKey(
  input: TWidgetPreviewBuildKeyInput,
): string {
  return JSON.stringify({
    approvedTransformsDigest: input.approvedTransformsDigest,
    buildConfigurationDigest: input.buildConfigurationDigest,
    buildPolicyId: input.buildPolicyId,
    builderIdentity: input.builderIdentity,
    canonicalManifestJson: input.canonicalManifestJson,
    capsuleBuildIdentity: {
      buildApiVersion: input.capsuleBuildIdentity.buildApiVersion,
      packageDigest: input.capsuleBuildIdentity.packageDigest,
      packageName: input.capsuleBuildIdentity.packageName,
      packageVersion: input.capsuleBuildIdentity.packageVersion,
      runtimeBuildDigest: input.capsuleBuildIdentity.runtimeBuildDigest,
    },
    dependencyLockDigest: input.dependencyLockDigest,
    environment: {
      architecture: input.environment.architecture,
      nodeVersion: input.environment.nodeVersion,
      packageManager: input.environment.packageManager,
      packageManagerVersion: input.environment.packageManagerVersion,
      platform: input.environment.platform,
      runnerIdentity: input.environment.runnerIdentity,
    },
    generatedContractDigest: input.generatedContractDigest,
    sdkContractIdentity: input.sdkContractIdentity,
    sourceDigestSha256: input.sourceDigestSha256,
  });
}

export function fnWidgetPreviewBuildKey(args: TArgsBuildKey): string {
  return args.digestSha256(fnCanonicalizeWidgetPreviewBuildKey(args.input));
}

export function fnCanonicalizeWidgetPreviewConstructionKey(
  input: TWidgetPreviewConstructionKeyInput,
): string {
  return JSON.stringify({
    buildPolicyId: input.buildPolicyId,
    builderIdentity: input.builderIdentity,
    canonicalManifestJson: input.canonicalManifestJson,
    capsuleBuildIdentity: {
      buildApiVersion: input.capsuleBuildIdentity.buildApiVersion,
      packageDigest: input.capsuleBuildIdentity.packageDigest,
      packageName: input.capsuleBuildIdentity.packageName,
      packageVersion: input.capsuleBuildIdentity.packageVersion,
      runtimeBuildDigest: input.capsuleBuildIdentity.runtimeBuildDigest,
    },
    environmentIdentity: input.environmentIdentity,
    sourceDigestSha256: input.sourceDigestSha256,
    tenant: {
      accountId: input.tenant.accountId,
      cellId: input.tenant.cellId,
      orgId: input.tenant.orgId,
      placementEpoch: input.tenant.placementEpoch,
    },
  });
}

export function fnWidgetPreviewConstructionKey(
  args: TArgsConstructionKey,
): string {
  return args.digestSha256(
    fnCanonicalizeWidgetPreviewConstructionKey(args.input),
  );
}

/** Stable private dependency-workspace identity shared by validation and Preview. */
export function fnWidgetPreviewWorkspaceKey(
  args: Readonly<{
    input: TWidgetPreviewWorkspaceKeyInput;
    digestSha256(value: string): string;
  }>,
): string {
  return `preview-${args.digestSha256(JSON.stringify({
    orgId: args.input.tenant.orgId,
    accountId: args.input.tenant.accountId,
    cellId: args.input.tenant.cellId,
    placementEpoch: args.input.tenant.placementEpoch,
    draftId: args.input.draftId,
  }))}`;
}
