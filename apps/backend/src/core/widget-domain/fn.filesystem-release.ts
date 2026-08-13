/**
 * @file Pure exact-file and runtime validation for one current widget publication.
 */

import type {
  TWidgetManifestV1,
  TWidgetReleaseDescriptor,
  TWidgetReleaseAttestation,
  TWidgetReleaseFile,
  TWidgetReleaseObservation,
  TWidgetReleaseValidation,
  TWidgetUnsignedReleaseDescriptor,
} from './filesystem/typed';
import {
  fnNormalizeWidgetCapsuleRuntimeDescriptor,
} from './fn.capsule';
import {
  fnProjectWidgetBrowserFunctionDescriptors,
  fnValidateWidgetServerFunctionDescriptors,
  fnWidgetServerFunctionCapabilityRequestMatches,
} from './fn.function-descriptor';
import {
  fnNormalizeWidgetFilesystemRelativePath,
} from './fn.filesystem-path';

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateReleaseFileOrder(files: readonly TWidgetReleaseFile[]): TWidgetReleaseValidation {
  const caseFolded = new Set<string>();
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!;
    const normalized = fnNormalizeWidgetFilesystemRelativePath(file.path);
    if (
      normalized === null
      || !(
        normalized === 'capsule.artifact'
        || normalized === 'functions.json'
        || normalized.startsWith('dist/')
        || normalized.startsWith('server-dist/')
      )
    ) return { valid: false, reason: 'release_file_path_invalid', path: file.path };
    const folded = normalized.toLowerCase();
    if (caseFolded.has(folded)) {
      return { valid: false, reason: 'release_file_path_invalid', path: file.path };
    }
    caseFolded.add(folded);
    if (index > 0 && compareText(files[index - 1]!.path, file.path) >= 0) {
      return { valid: false, reason: 'release_file_order_invalid', path: file.path };
    }
  }
  return { valid: true };
}

function fileByPath(
  files: readonly TWidgetReleaseFile[],
): ReadonlyMap<string, TWidgetReleaseFile> | null {
  const result = new Map<string, TWidgetReleaseFile>();
  for (const file of files) {
    if (result.has(file.path)) return null;
    result.set(file.path, file);
  }
  return result;
}

/**
 * Canonical directory identity used by both publication and startup scanning.
 * Paths are relative to the directory whose contents are being identified.
 */
export function fnCanonicalizeWidgetReleaseDirectoryFiles(
  files: readonly TWidgetReleaseFile[],
): string {
  const normalized = files.map((file) => {
    const path = fnNormalizeWidgetFilesystemRelativePath(file.path);
    if (
      path === null
      || path.startsWith('dist/')
      || path.startsWith('server-dist/')
      || !Number.isSafeInteger(file.byteSize)
      || file.byteSize < 0
      || !SHA256_PATTERN.test(file.sha256)
    ) throw new TypeError(`Invalid release directory file: ${file.path}`);
    return { path, byteSize: file.byteSize, sha256: file.sha256 };
  }).sort((left, right) => compareText(left.path, right.path));
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1]!.path.toLowerCase() === normalized[index]!.path.toLowerCase()) {
      throw new TypeError(`Duplicate release directory file: ${normalized[index]!.path}`);
    }
  }
  return JSON.stringify(normalized);
}

export function fnWidgetReleaseDirectoryDigest(args: Readonly<{
  files: readonly TWidgetReleaseFile[];
  digestSha256(value: string): string;
}>): string {
  const digest = args.digestSha256(fnCanonicalizeWidgetReleaseDirectoryFiles(args.files));
  if (!SHA256_PATTERN.test(digest)) {
    throw new TypeError('Release directory digest must be a lowercase SHA-256 digest.');
  }
  return digest;
}

export function fnCreateWidgetUnsignedReleaseDescriptor(
  args: Omit<TWidgetUnsignedReleaseDescriptor, 'format' | 'complete' | 'files'> & Readonly<{
    files: readonly TWidgetReleaseFile[];
  }>,
): TWidgetUnsignedReleaseDescriptor {
  return {
    format: 'omnidraw.widget-release.v1',
    complete: true,
    executableManifestDigestSha256: args.executableManifestDigestSha256,
    files: [...args.files]
      .sort((left, right) => compareText(left.path, right.path))
      .map((file) => ({
        path: file.path,
        byteSize: file.byteSize,
        sha256: file.sha256,
      })),
    capsule: {
      path: 'capsule.artifact',
      artifactHash: args.capsule.artifactHash,
      runtime: fnNormalizeWidgetCapsuleRuntimeDescriptor(args.capsule.runtime),
    },
    server: args.server === null ? null : {
      entry: args.server.entry,
      runtimeAbi: args.server.runtimeAbi,
      functionsPath: 'functions.json',
      serverDistDigestSha256: args.server.serverDistDigestSha256,
      functionsDigestSha256: args.server.functionsDigestSha256,
    },
  };
}

export function fnCanonicalizeWidgetUnsignedReleaseDescriptor(
  release: TWidgetUnsignedReleaseDescriptor,
): string {
  return JSON.stringify(fnCreateWidgetUnsignedReleaseDescriptor(release));
}

