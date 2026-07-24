import type {
  TColor,
  TPaint,
  TStrokeStyle,
} from "@vibecanvas/canvas-engine";
import type {
  TElement,
  TElementStyle,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TCanvasProjectionTheme } from "../typed";
import {
  CANVAS_PROJECTION_CORNER_RADII,
  CANVAS_PROJECTION_FALLBACK_COLORS,
  CANVAS_PROJECTION_FONT_SIZES,
  CANVAS_PROJECTION_STROKE_WIDTHS,
  CANVAS_PROJECTION_STYLE_DEFAULTS,
} from "./CONSTANTS";
import {
  fnCanvasSolidPaint,
  fnResolveCanvasProjectionColor,
} from "./fn.color";
import type { TCanvasResolvedElementStyle } from "./typed";

type TArgsResolveNumber = {
  value: string | undefined;
  values: Readonly<Record<string, number>>;
  fallback: number;
};

type TArgsResolveFontSize = {
  theme: TCanvasProjectionTheme;
  value: string | undefined;
  fallback?: number;
};

type TArgsResolveElementStyle = {
  element: TElement;
  theme: TCanvasProjectionTheme;
};

function resolveNumber(args: TArgsResolveNumber): number {
  if (args.value && args.values[args.value] !== undefined) {
    return args.values[args.value]!;
  }
  const parsed = args.value === undefined ? Number.NaN : Number.parseFloat(args.value);
  return Number.isFinite(parsed) ? parsed : args.fallback;
}

function resolveColorPaint(args: {
  theme: TCanvasProjectionTheme;
  value: string | undefined;
  fallback: TColor;
}): TPaint | undefined {
  if (args.value === undefined) {
    return undefined;
  }
  return fnCanvasSolidPaint({
    color: fnResolveCanvasProjectionColor(args),
  });
}

function mergedStyle(element: TElement, theme: TCanvasProjectionTheme): TElementStyle {
  const type = element.data.type;
  return {
    ...(CANVAS_PROJECTION_STYLE_DEFAULTS[type] ?? {}),
    ...(theme.styleDefaults?.[type] ?? {}),
    ...element.style,
  };
}

export function fnResolveCanvasProjectionFontSize(args: TArgsResolveFontSize): number {
  const values = {
    ...CANVAS_PROJECTION_FONT_SIZES,
    ...args.theme.fontSizes,
  };
  return Math.max(1, resolveNumber({
    value: args.value,
    values,
    fallback: args.fallback ?? CANVAS_PROJECTION_FONT_SIZES["@text/s"],
  }));
}

export function fnResolveCanvasElementStyle(args: TArgsResolveElementStyle): TCanvasResolvedElementStyle {
  const style = mergedStyle(args.element, args.theme);
  const strokeWidths = {
    ...CANVAS_PROJECTION_STROKE_WIDTHS,
    ...args.theme.strokeWidths,
  };
  const cornerRadii = {
    ...CANVAS_PROJECTION_CORNER_RADII,
    ...args.theme.cornerRadii,
  };
  const strokeWidth = Math.max(0, resolveNumber({
    value: style.strokeWidth,
    values: strokeWidths,
    fallback: 0,
  }));
  const strokePaint = resolveColorPaint({
    theme: args.theme,
    value: style.strokeColor ?? (
      args.element.data.type === "line"
      || args.element.data.type === "arrow"
      || args.element.data.type === "pen"
        ? style.backgroundColor
        : undefined
    ),
    fallback: CANVAS_PROJECTION_FALLBACK_COLORS.dark,
  });
  const dash = style.strokeStyle === "dashed"
    ? [strokeWidth * 4, strokeWidth * 2]
    : style.strokeStyle === "dotted"
      ? [strokeWidth, strokeWidth * 1.5]
      : undefined;
  const stroke: TStrokeStyle | undefined = strokePaint && strokeWidth > 0
    ? {
        paint: strokePaint,
        width: strokeWidth,
        cap: "round",
        join: "round",
        ...(dash === undefined ? {} : { dash }),
      }
    : undefined;
  const opacity = Number.isFinite(style.opacity)
    ? Math.min(1, Math.max(0, style.opacity ?? 1))
    : 1;

  return {
    fill: resolveColorPaint({
      theme: args.theme,
      value: style.backgroundColor,
      fallback: CANVAS_PROJECTION_FALLBACK_COLORS.light,
    }),
    stroke,
    textColor: fnResolveCanvasProjectionColor({
      theme: args.theme,
      value: style.strokeColor,
      fallback: args.theme.colors.canvasText,
    }),
    opacity,
    cornerRadius: Math.max(0, resolveNumber({
      value: style.cornerRadius,
      values: cornerRadii,
      fallback: 0,
    })),
    fontSize: fnResolveCanvasProjectionFontSize({
      theme: args.theme,
      value: style.fontSize,
    }),
    textAlign: style.textAlign ?? "left",
    verticalAlign: style.verticalAlign ?? "top",
  };
}
