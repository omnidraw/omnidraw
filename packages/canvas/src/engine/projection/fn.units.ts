type TArgsAngle = {
  angle: number;
};

export function fnDegreesToRadians(args: TArgsAngle): number {
  return args.angle * Math.PI / 180;
}

export function fnRadiansToDegrees(args: TArgsAngle): number {
  return args.angle * 180 / Math.PI;
}
