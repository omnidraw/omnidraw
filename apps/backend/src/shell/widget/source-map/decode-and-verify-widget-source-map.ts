import type { TraceMap } from '@jridgewell/trace-mapping';

export type TVerifiedWidgetSourceMap = Readonly<{
  digestSha256: string;
  sourceRevision: string;
  capsuleArtifactHash: `sha256:${string}`;
  authoredPaths: readonly string[];
  maps: readonly Readonly<{
    module: string;
    traceMap: TraceMap;
  }>[];
  retainedByteSize: number;
}>;

export type TEffects = Readonly<{
  decodeBase64(value: string): Uint8Array;
  digestSha256(value: Uint8Array): Promise<string>;
  decodeUtf8(value: Uint8Array): string;
  parseSourceMap(value: string): TraceMap;
}>;

export type TArgs = Readonly<{
  expectedDigestSha256: string;
  expectedCapsuleArtifactHash: `sha256:${string}`;
  expectedSourceRevision: string;
  bytes: Uint8Array;
}>;

const SAFE_PATH = /^(?=.{1,500}$)(?!(?:\.{1,2})(?:\/|$))[A-Za-z0-9@_+.,=~-]+(?:\/(?!(?:\.{1,2})(?:\/|$))[A-Za-z0-9@_+.,=~-]+)*$/u;
const GENERATED_MODULE = /\.(?:[cm]?js)$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

export async function decodeAndVerifyWidgetSourceMap(
  effects: TEffects,
  args: TArgs,
): Promise<TVerifiedWidgetSourceMap> {
  const bytes = new Uint8Array(args.bytes);
  if (bytes.byteLength < 1 || bytes.byteLength > 16 * 1_024 * 1_024) {
    throw new Error('Widget source-map artifact exceeds its safe size limit.');
  }
  if (await effects.digestSha256(bytes) !== args.expectedDigestSha256) {
    throw new Error('Widget source-map artifact digest mismatch.');
  }
  let payload: Readonly<Record<string, unknown>>;
  try {
    const parsed = record(JSON.parse(effects.decodeUtf8(bytes)));
    if (parsed === null) throw new TypeError();
    payload = parsed;
  } catch {
    throw new Error('Widget source-map artifact is malformed.');
  }
  const authoredPaths = payload.authoredPaths;
  const maps = payload.maps;
  if (
    payload.format !== 'omnidraw.widget-source-maps.v1'
    || payload.sourceRevision !== args.expectedSourceRevision
    || payload.capsuleArtifactHash !== args.expectedCapsuleArtifactHash
    || !SHA256.test(args.expectedSourceRevision)
    || !Array.isArray(authoredPaths)
    || authoredPaths.length < 1
    || authoredPaths.length > 1_024
    || authoredPaths.some((path) => typeof path !== 'string' || !SAFE_PATH.test(path))
    || new Set(authoredPaths).size !== authoredPaths.length
    || !Array.isArray(maps)
    || maps.length < 1
    || maps.length > 1_024
  ) {
    throw new Error('Widget source-map artifact provenance is invalid.');
  }
  const decodedMaps = maps.map((item) => {
    const entry = record(item);
    if (
      entry === null
      || typeof entry.module !== 'string'
      || !SAFE_PATH.test(entry.module)
      || !GENERATED_MODULE.test(entry.module)
      || typeof entry.mapBase64 !== 'string'
    ) throw new Error('Widget source-map entry is invalid.');
    const mapBytes = effects.decodeBase64(entry.mapBase64);
    if (mapBytes.byteLength < 1 || mapBytes.byteLength > 4 * 1_024 * 1_024) {
      throw new Error('Widget source-map entry exceeds its safe size limit.');
    }
    const json = effects.decodeUtf8(mapBytes);
    let map: Readonly<Record<string, unknown>> | null = null;
    try {
      map = record(JSON.parse(json));
    } catch {
      // Rejected by the complete structural check below.
    }
    if (
      map === null
      || map.version !== 3
      || !Array.isArray(map.sources)
      || map.sources.length > 4_096
      || map.sources.some((source) => typeof source !== 'string' || source.length > 2_000)
      || typeof map.mappings !== 'string'
      || map.mappings.length > 8 * 1_024 * 1_024
    ) throw new Error('Widget source-map payload is invalid.');
    try {
      return Object.freeze({
        module: entry.module,
        traceMap: effects.parseSourceMap(json),
      });
    } catch {
      throw new Error('Widget source-map payload is invalid.');
    }
  });
  if (new Set(decodedMaps.map(({ module }) => module)).size !== decodedMaps.length) {
    throw new Error('Widget source-map modules are duplicated.');
  }
  return Object.freeze({
    digestSha256: args.expectedDigestSha256,
    sourceRevision: args.expectedSourceRevision,
    capsuleArtifactHash: args.expectedCapsuleArtifactHash,
    authoredPaths: Object.freeze([...authoredPaths] as string[]),
    maps: Object.freeze(decodedMaps),
    retainedByteSize: bytes.byteLength,
  });
}
