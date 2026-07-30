import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { TraceMap } from '@jridgewell/trace-mapping';
import { fnRuntimeDiagnosticSource } from '../../src/widget-runtime/fn.runtime-diagnostic-source';
import {
  fxDecodeAndVerifySourceMapArtifact,
} from '../../src/widget-runtime/fx.decode-and-verify-source-map-artifact';

const REVISION = 'a'.repeat(64);
const ARTIFACT_HASH = `sha256:${'b'.repeat(64)}` as const;

describe('trusted Preview source maps', () => {
  test('projects one allowlisted authored location with one-based product columns', () => {
    expect(fnRuntimeDiagnosticSource({
      generated: { module: 'main.js', line: 8, column: 2 },
      authoredPaths: ['src/App.tsx'],
      trace: () => ({
        source: '/private/build/src/App.tsx',
        line: 4,
        column: 6,
      }),
    })).toEqual({
      file: 'widget://src/App.tsx',
      line: 4,
      column: 7,
    });
  });

  test('rejects dependency, ambiguous, malformed, and internal coordinates', () => {
    for (const value of [
      fnRuntimeDiagnosticSource({
        generated: { module: '../internal.js', line: 1, column: 0 },
        authoredPaths: ['src/App.tsx'],
        trace: () => ({ source: 'src/App.tsx', line: 1, column: 0 }),
      }),
      fnRuntimeDiagnosticSource({
        generated: { module: 'main.js', line: 1, column: 0 },
        authoredPaths: ['src/index.ts'],
        trace: () => ({ source: 'node_modules/pkg/src/index.ts', line: 1, column: 0 }),
      }),
      fnRuntimeDiagnosticSource({
        generated: { module: 'main.js', line: 1, column: 0 },
        authoredPaths: ['src/index.ts', 'index.ts'],
        trace: () => ({ source: '/build/src/index.ts', line: 1, column: 0 }),
      }),
      fnRuntimeDiagnosticSource({
        generated: { module: 'main.js', line: 1, column: 0 },
        authoredPaths: ['src/App.tsx'],
        trace: () => ({ source: 'src/App.tsx', line: 10_000_001, column: 0 }),
      }),
      fnRuntimeDiagnosticSource({
        generated: { module: 'main.js', line: 1, column: 0 },
        authoredPaths: ['src/App.tsx'],
        trace: () => ({ source: 'src/App.tsx', line: 1, column: 10_000_000 }),
      }),
    ]) expect(value).toBeNull();
  });

  test('verifies the retained envelope against exact revision and artifact provenance', async () => {
    const map = JSON.stringify({
      version: 3,
      sources: ['src/App.tsx'],
      names: [],
      mappings: 'AAAA',
    });
    const envelope = Buffer.from(JSON.stringify({
      format: 'vibecanvas.widget-source-maps.v1',
      sourceRevision: REVISION,
      capsuleArtifactHash: ARTIFACT_HASH,
      authoredPaths: ['src/App.tsx'],
      maps: [{ module: 'main.js', mapBase64: Buffer.from(map).toString('base64') }],
    }));
    const digestSha256 = createHash('sha256').update(envelope).digest('hex');
    let parseCount = 0;
    const verified = await fxDecodeAndVerifySourceMapArtifact({
      codec: {
        decodeBase64: (value) => Uint8Array.from(Buffer.from(value, 'base64')),
        digestSha256: async (value) => createHash('sha256').update(value).digest('hex'),
      },
      decodeUtf8: (value) => Buffer.from(value).toString('utf8'),
      parseSourceMap: (value) => {
        parseCount += 1;
        return new TraceMap(value);
      },
    }, {
      expectedDigestSha256: digestSha256,
      expectedCapsuleArtifactHash: ARTIFACT_HASH,
      expectedSourceRevision: REVISION,
      bytesBase64: envelope.toString('base64'),
    });
    expect(verified).toMatchObject({
      digestSha256,
      capsuleArtifactHash: ARTIFACT_HASH,
      sourceRevision: REVISION,
      authoredPaths: ['src/App.tsx'],
      retainedByteSize: envelope.byteLength,
    });
    expect(parseCount).toBe(1);
    await expect(fxDecodeAndVerifySourceMapArtifact({
      codec: {
        decodeBase64: (value) => Uint8Array.from(Buffer.from(value, 'base64')),
        digestSha256: async (value) => createHash('sha256').update(value).digest('hex'),
      },
      decodeUtf8: (value) => Buffer.from(value).toString('utf8'),
      parseSourceMap: (value) => new TraceMap(value),
    }, {
      expectedDigestSha256: digestSha256,
      expectedCapsuleArtifactHash: ARTIFACT_HASH,
      expectedSourceRevision: 'c'.repeat(64),
      bytesBase64: envelope.toString('base64'),
    })).rejects.toThrow(/provenance/i);
  });
});
