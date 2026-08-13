import { BUILTIN_THEMES } from '@omnidraw/theme';
import { describe, expect, test } from 'vitest';
import {
  fnCanginePathAppearance,
  fnCangineSelectionAppearance,
} from '../src/fn.cangine-theme-appearance';

describe('Cangine theme appearance projection', () => {
  test('projects only concrete Cangine selection and path values', () => {
    const theme = BUILTIN_THEMES[3];
    expect(fnCangineSelectionAppearance(theme.canvas.selection)).toEqual({
      outline: {
        paint: { type: 'solid', color: theme.canvas.selection.outline },
        width: 1,
      },
      handleFill: { type: 'solid', color: theme.canvas.selection.handleFill },
      handleStroke: {
        paint: { type: 'solid', color: theme.canvas.selection.handleStroke },
        width: 1,
      },
      handleSize: theme.canvas.selection.handleSize,
      rotateHandleOffset: theme.canvas.selection.rotateHandleOffset,
      outlinePadding: theme.canvas.selection.outlinePadding,
    });
    expect(fnCanginePathAppearance(theme.canvas.path)).toEqual({
      outlineColor: theme.canvas.path.outline,
      anchorFillColor: theme.canvas.path.anchorFill,
      midpointFillColor: theme.canvas.path.midpointFill,
      handleStrokeColor: theme.canvas.path.handleStroke,
      handleSize: theme.canvas.path.handleSize,
      midpointSize: theme.canvas.path.midpointSize,
      rotateOffset: theme.canvas.path.rotateOffset,
    });
  });
});
