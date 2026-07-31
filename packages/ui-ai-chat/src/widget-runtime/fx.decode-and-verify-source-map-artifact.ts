import type {
  TWidgetArtifactCodecPort,
  TVerifiedWidgetSourceMapArtifact,
} from './interface';
import type { TraceMap } from '@jridgewell/trace-mapping';

export type TPortal = Readonly<{
  codec: TWidgetArtifactCodecPort;
  decodeUtf8(value: Uint8Array): string;
  parseSourceMap(value: string): TraceMap;
}>;

export type TArgs = Readonly<{
  expectedDigestSha256: string;
  expectedCapsuleArtifactHash: `sha256:${string}`;
  expectedSourceRevision: string;
  bytesBase64: string;
}>;

const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\\)[A-Za-z0-9@_+.,=/~-]{1,500}$/u;
const GENERATED_MODULE = /\.(?:[cm]?js)$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

/**
 * Verifies the retained host-owned map envelope before any source-map parser
 * sees it. Guest bytes and event text never participate in this path.
 */
export async function fxDecodeAndVerifySourceMapArtifact(
  portal: TPortal,
  args: TArgs,
): Promise<TVerifiedWidgetSourceMapArtifact> {
  const bytes = portal.codec.decodeBase64(args.bytesBase64);
  if (bytes.byteLength < 1 || bytes.byteLength > 16 * 1_024 * 1_024) {
    throw new Error('Widget source-map artifact exceeds its safe size limit.');
  }
  if (await portal.codec.digestSha256(bytes) !== args.expectedDigestSha256) {
    throw new Error('Widget source-map artifact digest mismatch.');
  }
  let payload: Readonly<Record<string, unknown>>;
  try {
    const parsed = record(JSON.parse(portal.decodeUtf8(bytes)));
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
    ) {
      throw new Error('Widget source-map entry is invalid.');
    }
    const mapBytes = portal.codec.decodeBase64(entry.mapBase64);
    if (mapBytes.byteLength < 1 || mapBytes.byteLength > 4 * 1_024 * 1_024) {
      throw new Error('Widget source-map entry exceeds its safe size limit.');
    }
    const json = portal.decodeUtf8(mapBytes);
    let map: Readonly<Record<string, unknown>> | null = null;
    try {
      map = record(JSON.parse(json));
    } catch {
      // Rejected below.
    }
    if (
      map === null
      || map.version !== 3
      || !Array.isArray(map.sources)
      || map.sources.length > 4_096
      || map.sources.some((source) => typeof source !== 'string' || source.length > 2_000)
      || typeof map.mappings !== 'string'
      || map.mappings.length > 8 * 1_024 * 1_024
    ) {
      throw new Error('Widget source-map payload is invalid.');
    }
    try {
      return Object.freeze({
        module: entry.module,
        traceMap: portal.parseSourceMap(json),
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
