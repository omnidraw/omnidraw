import { describe, expect, test } from 'bun:test';
import { fnDecodeWidgetUiArtifactEnvelope } from '../src/browser';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

function envelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: 'vibecanvas.widget-artifact.v1',
    kind: 'ui',
    entry: 'ui/main.ts',
    sourceDigestSha256: DIGEST_A,
    builderIdentity: 'bun-browser-v1',
    runtimeAbi: null,
    outputs: [{
      path: 'output-0.js',
      loader: 'js',
      kind: 'entry-point',
      digestSha256: DIGEST_B,
      bytesBase64: 'ZXhwb3J0IGRlZmF1bHQge307',
    }],
    ...overrides,
  });
}

describe('browser UI artifact envelope', () => {
  test('accepts one strict UI envelope and freezes decoded outputs', () => {
    const decoded = fnDecodeWidgetUiArtifactEnvelope(envelope());
    expect(decoded).toMatchObject({
      format: 'vibecanvas.widget-artifact.v1',
      kind: 'ui',
      entry: 'ui/main.ts',
      runtimeAbi: null,
    });
    expect(decoded.outputs).toHaveLength(1);
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.outputs)).toBe(true);
    expect(Object.isFrozen(decoded.outputs[0])).toBe(true);
  });

  test('rejects malformed, server, extended, and ambiguous envelopes', () => {
    expect(() => fnDecodeWidgetUiArtifactEnvelope('{')).toThrow('not valid JSON');
    expect(() => fnDecodeWidgetUiArtifactEnvelope(envelope({ kind: 'server' }))).toThrow('format or kind');
    expect(() => fnDecodeWidgetUiArtifactEnvelope(envelope({ runtimeAbi: 'vibecanvas:1' }))).toThrow('runtime ABI');
    expect(() => fnDecodeWidgetUiArtifactEnvelope(envelope({ serverPath: '/private/server.js' }))).toThrow('invalid shape');
    expect(() => fnDecodeWidgetUiArtifactEnvelope(envelope({ entry: '../server.ts' }))).toThrow('entry is invalid');
    expect(() => fnDecodeWidgetUiArtifactEnvelope(envelope({ outputs: [] }))).toThrow('outputs are invalid');
    expect(() => fnDecodeWidgetUiArtifactEnvelope(envelope({
      outputs: [
        {
          path: 'output-0.js', loader: 'js', kind: 'entry-point', digestSha256: DIGEST_A, bytesBase64: '',
        },
        {
          path: 'output-1.js', loader: 'js', kind: 'entry-point', digestSha256: DIGEST_B, bytesBase64: '',
        },
      ],
    }))).toThrow('exactly one JavaScript entry point');
  });

  test('rejects noncanonical output bytes, paths, digests, and extra fields', () => {
    const output = (patch: Record<string, unknown>) => ({
      path: 'output-0.js',
      loader: 'js',
      kind: 'entry-point',
      digestSha256: DIGEST_B,
      bytesBase64: '',
      ...patch,
    });
    expect(() => fnDecodeWidgetUiArtifactEnvelope(envelope({ outputs: [output({ bytesBase64: '***=' })] }))).toThrow('bytes are invalid');
    expect(() => fnDecodeWidgetUiArtifactEnvelope(envelope({ outputs: [output({ path: '../../server.js' })] }))).toThrow('path is invalid');
    expect(() => fnDecodeWidgetUiArtifactEnvelope(envelope({ outputs: [output({ digestSha256: DIGEST_B.toUpperCase() })] }))).toThrow('digest is invalid');
    expect(() => fnDecodeWidgetUiArtifactEnvelope(envelope({ outputs: [output({ serverBytes: 'secret' })] }))).toThrow('invalid shape');
  });

  test('bounds aggregate decoded output bytes', () => {
    const bytesBase64 = 'A'.repeat(4 * 1024 * 1024);
    const outputs = Array.from({ length: 6 }, (_, index) => ({
      path: `output-${index}.js`,
      loader: 'js',
      kind: index === 0 ? 'entry-point' : 'chunk',
      digestSha256: DIGEST_B,
      bytesBase64,
    }));
    expect(() => fnDecodeWidgetUiArtifactEnvelope(envelope({ outputs })))
      .toThrow('aggregate byte limit');
  }, 20_000);
});
