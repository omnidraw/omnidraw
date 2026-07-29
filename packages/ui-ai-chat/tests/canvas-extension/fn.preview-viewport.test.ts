import { describe, expect, test } from 'vitest';
import {
  fnPreviewGuestViewport,
} from '../../src/canvas-extension/fn.preview-viewport';

const VIEWPORT = {
  width: 480,
  height: 320,
  scale: 2,
  visibility: 'visible' as const,
  distance: 12,
  priority: 100,
  occlusion: 0,
};

describe('fnPreviewGuestViewport', () => {
  test('uses the measured guest lane while preserving portal metadata', () => {
    expect(fnPreviewGuestViewport({
      viewport: VIEWPORT,
      contentSize: {
        width: 480,
        height: 224,
      },
    })).toEqual({
      ...VIEWPORT,
      height: 224,
    });
  });

  test('retains outer dimensions while browser layout is unavailable', () => {
    expect(fnPreviewGuestViewport({
      viewport: VIEWPORT,
      contentSize: {
        width: 0,
        height: 0,
      },
    })).toEqual(VIEWPORT);
  });
});
