/** @file Pure bounded, versioned binary framing for exact executable inputs. */

import type {
  TWidgetBuildEnvironment,
  TWidgetExecutableInputFile,
  TWidgetManifestV1,
} from './filesystem/typed';
import {
  WIDGET_BUILD_FILE_COUNT_MAX,
  WIDGET_BUILD_FILE_MAX_BYTES,
  WIDGET_BUILD_TOTAL_BYTES_MAX,
} from './CONSTANTS';
import {
  fnCanonicalizeWidgetExecutableManifest,
} from './fn.filesystem-manifest';
import {
  fnNormalizeWidgetFilesystemRelativePath,
} from './fn.filesystem-path';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function encodeUtf8(value: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x7f) bytes.push(codePoint);
    else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

function uint32Bytes(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new TypeError('Widget executable frame length is out of range.');
  }
  return Uint8Array.of(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );
}

function framedField(name: string, value: Uint8Array): readonly Uint8Array[] {
  const nameBytes = encodeUtf8(name);
  return [uint32Bytes(nameBytes.byteLength), nameBytes, uint32Bytes(value.byteLength), value];
}

function concatenateBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((size, chunk) => size + chunk.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function assertDigest(value: string, field: string): void {
  if (!SHA256_PATTERN.test(value)) throw new TypeError(`${field} must be a lowercase SHA-256 digest.`);
}

export function fnCanonicalizeWidgetExecutableInput(args: Readonly<{
  manifest: TWidgetManifestV1;
  files: readonly TWidgetExecutableInputFile[];
  environment: TWidgetBuildEnvironment;
}>): Uint8Array {
  assertDigest(args.environment.importMapDigestSha256, 'Import-map digest');
  assertDigest(args.environment.transformsDigestSha256, 'Transform digest');
  assertDigest(args.environment.capsuleBuildIdentity.packageDigest.replace(/^sha256:/, ''), 'Capsule package digest');
  assertDigest(args.environment.capsuleBuildIdentity.runtimeBuildDigest.replace(/^sha256:/, ''), 'Capsule runtime-build digest');
  if (args.files.length > WIDGET_BUILD_FILE_COUNT_MAX) {
    throw new TypeError(`Widget build input exceeds ${WIDGET_BUILD_FILE_COUNT_MAX} files.`);
  }
  let totalFileBytes = 0;
  const files = [...args.files].map((file) => {
    const path = fnNormalizeWidgetFilesystemRelativePath(file.path);
    if (path === null) throw new TypeError(`Unsafe widget build path: ${file.path}`);
    if (
      path === 'omnidraw.json'
      || path === '.DS_Store'
      || /^(?:\.git|\.omnidraw|dist|server-dist|node_modules)(?:\/|$)/.test(path)
    ) throw new TypeError(`Widget build input contains excluded path: ${path}`);
    if (file.bytes.byteLength > WIDGET_BUILD_FILE_MAX_BYTES) {
      throw new TypeError(`Widget build input file is too large: ${path}`);
    }
    totalFileBytes += file.bytes.byteLength;
    if (totalFileBytes > WIDGET_BUILD_TOTAL_BYTES_MAX) {
      throw new TypeError('Widget build input exceeds the total byte limit.');
    }
    return { path, bytes: file.bytes };
  }).sort((left, right) => compareText(left.path, right.path));
  for (let index = 1; index < files.length; index += 1) {
    if (files[index - 1]!.path === files[index]!.path) {
      throw new TypeError(`Duplicate widget build path: ${files[index]!.path}`);
    }
  }
  const environment = JSON.stringify({
    packageManager: args.environment.packageManager,
    sdkVersion: args.environment.sdkVersion,
    importMapDigestSha256: args.environment.importMapDigestSha256,
    transformsDigestSha256: args.environment.transformsDigestSha256,
    runner: args.environment.runner,
    platform: args.environment.platform,
    capsuleBuildIdentity: args.environment.capsuleBuildIdentity,
    buildPolicyId: args.environment.buildPolicyId,
    signingPolicyId: args.environment.signingPolicyId,
    serverRuntimeAbi: args.environment.serverRuntimeAbi,
  });
  const chunks: Uint8Array[] = [encodeUtf8('omnidraw.widget-executable-input.v1\0')];
  chunks.push(...framedField('executable-manifest', encodeUtf8(fnCanonicalizeWidgetExecutableManifest(args.manifest))));
  for (const file of files) {
    chunks.push(...framedField('file-path', encodeUtf8(file.path)));
    chunks.push(...framedField('file-bytes', file.bytes));
  }
  chunks.push(...framedField('build-environment', encodeUtf8(environment)));
  return concatenateBytes(chunks);
}

export function fnWidgetExecutableInputDigest(args: Readonly<{
  manifest: TWidgetManifestV1;
  files: readonly TWidgetExecutableInputFile[];
  environment: TWidgetBuildEnvironment;
  digestSha256(value: Uint8Array): string;
}>): string {
  const digest = args.digestSha256(fnCanonicalizeWidgetExecutableInput(args));
  assertDigest(digest, 'Executable input digest');
  return digest;
}