export function fnCreateWidgetReleaseDescriptor(
  args: Omit<
    TWidgetUnsignedReleaseDescriptor,
    'format' | 'complete' | 'files'
  > & Readonly<{
    files: readonly TWidgetReleaseFile[];
    releaseAttestation: TWidgetReleaseAttestation;
  }>,
): TWidgetReleaseDescriptor {
  return {
    ...fnCreateWidgetUnsignedReleaseDescriptor(args),
    releaseAttestation: {
      algorithm: args.releaseAttestation.algorithm,
      keyId: args.releaseAttestation.keyId,
      signatureBase64: args.releaseAttestation.signatureBase64,
    },
  };
}

export function fnCanonicalizeWidgetReleaseDescriptor(
  release: TWidgetReleaseDescriptor,
): string {
  return JSON.stringify(fnCreateWidgetReleaseDescriptor(release));
}

export function fnValidateWidgetRelease(args: Readonly<{
  manifest: TWidgetManifestV1;
  expectedExecutableManifestDigestSha256: string;
  release: TWidgetReleaseDescriptor;
  observation: TWidgetReleaseObservation;
}>): TWidgetReleaseValidation {
  if (
    args.release.executableManifestDigestSha256
    !== args.expectedExecutableManifestDigestSha256
  ) return { valid: false, reason: 'executable_manifest_digest_mismatch' };

  const order = validateReleaseFileOrder(args.release.files);
  if (!order.valid) return order;
  if (!args.release.files.some((file) => file.path.startsWith('dist/'))) {
    return { valid: false, reason: 'release_file_set_mismatch', path: 'dist/' };
  }
  const expectedFiles = fileByPath(args.release.files);
  const observedFiles = fileByPath(args.observation.files);
  if (expectedFiles === null || observedFiles === null) {
    return { valid: false, reason: 'release_file_set_mismatch' };
  }
  if (expectedFiles.size !== observedFiles.size) {
    return { valid: false, reason: 'release_file_set_mismatch' };
  }
  for (const [path, expected] of expectedFiles) {
    const observed = observedFiles.get(path);
    if (observed === undefined) {
      return { valid: false, reason: 'release_file_set_mismatch', path };
    }
    if (observed.byteSize !== expected.byteSize) {
      return { valid: false, reason: 'release_file_size_mismatch', path };
    }
    if (observed.sha256 !== expected.sha256) {
      return { valid: false, reason: 'release_file_hash_mismatch', path };
    }
  }

  if (!expectedFiles.has(args.release.capsule.path)) {
    return { valid: false, reason: 'capsule_file_missing', path: args.release.capsule.path };
  }
  if (
    args.release.capsule.artifactHash !== args.observation.capsule.artifactHash
    || args.release.capsule.runtime.capsuleArtifactHash !== args.release.capsule.artifactHash
  ) return { valid: false, reason: 'capsule_identity_mismatch' };
  if (!sameValue(
    fnNormalizeWidgetCapsuleRuntimeDescriptor(args.release.capsule.runtime),
    fnNormalizeWidgetCapsuleRuntimeDescriptor(args.observation.capsule.runtime),
  )) return { valid: false, reason: 'capsule_runtime_mismatch' };

  const hasServerFiles = args.release.files.some((file) => (
    file.path === 'functions.json' || file.path.startsWith('server-dist/')
  ));
  if (args.manifest.server === undefined) {
    if (
      args.release.server !== null
      || args.observation.server !== null
      || hasServerFiles
    ) return { valid: false, reason: 'server_contract_mismatch' };
    if (!fnWidgetServerFunctionCapabilityRequestMatches(
      '0'.repeat(64),
      [],
      args.release.capsule.runtime.capabilityRequests,
    )) return { valid: false, reason: 'function_capability_mismatch' };
    return { valid: true };
  }
  if (args.release.server === null || args.observation.server === null) {
    return { valid: false, reason: 'server_contract_mismatch' };
  }
  if (args.release.server.runtimeAbi !== args.manifest.server.runtimeAbi) {
    return { valid: false, reason: 'server_contract_mismatch' };
  }
  if (
    !expectedFiles.has(args.release.server.entry)
    || !expectedFiles.has(args.release.server.functionsPath)
  ) return { valid: false, reason: 'server_file_missing' };
  if (
    args.release.server.functionsDigestSha256
      !== expectedFiles.get(args.release.server.functionsPath)!.sha256
    || args.release.server.serverDistDigestSha256
      !== args.observation.server.serverDistDigestSha256
    || args.release.server.functionsDigestSha256
      !== args.observation.server.functionsDigestSha256
  ) return { valid: false, reason: 'server_digest_mismatch' };
  const functionValidation = fnValidateWidgetServerFunctionDescriptors(
    args.manifest,
    args.observation.server.functions,
  );
  if (!functionValidation.valid) {
    return { valid: false, reason: 'function_descriptors_invalid' };
  }
  if (!fnWidgetServerFunctionCapabilityRequestMatches(
    args.release.server.functionsDigestSha256,
    fnProjectWidgetBrowserFunctionDescriptors(args.observation.server.functions),
    args.release.capsule.runtime.capabilityRequests,
  )) return { valid: false, reason: 'function_capability_mismatch' };
  return { valid: true };
}
