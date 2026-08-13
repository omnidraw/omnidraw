export type TWidgetSourceMapPayloadInput = Readonly<{
  sourceRevision: string;
  capsuleArtifactHash: `sha256:${string}`;
  authoredPaths: readonly string[];
  maps: readonly Readonly<{
    module: string;
    mapBase64: string;
  }>[];
}>;

const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\\)[A-Za-z0-9@_+.,=/~-]{1,500}$/u;
const GENERATED_MODULE = /\.(?:[cm]?js)$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const CAPSULE_HASH = /^sha256:[a-f0-9]{64}$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const MAX_SOURCE_MAP_BASE64_LENGTH = 5_592_408;

/**
 * Validates and canonically encodes trusted source maps kept outside the guest.
 * Map contents stay opaque here and are consumed only by the Preview host.
 */
export function fnCanonicalizeWidgetSourceMapArtifact(
  input: TWidgetSourceMapPayloadInput,
): string {
  if (!SHA256.test(input.sourceRevision) || !CAPSULE_HASH.test(input.capsuleArtifactHash)) {
    throw new TypeError('Widget source-map provenance is invalid.');
  }
  const authoredPaths = [...new Set(input.authoredPaths)].sort();
  if (
    authoredPaths.length < 1
    || authoredPaths.length > 1_024
    || authoredPaths.some((path) => !SAFE_PATH.test(path))
  ) {
    throw new TypeError('Widget source-map authored paths are invalid.');
  }
  const maps = [...input.maps].sort((left, right) => left.module.localeCompare(right.module));
  if (
    maps.length < 1
    || maps.length > 1_024
    || maps.some(({ module, mapBase64 }) => (
      !SAFE_PATH.test(module)
      || !GENERATED_MODULE.test(module)
      || mapBase64.length < 4
      || mapBase64.length > MAX_SOURCE_MAP_BASE64_LENGTH
      || !BASE64.test(mapBase64)
    ))
    || new Set(maps.map(({ module }) => module)).size !== maps.length
  ) {
    throw new TypeError('Widget source-map entries are invalid.');
  }
  return JSON.stringify({
    format: 'omnidraw.widget-source-maps.v1',
    sourceRevision: input.sourceRevision,
    capsuleArtifactHash: input.capsuleArtifactHash,
    authoredPaths,
    maps,
  });
}
