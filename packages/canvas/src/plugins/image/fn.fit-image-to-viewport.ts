export type TArgsFitImageToViewport = {
  viewportWidth: number;
  viewportHeight: number;
  imageWidth: number;
  imageHeight: number;
};

export type TImageViewportSize = {
  width: number;
  height: number;
};

export function fnFitImageToViewport(args: TArgsFitImageToViewport): TImageViewportSize {
  const maxDimension = Math.min(args.viewportWidth, args.viewportHeight) / 2;
  const aspectRatio = args.imageWidth / args.imageHeight;

  if (args.imageWidth >= args.imageHeight) {
    const width = Math.min(args.imageWidth, maxDimension);
    return { width, height: width / aspectRatio };
  }

  const height = Math.min(args.imageHeight, maxDimension);
  return { width: height * aspectRatio, height };
}
