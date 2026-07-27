import type { TVec2 } from '@omnidraw/cangine';

export type TArgs = Readonly<{
  origin: TVec2;
  visible: boolean;
  zoom: number;
}>;

export type TCanvasGridStyle = Readonly<{
  backgroundImage: string;
  backgroundPosition: string;
  backgroundSize: string;
  display: 'block' | 'none';
}>;

export function fnCanvasGridStyle(args: TArgs): TCanvasGridStyle {
  if (!args.visible || !Number.isFinite(args.zoom) || args.zoom <= 0) {
    return Object.freeze({
      backgroundImage: 'none',
      backgroundPosition: '0 0',
      backgroundSize: '0 0',
      display: 'none',
    });
  }

  let screenStep = 64 * args.zoom;
  while (screenStep < 24) screenStep *= 2;
  while (screenStep > 96) screenStep /= 2;

  return Object.freeze({
    backgroundImage: [
      'linear-gradient(to right, color-mix(in srgb, var(--border) 72%, transparent) 1px, transparent 1px)',
      'linear-gradient(to bottom, color-mix(in srgb, var(--border) 72%, transparent) 1px, transparent 1px)',
    ].join(', '),
    backgroundPosition: `${args.origin.x}px ${args.origin.y}px`,
    backgroundSize: `${screenStep}px ${screenStep}px`,
    display: 'block',
  });
}
