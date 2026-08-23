/** Pure authoring-style token tables and defaults. */

import type {
  TThemeCanvasStyle,
  TThemeCornerRadiusOption,
  TThemeCornerRadiusValueMap,
  TThemeFontSizeOption,
  TThemeFontSizeValueMap,
  TThemeStrokeStyleOption,
  TThemeStrokeWidthOption,
  TThemeStrokeWidthValueMap,
  TThemeStyleDefaultsMap,
  TThemeTextAlignOption,
  TThemeVerticalAlignOption,
} from "./types.js";

export const THEME_STROKE_WIDTH_OPTIONS = [
  { token: "@stroke-width/none", label: "None", value: 0 },
  { token: "@stroke-width/thin", label: "Thin", value: 1 },
  { token: "@stroke-width/medium", label: "Medium", value: 4 },
  { token: "@stroke-width/thick", label: "Thick", value: 7 },
  { token: "@stroke-width/heavy", label: "Heavy", value: 12 },
] as const satisfies readonly TThemeStrokeWidthOption[];

export const THEME_CORNER_RADIUS_OPTIONS = [
  { token: "@corner-radius/none", label: "None", value: 0 },
  { token: "@corner-radius/sm", label: "Small", value: 8 },
  { token: "@corner-radius/md", label: "Medium", value: 16 },
  { token: "@corner-radius/lg", label: "Large", value: 24 },
] as const satisfies readonly TThemeCornerRadiusOption[];

export const THEME_FONT_SIZE_OPTIONS = [
  { token: "@text/s", label: "S", value: 16 },
  { token: "@text/m", label: "M", value: 20 },
  { token: "@text/l", label: "L", value: 28 },
  { token: "@text/xl", label: "XL", value: 36 },
] as const satisfies readonly TThemeFontSizeOption[];

export const THEME_STROKE_STYLE_OPTIONS = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
] as const satisfies readonly TThemeStrokeStyleOption[];

export const THEME_TEXT_ALIGN_OPTIONS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
] as const satisfies readonly TThemeTextAlignOption[];

export const THEME_VERTICAL_ALIGN_OPTIONS = [
  { value: "top", label: "Top" },
  { value: "middle", label: "Middle" },
  { value: "bottom", label: "Bottom" },
] as const satisfies readonly TThemeVerticalAlignOption[];

export const THEME_STROKE_WIDTH_VALUE_MAP = Object.fromEntries(
  THEME_STROKE_WIDTH_OPTIONS.map((option) => [option.token, option.value]),
) as TThemeStrokeWidthValueMap;

export const THEME_CORNER_RADIUS_VALUE_MAP = Object.fromEntries(
  THEME_CORNER_RADIUS_OPTIONS.map((option) => [option.token, option.value]),
) as TThemeCornerRadiusValueMap;

export const THEME_FONT_SIZE_VALUE_MAP = Object.fromEntries(
  THEME_FONT_SIZE_OPTIONS.map((option) => [option.token, option.value]),
) as TThemeFontSizeValueMap;

export const THEME_STYLE_DEFAULTS_BY_SCOPE = {
  rect: {
    backgroundColor: "neutral",
    strokeWidth: "@stroke-width/none",
    cornerRadius: "@corner-radius/none",
    opacity: 1,
    strokeStyle: "solid",
  },
  diamond: {
    backgroundColor: "neutral",
    strokeWidth: "@stroke-width/none",
    cornerRadius: "@corner-radius/none",
    opacity: 1,
    strokeStyle: "solid",
  },
  ellipse: {
    backgroundColor: "neutral",
    strokeWidth: "@stroke-width/none",
    cornerRadius: "@corner-radius/none",
    opacity: 1,
    strokeStyle: "solid",
  },
  line: {
    strokeColor: "neutral",
    strokeWidth: "@stroke-width/medium",
    opacity: 0.92,
    strokeStyle: "solid",
  },
  arrow: {
    strokeColor: "neutral",
    strokeWidth: "@stroke-width/medium",
    opacity: 0.92,
    strokeStyle: "solid",
  },
  pen: {
    strokeColor: "neutral",
    strokeWidth: "@stroke-width/thick",
    opacity: 0.92,
    strokeStyle: "solid",
  },
  text: {
    strokeColor: "neutral",
    opacity: 1,
    fontSize: "@text/s",
    textAlign: "left",
    verticalAlign: "top",
  },
  image: { opacity: 1 },
} as const satisfies TThemeStyleDefaultsMap;

export function fnCreateThemeStyleDefaults(scope: string): TThemeCanvasStyle {
  const defaultsByScope = THEME_STYLE_DEFAULTS_BY_SCOPE as Record<
    string,
    TThemeCanvasStyle
  >;
  return structuredClone(defaultsByScope[scope] ?? {});
}
