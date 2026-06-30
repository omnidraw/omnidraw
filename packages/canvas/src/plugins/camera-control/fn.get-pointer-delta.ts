export type TArgsGetPointerDelta = {
  lastPointer: { x: number; y: number };
  nextPointer: { x: number; y: number };
};

export type TPointerDelta = {
  deltaX: number;
  deltaY: number;
};

export function fnGetPointerDelta(args: TArgsGetPointerDelta): TPointerDelta {
  return {
    deltaX: args.nextPointer.x - args.lastPointer.x,
    deltaY: args.nextPointer.y - args.lastPointer.y,
  };
}
