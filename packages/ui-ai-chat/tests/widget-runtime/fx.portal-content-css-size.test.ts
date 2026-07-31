import { describe, expect, test, vi } from 'vitest';
import {
  fxPortalContentCssSize,
} from '../../src/widget-runtime/fx.portal-content-css-size';

describe('fxPortalContentCssSize', () => {
  test('reads intrinsic client dimensions without using transformed bounds', () => {
    const host = document.createElement('div');
    const transformedBounds = vi.spyOn(host, 'getBoundingClientRect');

    expect(fxPortalContentCssSize({
      readClientWidth: () => 552.9,
      readClientHeight: () => 874.4,
    }, { host })).toEqual({
      width: 552,
      height: 874,
    });
    expect(transformedBounds).not.toHaveBeenCalled();
  });

  test('normalizes negative and non-finite browser measurements to zero', () => {
    const host = document.createElement('div');

    expect(fxPortalContentCssSize({
      readClientWidth: () => Number.POSITIVE_INFINITY,
      readClientHeight: () => -12,
    }, { host })).toEqual({
      width: 0,
      height: 0,
    });
  });
});
