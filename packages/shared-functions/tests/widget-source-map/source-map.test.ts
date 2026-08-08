import { describe, expect, test } from 'bun:test';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { createHash } from 'node:crypto';
import {
  fxDecodeAndVerifyWidgetSourceMap,
} from '../../src/widget-source-map/fx.decode-and-verify-widget-source-map';
import {
  fnRuntimeDiagnosticSource,
} from '../../src/widget-source-map/fn.runtime-diagnostic-source';

const REVISION = 'a'.repeat(64);
const CAPSULE_HASH = `sha256:${'b'.repeat(64)}` as const;

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function envelope(
  authoredPath = 'src/main.ts',
  module = 'main.js',
): Uint8Array {
  const map = Buffer.from(JSON.stringify({
    version: 3,
    sources: [authoredPath],
    names: [],
    mappings: 'AAAA',
  })).toString('base64');
  return new TextEncoder().encode(JSON.stringify({
    format: 'omnidraw.widget-source-maps.v1',
    sourceRevision: REVISION,
    capsuleArtifactHash: CAPSULE_HASH,
    authoredPaths: [authoredPath],
    maps: [{ module, mapBase64: map }],
  }));
}

const portal = {
  decodeBase64: (value: string) => Uint8Array.from(Buffer.from(value, 'base64')),
  digestSha256: async (value: Uint8Array) => sha256(value),
  decodeUtf8: (value: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(value),
  parseSourceMap: (value: string) => new TraceMap(value),
};

describe('verified widget source-map helpers', () => {
  test('maps one fenced generated coordinate to an allowlisted widget path', async () => {
    const bytes = envelope();
    const verified = await fxDecodeAndVerifyWidgetSourceMap(portal, {
      expectedDigestSha256: sha256(bytes),
      expectedCapsuleArtifactHash: CAPSULE_HASH,
      expectedSourceRevision: REVISION,
      bytes,
    });
    const mapped = fnRuntimeDiagnosticSource({
      generated: { module: 'main.js', line: 1, column: 0 },
      authoredPaths: verified.authoredPaths,
      trace: ({ line, column }) => originalPositionFor(
        verified.maps[0]!.traceMap,
        { line, column },
      ),
    });

    expect(mapped).toEqual({ file: 'widget://src/main.ts', line: 1, column: 1 });
  });

  test('rejects digest drift and never maps host or dependency paths', async () => {
    const bytes = envelope();
    await expect(fxDecodeAndVerifyWidgetSourceMap(portal, {
      expectedDigestSha256: '0'.repeat(64),
      expectedCapsuleArtifactHash: CAPSULE_HASH,
      expectedSourceRevision: REVISION,
      bytes,
    })).rejects.toThrow('digest mismatch');

    expect(fnRuntimeDiagnosticSource({
      generated: { module: '/private/tmp/main.js', line: 1, column: 0 },
      authoredPaths: ['src/main.ts'],
      trace: () => ({ source: 'src/main.ts', line: 1, column: 0 }),
    })).toBeNull();
    expect(fnRuntimeDiagnosticSource({
      generated: { module: 'main.js', line: 1, column: 0 },
      authoredPaths: ['src/main.ts'],
      trace: () => ({ source: 'node_modules/pkg/index.ts', line: 1, column: 0 }),
    })).toBeNull();
  });

  test('accepts safe package-style filenames and rejects empty path segments', async () => {
    const authoredPath = 'src/@scope/foo+bar,theme=light~v1.ts';
    const bytes = envelope(authoredPath, 'chunks/@scope/widget+entry.js');
    const verified = await fxDecodeAndVerifyWidgetSourceMap(portal, {
      expectedDigestSha256: sha256(bytes),
      expectedCapsuleArtifactHash: CAPSULE_HASH,
      expectedSourceRevision: REVISION,
      bytes,
    });
    expect(fnRuntimeDiagnosticSource({
      generated: { module: 'chunks/@scope/widget+entry.js', line: 1, column: 0 },
      authoredPaths: verified.authoredPaths,
      trace: () => ({ source: authoredPath, line: 4, column: 2 }),
    })).toEqual({ file: `widget://${authoredPath}`, line: 4, column: 3 });

    expect(fnRuntimeDiagnosticSource({
      generated: { module: 'chunks//widget.js', line: 1, column: 0 },
      authoredPaths: ['src//main.ts'],
      trace: () => ({ source: 'src//main.ts', line: 1, column: 0 }),
    })).toBeNull();
  });
});
