import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import {
  ZWidgetBuildReceipt,
  fnCanonicalizeWidgetBuildReceipt,
  fnCreateWidgetBuildReceipt,
  fnWidgetBuildReceiptIdentityMatches,
  fnWidgetManifestV1Digest,
  fnWidgetPortableExecutableInputDigest,
  fnWidgetPortableSourceDigest,
  type TWidgetManifestV1,
} from '../index';

const digest = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const files = Object.freeze([
  Object.freeze({ path: 'package.json', bytes: new TextEncoder().encode('{"private":true}') }),
  Object.freeze({ path: 'ui/main.ts', bytes: new TextEncoder().encode('export const ready = true;\n') }),
]);
const manifest: TWidgetManifestV1 = Object.freeze({
  $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
  schemaVersion: 1,
  name: 'Receipt Test',
  slug: 'receipt-test',
  description: 'Portable receipt test.',
  tool: Object.freeze({ label: 'Receipt Test', group: null, priority: 0 }),
  ui: Object.freeze({ runtime: 'capsule', entry: 'ui/main.ts', apis: Object.freeze(['DOM'] as const) }),
});

describe('portable widget build receipt', () => {
  test('is deterministic across file and output order and verifies its evidence identity', () => {
    const sourceDigestSha256 = fnWidgetPortableSourceDigest({ files, digestSha256: digest });
    const executableInputDigestSha256 = fnWidgetPortableExecutableInputDigest({
      manifest,
      files,
      digestSha256: digest,
    });
    const manifestDigestSha256 = fnWidgetManifestV1Digest({ manifest, digestSha256: digest });
    const output = Object.freeze({
      path: 'dist/main.js',
      byteSize: 12,
      sha256: digest('output bytes'),
    });
    const receipt = fnCreateWidgetBuildReceipt({
      sourceDigestSha256,
      manifestDigestSha256,
      executableInputDigestSha256,
      sdkVersion: '0.10.0',
      outputs: [output],
      digestSha256: digest,
    });
    const reordered = fnCreateWidgetBuildReceipt({
      sourceDigestSha256: fnWidgetPortableSourceDigest({ files: [...files].reverse(), digestSha256: digest }),
      manifestDigestSha256,
      executableInputDigestSha256: fnWidgetPortableExecutableInputDigest({
        manifest,
        files: [...files].reverse(),
        digestSha256: digest,
      }),
      sdkVersion: '0.10.0',
      outputs: [output],
      digestSha256: digest,
    });

    expect(fnCanonicalizeWidgetBuildReceipt(reordered)).toBe(fnCanonicalizeWidgetBuildReceipt(receipt));
    expect(ZWidgetBuildReceipt.parse(JSON.parse(fnCanonicalizeWidgetBuildReceipt(receipt)))).toEqual(receipt);
    expect(fnWidgetBuildReceiptIdentityMatches({ receipt, digestSha256: digest })).toBe(true);
    expect(fnWidgetBuildReceiptIdentityMatches({
      receipt: { ...receipt, manifestDigestSha256: 'f'.repeat(64) },
      digestSha256: digest,
    })).toBe(false);
  });

  test('rejects generated inputs, unsafe outputs, duplicate output casing, and unbounded fields', () => {
    expect(() => fnWidgetPortableSourceDigest({
      files: [{ path: 'dist/main.js', bytes: new Uint8Array() }],
      digestSha256: digest,
    })).toThrow('excluded or unsafe');
    expect(() => fnCreateWidgetBuildReceipt({
      sourceDigestSha256: digest('source'),
      manifestDigestSha256: digest('manifest'),
      executableInputDigestSha256: digest('executable'),
      sdkVersion: '0.10.0',
      outputs: [
        { path: 'dist/Main.js', byteSize: 0, sha256: digest('a') },
        { path: 'dist/main.js', byteSize: 0, sha256: digest('b') },
      ],
      digestSha256: digest,
    })).toThrow('case-colliding');
    expect(() => ZWidgetBuildReceipt.parse({
      format: 'omnidraw.widget-build-receipt.v1',
      schemaVersion: 1,
      sourceDigestSha256: digest('source'),
      manifestDigestSha256: digest('manifest'),
      executableInputDigestSha256: digest('executable'),
      sdkVersion: '0.10.0',
      buildIdentity: digest('identity'),
      outputs: [{ path: '../main.js', byteSize: 1, sha256: digest('a') }],
    })).toThrow();
  });
});
