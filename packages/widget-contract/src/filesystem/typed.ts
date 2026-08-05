/**
 * @file Portable, database-free widget repository and publication contracts.
 */

import type { TResourceRequirement } from '@omnidraw/resource-runtime';
import type {
  TOmnidrawToolIcon,
  TWidgetCapsuleBuildIdentity,
  TWidgetCapsuleRuntimeDescriptor,
  TWidgetServerFunctionDescriptor,
  TWidgetServerManifest,
  TWidgetUiManifest,
} from '../types';

export type TWidgetManifestV1 = Readonly<{
  $schema: 'https://omnidraw.dev/schemas/widget/v1.json';
  schemaVersion: 1;
  name: string;
  slug: string;
  description: string;
  tool: Readonly<{
    label: string;
    icon?: TOmnidrawToolIcon;
    group: string | null;
    priority: number;
  }>;
  ui: TWidgetUiManifest;
  server?: TWidgetServerManifest;
  resources?: readonly TResourceRequirement[];
}>;

export type TWidgetPresentationProjection = Readonly<{
  $schema: 'https://omnidraw.dev/schemas/widget/v1.json';
  name: string;
  description: string;
  tool: Readonly<{
    label: string;
    icon: TOmnidrawToolIcon | null;
    group: string | null;
    priority: number;
  }>;
}>;

export type TWidgetExecutableManifestProjection = Readonly<{
  schemaVersion: 1;
  ui: TWidgetUiManifest;
  server: TWidgetServerManifest | null;
  resources: readonly TResourceRequirement[];
}>;

export type TWidgetExecutableInputFile = Readonly<{
  path: string;
  bytes: Uint8Array;
}>;

export type TWidgetBuildEnvironment = Readonly<{
  packageManager: Readonly<{
    name: string;
    version: string;
    lockfile: string;
    lockFormat: string;
  }>;
  sdkVersion: string;
  importMapDigestSha256: string;
  transformsDigestSha256: string;
  runner: Readonly<{
    kind: 'isolated' | 'host';
    identity: string;
  }>;
  platform: Readonly<{
    os: string;
    architecture: string;
  }>;
  capsuleBuildIdentity: TWidgetCapsuleBuildIdentity;
  buildPolicyId: string;
  signingPolicyId: string;
  serverRuntimeAbi: string | null;
}>;

export type TWidgetChangeClass =
  | 'presentation-only'
  | 'identity'
  | 'executable'
  | 'dependency'
  | 'resource-contract'
  | 'invalid'
  | 'ambiguous';

export type TWidgetChangeClassification = Readonly<{
  class: TWidgetChangeClass;
  changedPaths: readonly string[];
  reason: string;
}>;

export type TWidgetReleaseFile = Readonly<{
  path: string;
  byteSize: number;
  sha256: string;
}>;

export type TWidgetReleaseServer = Readonly<{
  entry: string;
  runtimeAbi: string;
  functionsPath: 'functions.json';
  serverDistDigestSha256: string;
  functionsDigestSha256: string;
}>;

export type TWidgetReleaseAttestation = Readonly<{
  algorithm: 'Ed25519';
  keyId: string;
  signatureBase64: string;
}>;

export type TWidgetUnsignedReleaseDescriptor = Readonly<{
  format: 'omnidraw.widget-release.v1';
  complete: true;
  executableManifestDigestSha256: string;
  files: readonly TWidgetReleaseFile[];
  capsule: Readonly<{
    path: 'capsule.artifact';
    artifactHash: `sha256:${string}`;
    runtime: TWidgetCapsuleRuntimeDescriptor;
  }>;
  server: TWidgetReleaseServer | null;
}>;

/**
 * The attestation signs the canonical complete descriptor above. Its sorted
 * file hashes bind the exact final signed Capsule bytes and every other
 * executable publication byte without introducing a second file manifest.
 */
export type TWidgetReleaseDescriptor = TWidgetUnsignedReleaseDescriptor & Readonly<{
  releaseAttestation: TWidgetReleaseAttestation;
}>;

export type TWidgetReleaseObservation = Readonly<{
  files: readonly TWidgetReleaseFile[];
  capsule: Readonly<{
    artifactHash: `sha256:${string}`;
    runtime: TWidgetCapsuleRuntimeDescriptor;
  }>;
  server: Readonly<{
    serverDistDigestSha256: string;
    functionsDigestSha256: string;
    functions: readonly TWidgetServerFunctionDescriptor[];
  }> | null;
}>;

export type TWidgetReleaseValidation =
  | Readonly<{ valid: true }>
  | Readonly<{
      valid: false;
      reason:
        | 'executable_manifest_digest_mismatch'
        | 'release_file_order_invalid'
        | 'release_file_path_invalid'
        | 'release_file_set_mismatch'
        | 'release_file_size_mismatch'
        | 'release_file_hash_mismatch'
        | 'capsule_file_missing'
        | 'capsule_identity_mismatch'
        | 'capsule_runtime_mismatch'
        | 'server_contract_mismatch'
        | 'server_file_missing'
        | 'server_digest_mismatch'
        | 'function_descriptors_invalid'
        | 'function_capability_mismatch';
      path?: string;
  }>;
