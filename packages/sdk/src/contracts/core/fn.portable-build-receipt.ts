/** @file Pure canonical digests and identity checks for portable widget build receipts. */

import type {
  TWidgetBuildReceipt,
  TWidgetBuildReceiptOutput,
  TWidgetExecutableInputFile,
  TWidgetManifestV1,
} from '../filesystem/typed';
import {
  WIDGET_BUILD_FILE_COUNT_MAX,
  WIDGET_BUILD_FILE_MAX_BYTES,
  WIDGET_BUILD_RECEIPT_FORMAT,
  WIDGET_BUILD_RECEIPT_OUTPUT_COUNT_MAX,
  WIDGET_BUILD_RECEIPT_PATH,
  WIDGET_BUILD_TOTAL_BYTES_MAX,
} from '../CONSTANTS';
import {
  fnCanonicalizeWidgetExecutableManifest,
} from './fn.filesystem-manifest';
import {
  fnNormalizeWidgetFilesystemRelativePath,
} from './fn.filesystem-path';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SDK_VERSION_PATTERN = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]{1,80})?$/;

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

function uint32(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new TypeError('Widget portable build frame length is invalid.');
  }
  return Uint8Array.of(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );
}

function frame(name: string, bytes: Uint8Array): Uint8Array {
  const nameBytes = encodeUtf8(name);
  return concatenate([uint32(nameBytes.byteLength), nameBytes, uint32(bytes.byteLength), bytes]);
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const byteSize = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const bytes = new Uint8Array(byteSize);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function assertDigest(value: string, label: string): void {
  if (!SHA256_PATTERN.test(value)) throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
}

function normalizedInputFiles(
  files: readonly TWidgetExecutableInputFile[],
): readonly TWidgetExecutableInputFile[] {
  if (files.length < 1 || files.length > WIDGET_BUILD_FILE_COUNT_MAX) {
    throw new TypeError(`Widget portable input must contain between 1 and ${WIDGET_BUILD_FILE_COUNT_MAX} files.`);
  }
  let totalBytes = 0;
  const normalized = files.map((file) => {
    const path = fnNormalizeWidgetFilesystemRelativePath(file.path);
    if (
      path === null
      || path !== file.path
      || path === 'omnidraw.json'
      || path === '.DS_Store'
      || /^(?:\.git|\.omnidraw|dist|server-dist|node_modules)(?:\/|$)/.test(path)
    ) throw new TypeError(`Widget portable input contains excluded or unsafe path: ${file.path}`);
    if (file.bytes.byteLength > WIDGET_BUILD_FILE_MAX_BYTES) {
      throw new TypeError(`Widget portable input file is too large: ${path}`);
    }
    totalBytes += file.bytes.byteLength;
    if (totalBytes > WIDGET_BUILD_TOTAL_BYTES_MAX) {
      throw new TypeError('Widget portable input exceeds the total byte limit.');
    }
    return Object.freeze({ path, bytes: new Uint8Array(file.bytes) });
  }).sort((left, right) => compareText(left.path, right.path));
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1]!.path.toLowerCase() === normalized[index]!.path.toLowerCase()) {
      throw new TypeError(`Widget portable input contains a duplicate or case-colliding path: ${normalized[index]!.path}`);
    }
  }
  return Object.freeze(normalized);
}

export function fnCanonicalizeWidgetPortableSource(
  files: readonly TWidgetExecutableInputFile[],
): Uint8Array {
  const chunks: Uint8Array[] = [encodeUtf8('omnidraw.widget-portable-source.v1\0')];
  for (const file of normalizedInputFiles(files)) {
    chunks.push(frame('path', encodeUtf8(file.path)));
    chunks.push(frame('bytes', file.bytes));
  }
  return concatenate(chunks);
}

export function fnWidgetPortableSourceDigest(args: Readonly<{
  files: readonly TWidgetExecutableInputFile[];
  digestSha256(value: Uint8Array): string;
}>): string {
  const digest = args.digestSha256(fnCanonicalizeWidgetPortableSource(args.files));
  assertDigest(digest, 'Portable source digest');
  return digest;
}

export function fnCanonicalizeWidgetPortableExecutableInput(args: Readonly<{
  manifest: TWidgetManifestV1;
  files: readonly TWidgetExecutableInputFile[];
}>): Uint8Array {
  return concatenate([
    encodeUtf8('omnidraw.widget-portable-executable-input.v1\0'),
    frame('manifest', encodeUtf8(fnCanonicalizeWidgetExecutableManifest(args.manifest))),
    frame('source', fnCanonicalizeWidgetPortableSource(args.files)),
  ]);
}

export function fnWidgetPortableExecutableInputDigest(args: Readonly<{
  manifest: TWidgetManifestV1;
  files: readonly TWidgetExecutableInputFile[];
  digestSha256(value: Uint8Array): string;
}>): string {
  const digest = args.digestSha256(fnCanonicalizeWidgetPortableExecutableInput(args));
  assertDigest(digest, 'Portable executable-input digest');
  return digest;
}

