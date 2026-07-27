import type { TVec2 } from '@omnidraw/cangine';

export type TArgs = Readonly<{
  current: Readonly<TVec2>;
  previous: Readonly<TVec2>;
}>;

export type TCanBeginArgs = Readonly<{
  insideCanvasSurface: boolean;
  primaryButton: boolean;
  spaceHeld: boolean;
  widgetContentFocused: boolean;
}>;

export function fnCanBeginSpacePan(args: TCanBeginArgs): boolean {
  return (
    args.spaceHeld
    && args.primaryButton
    && args.insideCanvasSurface
    && !args.widgetContentFocused
  );
}

export function fnSpacePanScreenDelta(args: TArgs): TVec2 {
  return {
    x: args.current.x - args.previous.x,
    y: args.current.y - args.previous.y,
  };
}
