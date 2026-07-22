type TArgs = Readonly<{
  matrix: readonly number[];
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  preloadMargin: number;
}>;

export function fnIsWidgetPortalVisible(args: TArgs): boolean {
  if (
    args.matrix.length !== 6
    || !args.matrix.every(Number.isFinite)
    || !Number.isFinite(args.width)
    || !Number.isFinite(args.height)
    || !Number.isFinite(args.viewportWidth)
    || !Number.isFinite(args.viewportHeight)
    || !Number.isFinite(args.preloadMargin)
  ) return false;
  if (args.viewportWidth <= 0 || args.viewportHeight <= 0) return true;
  if (args.width <= 0 || args.height <= 0 || args.preloadMargin < 0) return false;

  const [scaleX, skewY, skewX, scaleY, translateX, translateY] = args.matrix as readonly [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const corners = [
    [translateX, translateY],
    [scaleX * args.width + translateX, skewY * args.width + translateY],
    [skewX * args.height + translateX, scaleY * args.height + translateY],
    [
      scaleX * args.width + skewX * args.height + translateX,
      skewY * args.width + scaleY * args.height + translateY,
    ],
  ] as const;
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const minimumX = Math.min(...xs);
  const maximumX = Math.max(...xs);
  const minimumY = Math.min(...ys);
  const maximumY = Math.max(...ys);

  return maximumX >= -args.preloadMargin
    && maximumY >= -args.preloadMargin
    && minimumX <= args.viewportWidth + args.preloadMargin
    && minimumY <= args.viewportHeight + args.preloadMargin;
}