export function fnNormalizeWidgetBuildReceiptOutputs(
  outputs: readonly TWidgetBuildReceiptOutput[],
): readonly TWidgetBuildReceiptOutput[] {
  if (outputs.length < 1 || outputs.length > WIDGET_BUILD_RECEIPT_OUTPUT_COUNT_MAX) {
    throw new TypeError('Widget build receipt output count is invalid.');
  }
  const normalized = outputs.map((output) => {
    const path = fnNormalizeWidgetFilesystemRelativePath(output.path);
    if (
      path === null
      || path !== output.path
      || !path.startsWith('dist/')
      || path === WIDGET_BUILD_RECEIPT_PATH
    ) throw new TypeError(`Widget build receipt contains an unsafe output path: ${output.path}`);
    if (!Number.isSafeInteger(output.byteSize) || output.byteSize < 0 || output.byteSize > WIDGET_BUILD_FILE_MAX_BYTES) {
      throw new TypeError(`Widget build receipt contains an invalid output size: ${path}`);
    }
    assertDigest(output.sha256, `Widget build receipt output '${path}' digest`);
    return Object.freeze({ path, byteSize: output.byteSize, sha256: output.sha256 });
  }).sort((left, right) => compareText(left.path, right.path));
  let totalBytes = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const output = normalized[index]!;
    totalBytes += output.byteSize;
    if (totalBytes > WIDGET_BUILD_TOTAL_BYTES_MAX) {
      throw new TypeError('Widget build receipt outputs exceed the total byte limit.');
    }
    if (
      index > 0
      && normalized[index - 1]!.path.toLowerCase() === output.path.toLowerCase()
    ) throw new TypeError(`Widget build receipt contains duplicate or case-colliding output: ${output.path}`);
  }
  return Object.freeze(normalized);
}

export function fnCanonicalizeWidgetBuildReceiptEvidence(
  receipt: Omit<TWidgetBuildReceipt, 'buildIdentity'>,
): string {
  assertDigest(receipt.sourceDigestSha256, 'Receipt source digest');
  assertDigest(receipt.manifestDigestSha256, 'Receipt manifest digest');
  assertDigest(receipt.executableInputDigestSha256, 'Receipt executable-input digest');
  if (!SDK_VERSION_PATTERN.test(receipt.sdkVersion)) throw new TypeError('Receipt SDK version is invalid.');
  return JSON.stringify({
    format: WIDGET_BUILD_RECEIPT_FORMAT,
    schemaVersion: 1,
    sourceDigestSha256: receipt.sourceDigestSha256,
    manifestDigestSha256: receipt.manifestDigestSha256,
    executableInputDigestSha256: receipt.executableInputDigestSha256,
    sdkVersion: receipt.sdkVersion,
    outputs: fnNormalizeWidgetBuildReceiptOutputs(receipt.outputs),
  });
}

export function fnCreateWidgetBuildReceipt(args: Readonly<{
  sourceDigestSha256: string;
  manifestDigestSha256: string;
  executableInputDigestSha256: string;
  sdkVersion: string;
  outputs: readonly TWidgetBuildReceiptOutput[];
  digestSha256(value: string): string;
}>): TWidgetBuildReceipt {
  const evidence = Object.freeze({
    format: WIDGET_BUILD_RECEIPT_FORMAT,
    schemaVersion: 1 as const,
    sourceDigestSha256: args.sourceDigestSha256,
    manifestDigestSha256: args.manifestDigestSha256,
    executableInputDigestSha256: args.executableInputDigestSha256,
    sdkVersion: args.sdkVersion,
    outputs: fnNormalizeWidgetBuildReceiptOutputs(args.outputs),
  });
  const buildIdentity = args.digestSha256(fnCanonicalizeWidgetBuildReceiptEvidence(evidence));
  assertDigest(buildIdentity, 'Receipt build identity');
  return Object.freeze({ ...evidence, buildIdentity });
}

export function fnCanonicalizeWidgetBuildReceipt(receipt: TWidgetBuildReceipt): string {
  return JSON.stringify({
    ...JSON.parse(fnCanonicalizeWidgetBuildReceiptEvidence(receipt)),
    buildIdentity: receipt.buildIdentity,
  });
}

export function fnWidgetBuildReceiptIdentityMatches(args: Readonly<{
  receipt: TWidgetBuildReceipt;
  digestSha256(value: string): string;
}>): boolean {
  if (!SHA256_PATTERN.test(args.receipt.buildIdentity)) return false;
  return args.receipt.buildIdentity
    === args.digestSha256(fnCanonicalizeWidgetBuildReceiptEvidence(args.receipt));
}

