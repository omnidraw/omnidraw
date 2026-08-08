import { fnValidateBoundedPngBytes } from '@omnidraw/shared-functions/image/fn.png-base64';
import { PREVIEW_INSPECTION_LIMITS } from './CONSTANTS';

export type TPreviewInspectionPngValidation =
  | Readonly<{ ok: true; width: number; height: number; byteSize: number }>
  | Readonly<{
      ok: false;
      code: 'SCREENSHOT_INVALID' | 'SCREENSHOT_TOO_LARGE';
      message: string;
    }>;

export function fnValidatePreviewInspectionPng(args: Readonly<{
  bytes: Uint8Array;
  expectedWidth: number;
  expectedHeight: number;
}>): TPreviewInspectionPngValidation {
  if (args.bytes.byteLength > PREVIEW_INSPECTION_LIMITS.maximumScreenshotBytes) {
    return Object.freeze({
      ok: false,
      code: 'SCREENSHOT_TOO_LARGE',
      message: 'Preview inspection screenshot exceeds the 8 MiB byte limit.',
    });
  }
  const validation = fnValidateBoundedPngBytes(args.bytes);
  if (!validation.ok) {
    return Object.freeze({
      ok: false,
      code: 'SCREENSHOT_INVALID',
      message: `Preview inspection screenshot is not a canonical PNG (${validation.reason}).`,
    });
  }
  const { width, height } = validation.metadata;
  if (
    !Number.isSafeInteger(width)
    || width < 1
    || !Number.isSafeInteger(height)
    || height < 1
    || width !== args.expectedWidth
    || height !== args.expectedHeight
  ) {
    return Object.freeze({
      ok: false,
      code: 'SCREENSHOT_INVALID',
      message: 'Preview inspection screenshot dimensions do not match the exact viewport and DPR.',
    });
  }
  return Object.freeze({ ok: true, width, height, byteSize: args.bytes.byteLength });
}
