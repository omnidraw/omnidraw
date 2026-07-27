import { describe, expect, test } from 'vitest';
import { fnWidgetCapsuleViewport } from '../../src/widget-runtime/fn.capsule-viewport';

describe('fnWidgetCapsuleViewport', () => {
  test('rounds fractional browser geometry and clamps every public bound', () => {
    expect(fnWidgetCapsuleViewport({
      width: 317.75,
      height: 128.4,
      scale: 16,
      visibility: 'visible',
      distance: Number.POSITIVE_INFINITY,
      priority: 49.6,
      occlusion: -1,
    })).toEqual({
      width: 318,
      height: 128,
      scale: 8,
      visibility: 'visible',
      distance: 0,
      priority: 50,
      occlusion: 0,
    });
  });
});
