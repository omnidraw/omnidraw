import { describe, expect, test } from 'bun:test';
import {
  WIDGET_SDK_CONFORMANCE_FIXTURE,
  WIDGET_SDK_CONFORMANCE_TRANSCRIPT,
  WIDGET_SDK_CONFORMANCE_VECTORS,
} from '../src/conformance';
import {
  WidgetManifestValidator,
  fnCanonicalizeWidgetExecutableProjection,
  fnCanonicalizeWidgetManifestV1,
  fnProjectWidgetExecutableManifest,
} from '../src';

describe('@omnidraw/sdk/conformance', () => {
  test('ships deterministic framework-neutral manifest and transcript vectors', () => {
    const manifest = WidgetManifestValidator.parse(WIDGET_SDK_CONFORMANCE_FIXTURE.manifest);
    expect(fnCanonicalizeWidgetManifestV1(manifest)).toBe(
      WIDGET_SDK_CONFORMANCE_VECTORS.find(({ name }) => name === 'canonical-manifest')?.expected,
    );
    expect(fnCanonicalizeWidgetExecutableProjection(
      fnProjectWidgetExecutableManifest(manifest),
    )).toBe(
      WIDGET_SDK_CONFORMANCE_VECTORS.find(({ name }) => name === 'canonical-executable-manifest')?.expected,
    );
    expect(WIDGET_SDK_CONFORMANCE_TRANSCRIPT.state.map(({ version }) => version)).toEqual([1, 2]);
    expect(WIDGET_SDK_CONFORMANCE_FIXTURE.files[0]?.text).not.toMatch(/react|three|capsule/i);
  });

  test('strict validators are library-neutral and reject unknown manifest authority', () => {
    const result = WidgetManifestValidator.safeParse({
      ...WIDGET_SDK_CONFORMANCE_FIXTURE.manifest,
      databaseUrl: 'file:ambient.db',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.name).toBe('SdkValidationError');
      expect(result.error.issues[0]?.code).toBe('unknown_key');
    }
  });
});
