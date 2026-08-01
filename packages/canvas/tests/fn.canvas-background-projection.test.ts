import { BUILTIN_THEMES } from '@omnidraw/service-theme';
import { describe, expect, test } from 'vitest';
import {
  fnCanvasBackgroundProjection,
} from '../src/fn.canvas-background-projection';

describe('canvas background projection', () => {
  test.each(BUILTIN_THEMES)(
    'projects the exact $label canvas colors',
    (theme) => {
      const viewport = theme.canvas.viewport;
      const snapshot = fnCanvasBackgroundProjection({
        viewport,
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
              color: viewport.background,
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
            minorColor: viewport.gridMinor,
            majorColor: viewport.gridMajor,
            lineWidth: 1,
          },
        }),
      ]);
    },
  );

  test('hides the grid without removing it', () => {
    expect(fnCanvasBackgroundProjection({
      viewport: BUILTIN_THEMES[0]!.canvas.viewport,
      gridVisible: false,
    }).nodes[1]).toMatchObject({ id: 'grid', visibility: 'hidden' });
  });
});
