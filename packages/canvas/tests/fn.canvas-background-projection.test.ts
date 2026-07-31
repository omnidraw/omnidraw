import { BUILTIN_THEMES } from '@omnidraw/service-theme';
import { describe, expect, test } from 'vitest';
import {
  fnCanvasBackgroundProjection,
} from '../src/fn.canvas-background-projection';

describe('canvas background projection', () => {
  test.each(BUILTIN_THEMES)(
    'projects the exact $label canvas colors',
    (theme) => {
      const colors = theme.colors;
      const snapshot = fnCanvasBackgroundProjection({
        colors,
        gridVisible: true,
      });

      expect(snapshot.nodes).toEqual([
        expect.objectContaining({
          id: 'surface',
          parentId: null,
          orderKey: '1000000000000000',
          kind: 'background',
          pointerEvents: 'none',
          background: {
            type: 'solid',
            paint: {
              type: 'solid',
              color: colors.canvasBackground,
            },
          },
        }),
        expect.objectContaining({
          id: 'grid',
          parentId: null,
          orderKey: '2000000000000000',
          kind: 'background',
          visibility: 'visible',
          pointerEvents: 'none',
          background: {
            type: 'grid',
            minorSize: 64,
            majorEvery: 4,
            minorColor: colors.canvasGridMinor,
            majorColor: colors.canvasGridMajor,
            lineWidth: 1,
          },
        }),
      ]);
    },
  );

  test('hides the grid without removing it', () => {
    expect(fnCanvasBackgroundProjection({
      colors: BUILTIN_THEMES[0]!.colors,
      gridVisible: false,
    }).nodes[1]).toMatchObject({ id: 'grid', visibility: 'hidden' });
  });
});
