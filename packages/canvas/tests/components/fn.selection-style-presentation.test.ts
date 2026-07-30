import type {
  TSelectionStyleControl,
  TSelectionStyleState,
} from '@omnidraw/cangine/editor';
import { describe, expect, it } from 'vitest';
import {
  fnCanvasColorToCss,
  fnParseCssColor,
  fnSelectionStyleControl,
  fnSelectionStyleMenuVisible,
  fnSelectionStyleSharedValue,
} from '../../src/components/SelectionStyleMenu/fn.selection-style-presentation';

const COVERAGE = {
  selectedRootCount: 1,
  candidateTargetCount: 1,
  eligibleTargetCount: 1,
};

function state(
  controls: readonly TSelectionStyleControl[],
  status: TSelectionStyleState['status'] = 'attached',
): TSelectionStyleState {
  return {
    revision: 1,
    status,
    selectedRootIds: ['one'],
    controls,
    actions: [],
    unavailable: [],
  };
}

describe('selection style presentation', () => {
  it('reads only controller control presence and shared values', () => {
    const snapshot = state([{
      id: 'font-size',
      label: 'Font size',
      coverage: COVERAGE,
      value: { status: 'shared', value: 16 },
      options: [12, 16, 20],
    }]);
    const control = fnSelectionStyleControl(snapshot, 'font-size');

    expect(fnSelectionStyleMenuVisible(snapshot)).toBe(true);
    expect(fnSelectionStyleSharedValue<number>(control)).toBe(16);
    expect(fnSelectionStyleControl(snapshot, 'background')).toBeNull();
    expect(fnSelectionStyleMenuVisible(state([], 'detached'))).toBe(false);
  });

  it('represents mixed and complex values without inventing a selection', () => {
    expect(fnSelectionStyleSharedValue({
      id: 'opacity',
      label: 'Opacity',
      coverage: COVERAGE,
      value: { status: 'mixed' },
    })).toBeNull();
    expect(fnSelectionStyleSharedValue({
      id: 'background',
      label: 'Background',
      coverage: COVERAGE,
      value: {
        status: 'complex',
        paintTypes: ['linear-gradient'],
        mixed: false,
      },
    })).toBeNull();
  });

  it('parses theme colors without fallback and preserves transparency', () => {
    expect(fnParseCssColor('#3b82f6')).toEqual({
      space: 'srgb',
      r: 59 / 255,
      g: 130 / 255,
      b: 246 / 255,
      a: 1,
    });
    const transparent = fnParseCssColor('transparent');
    expect(transparent).toEqual({
      space: 'srgb',
      r: 0,
      g: 0,
      b: 0,
      a: 0,
    });
    expect(transparent && fnCanvasColorToCss(transparent)).toBe('transparent');
    expect(fnParseCssColor('not-a-color')).toBeNull();
  });
});
