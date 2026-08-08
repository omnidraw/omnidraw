import { describe, expect, test } from 'bun:test';
import { PREVIEW_INSPECTION_LIMITS } from '../src/services/preview-inspection/CONSTANTS';
import { fnValidatePreviewInspectionPng } from '../src/services/preview-inspection/fn.png';
import { createPngFixture } from './preview-inspection.png-fixture';

const PNG_1024_768 = createPngFixture(1_024, 768);
const PNG_512_384 = createPngFixture(512, 384);

describe('preview inspection PNG validation', () => {
  test('accepts PNG signature and exact IHDR dimensions', () => {
    expect(fnValidatePreviewInspectionPng({
      bytes: PNG_1024_768,
      expectedWidth: 1_024,
      expectedHeight: 768,
    })).toEqual({
      ok: true,
      width: 1_024,
      height: 768,
      byteSize: PNG_1024_768.byteLength,
    });
  });

  test('rejects malformed bytes and dimension drift', () => {
    expect(fnValidatePreviewInspectionPng({
      bytes: new Uint8Array(33),
      expectedWidth: 512,
      expectedHeight: 384,
    })).toMatchObject({ ok: false, code: 'SCREENSHOT_INVALID' });
    expect(fnValidatePreviewInspectionPng({
      bytes: PNG_512_384,
      expectedWidth: 1_024,
      expectedHeight: 768,
    })).toMatchObject({ ok: false, code: 'SCREENSHOT_INVALID' });
  });

  test('rejects header-only, truncated, and bad-CRC screenshots', () => {
    expect(fnValidatePreviewInspectionPng({
      bytes: PNG_512_384.subarray(0, 33),
      expectedWidth: 512,
      expectedHeight: 384,
    })).toMatchObject({ ok: false, code: 'SCREENSHOT_INVALID' });
    expect(fnValidatePreviewInspectionPng({
      bytes: PNG_512_384.subarray(0, PNG_512_384.byteLength - 1),
      expectedWidth: 512,
      expectedHeight: 384,
    })).toMatchObject({ ok: false, code: 'SCREENSHOT_INVALID' });
    const badCrc = Uint8Array.from(PNG_512_384);
    badCrc[32] = (badCrc[32] ?? 0) ^ 1;
    expect(fnValidatePreviewInspectionPng({
      bytes: badCrc,
      expectedWidth: 512,
      expectedHeight: 384,
    })).toMatchObject({ ok: false, code: 'SCREENSHOT_INVALID' });
  });

  test('rejects screenshots over the exact 8 MiB ceiling', () => {
    expect(fnValidatePreviewInspectionPng({
      bytes: new Uint8Array(PREVIEW_INSPECTION_LIMITS.maximumScreenshotBytes + 1),
      expectedWidth: 1,
      expectedHeight: 1,
    })).toMatchObject({ ok: false, code: 'SCREENSHOT_TOO_LARGE' });
  });
});
