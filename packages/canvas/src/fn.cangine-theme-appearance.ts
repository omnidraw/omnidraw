/** @file Pure projection from host theme tokens to Cangine appearance data. */

import type {
  TPaint,
  TSelectionAppearance,
  TStrokeStyle,
} from '@omnidraw/cangine';
import type {
  TPathInteractionAppearance,
} from '@omnidraw/cangine/editor';
import type {
  TThemePathAppearance,
  TThemeSelectionAppearance,
  TThemeSrgbColor,
} from '@omnidraw/theme';

function fnPaint(color: TThemeSrgbColor): TPaint {
  return { type: 'solid', color: { ...color } };
}

function fnStroke(color: TThemeSrgbColor): TStrokeStyle {
  return { paint: fnPaint(color), width: 1 };
}

export function fnCangineSelectionAppearance(
  appearance: TThemeSelectionAppearance,
): TSelectionAppearance {
  return {
    outline: fnStroke(appearance.outline),
    handleFill: fnPaint(appearance.handleFill),
    handleStroke: fnStroke(appearance.handleStroke),
    handleSize: appearance.handleSize,
    rotateHandleOffset: appearance.rotateHandleOffset,
    outlinePadding: appearance.outlinePadding,
  };
}

export function fnCanginePathAppearance(
  appearance: TThemePathAppearance,
): TPathInteractionAppearance {
  return {
    outlineColor: { ...appearance.outline },
    anchorFillColor: { ...appearance.anchorFill },
    midpointFillColor: { ...appearance.midpointFill },
    handleStrokeColor: { ...appearance.handleStroke },
    handleSize: appearance.handleSize,
    midpointSize: appearance.midpointSize,
    rotateOffset: appearance.rotateOffset,
  };
}
