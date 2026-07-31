import type { TRetainedProjectionSnapshot } from '@omnidraw/cangine';
import type { TThemeColors } from '@omnidraw/service-theme';

type TArgs = Readonly<{
  colors: TThemeColors;
  gridVisible: boolean;
}>;

export function fnCanvasBackgroundProjection(
  args: TArgs,
): TRetainedProjectionSnapshot {
  const transform = {
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    skew: { x: 0, y: 0 },
    origin: { x: 0, y: 0 },
  };
  return {
    nodes: [{
      id: 'surface',
      parentId: null,
      orderKey: '1000000000000000',
      kind: 'background',
      pointerEvents: 'none',
      transform,
      background: {
        type: 'solid',
        paint: {
          type: 'solid',
          color: args.colors.canvasBackground,
        },
      },
    }, {
      id: 'grid',
      parentId: null,
      orderKey: '2000000000000000',
      kind: 'background',
      visibility: args.gridVisible ? 'visible' : 'hidden',
      pointerEvents: 'none',
      transform,
      background: {
        type: 'grid',
        minorSize: 64,
        majorEvery: 4,
        minorColor: args.colors.canvasGridMinor,
        majorColor: args.colors.canvasGridMajor,
        lineWidth: 1,
      },
    }],
  };
}
