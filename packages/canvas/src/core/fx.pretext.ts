import type { layoutWithLines, prepareWithSegments } from "@chenglou/pretext";
import { fnBuildPretextFont } from "./fn.pretext";

export type TTextLayoutResult = {
  height: number;
  lineCount: number;
  maxLineWidth: number;
};

export type TPortalMeasureTextLayout = {
  layoutWithLines: typeof layoutWithLines;
  prepareWithSegments: typeof prepareWithSegments;
};

export type TArgsMeasureTextLayout = {
  text: string;
  fontSize: number;
  fontFamily: string;
  fontStyle?: string;
  lineHeight: number;
  width: number;
};

export function fxMeasureTextLayout(
  portal: TPortalMeasureTextLayout,
  args: TArgsMeasureTextLayout,
) {
  const prepared = portal.prepareWithSegments(
    args.text,
    fnBuildPretextFont({
      fontStyle: args.fontStyle,
      fontSize: args.fontSize,
      fontFamily: args.fontFamily,
    }),
    { whiteSpace: "pre-wrap" },
  );
  const layout = portal.layoutWithLines(
    prepared,
    Math.max(1, args.width),
    args.fontSize * args.lineHeight,
  );

  return {
    height: layout.lineCount === 0
      ? args.fontSize * args.lineHeight
      : layout.height,
    lineCount: Math.max(layout.lineCount, 1),
    maxLineWidth: layout.lines.reduce((maxWidth, line) => {
      return Math.max(maxWidth, line.width);
    }, 0),
  } satisfies TTextLayoutResult;
}
