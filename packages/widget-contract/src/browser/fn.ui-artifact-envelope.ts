/** @file Strict, deterministic decoder for browser UI artifact envelopes. */

import type {
  TWidgetUiArtifactEnvelopeV1,
  TWidgetUiArtifactOutput,
  TWidgetUiArtifactOutputKind,
  TWidgetUiArtifactOutputLoader,
} from './types';

const ENVELOPE_KEYS = Object.freeze([
  'builderIdentity',
  'entry',
  'format',
  'kind',
  'outputs',
  'runtimeAbi',
  'sourceDigestSha256',
]);
const OUTPUT_KEYS = Object.freeze([
  'bytesBase64',
  'digestSha256',
  'kind',
  'loader',
  'path',
]);
const OUTPUT_LOADERS = new Set<TWidgetUiArtifactOutputLoader>(['js', 'css', 'json', 'wasm', 'file']);
const OUTPUT_KINDS = new Set<TWidgetUiArtifactOutputKind>(['entry-point', 'chunk', 'asset']);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const OUTPUT_PATH_PATTERN = /^output-(?:0|[1-9][0-9]{0,5})\.(?:js|css|json|wasm|bin)$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_ENVELOPE_TEXT_LENGTH = 32 * 1024 * 1024;
const MAX_OUTPUTS = 128;
const MAX_ENCODED_OUTPUT_BYTES = 24 * 1024 * 1024;
const MAX_AGGREGATE_DECODED_OUTPUT_BYTES = 16 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isSafeRelativeSourcePath(value: string): boolean {
  if (value.length < 1 || value.length > 1_000 || value.startsWith('/') || value.includes('\\')) return false;
  const parts = value.split('/');
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..' && !part.includes('\0'));
}

function isCanonicalBase64(value: string): boolean {
  return value.length <= MAX_ENCODED_OUTPUT_BYTES
    && value.length % 4 === 0
    && BASE64_PATTERN.test(value);
}

function decodedBase64ByteLength(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return value.length / 4 * 3 - padding;
}

function decodeOutput(value: unknown): TWidgetUiArtifactOutput {
  if (!isRecord(value) || !hasExactKeys(value, OUTPUT_KEYS)) {
    throw new TypeError('Widget UI artifact output has an invalid shape.');
  }
  if (typeof value.path !== 'string' || !OUTPUT_PATH_PATTERN.test(value.path)) {
    throw new TypeError('Widget UI artifact output path is invalid.');
  }
  if (typeof value.loader !== 'string' || !OUTPUT_LOADERS.has(value.loader as TWidgetUiArtifactOutputLoader)) {
    throw new TypeError('Widget UI artifact output loader is invalid.');
  }
  if (typeof value.kind !== 'string' || !OUTPUT_KINDS.has(value.kind as TWidgetUiArtifactOutputKind)) {
    throw new TypeError('Widget UI artifact output kind is invalid.');
  }
  if (typeof value.digestSha256 !== 'string' || !SHA256_PATTERN.test(value.digestSha256)) {
    throw new TypeError('Widget UI artifact output digest is invalid.');
  }
  if (typeof value.bytesBase64 !== 'string' || !isCanonicalBase64(value.bytesBase64)) {
    throw new TypeError('Widget UI artifact output bytes are invalid.');
  }
  return Object.freeze({
    path: value.path,
    loader: value.loader as TWidgetUiArtifactOutputLoader,
    kind: value.kind as TWidgetUiArtifactOutputKind,
    digestSha256: value.digestSha256,
    bytesBase64: value.bytesBase64,
  });
}

export function fnDecodeWidgetUiArtifactEnvelope(text: string): TWidgetUiArtifactEnvelopeV1 {
  if (text.length < 1 || text.length > MAX_ENVELOPE_TEXT_LENGTH) {
    throw new TypeError('Widget UI artifact envelope size is invalid.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError('Widget UI artifact envelope is not valid JSON.');
  }
  if (!isRecord(parsed) || !hasExactKeys(parsed, ENVELOPE_KEYS)) {
    throw new TypeError('Widget UI artifact envelope has an invalid shape.');
  }
  if (parsed.format !== 'vibecanvas.widget-artifact.v1' || parsed.kind !== 'ui') {
    throw new TypeError('Widget UI artifact envelope format or kind is invalid.');
  }
  if (typeof parsed.entry !== 'string' || !isSafeRelativeSourcePath(parsed.entry)) {
    throw new TypeError('Widget UI artifact entry is invalid.');
  }
  if (typeof parsed.sourceDigestSha256 !== 'string' || !SHA256_PATTERN.test(parsed.sourceDigestSha256)) {
    throw new TypeError('Widget UI artifact source digest is invalid.');
  }
  if (
    typeof parsed.builderIdentity !== 'string'
    || parsed.builderIdentity.length < 1
    || parsed.builderIdentity.length > 256
    || parsed.builderIdentity.trim() !== parsed.builderIdentity
  ) {
    throw new TypeError('Widget UI artifact builder identity is invalid.');
  }
  if (parsed.runtimeAbi !== null) {
    throw new TypeError('Widget UI artifacts cannot declare a server runtime ABI.');
  }
  if (!Array.isArray(parsed.outputs) || parsed.outputs.length < 1 || parsed.outputs.length > MAX_OUTPUTS) {
    throw new TypeError('Widget UI artifact outputs are invalid.');
  }
  const outputs = Object.freeze(parsed.outputs.map(decodeOutput));
  const aggregateDecodedBytes = outputs.reduce((size, output) => {
    return size + decodedBase64ByteLength(output.bytesBase64);
  }, 0);
  if (aggregateDecodedBytes > MAX_AGGREGATE_DECODED_OUTPUT_BYTES) {
    throw new TypeError('Widget UI artifact decoded outputs exceed the aggregate byte limit.');
  }
  const paths = new Set(outputs.map((output) => output.path));
  if (paths.size !== outputs.length) {
    throw new TypeError('Widget UI artifact output paths must be unique.');
  }
  const entrypoints = outputs.filter((output) => output.kind === 'entry-point' && output.loader === 'js');
  if (entrypoints.length !== 1) {
    throw new TypeError('Widget UI artifact must contain exactly one JavaScript entry point.');
  }
  return Object.freeze({
    format: 'vibecanvas.widget-artifact.v1',
    kind: 'ui',
    entry: parsed.entry,
    sourceDigestSha256: parsed.sourceDigestSha256,
    builderIdentity: parsed.builderIdentity,
    runtimeAbi: null,
    outputs,
  });
}
