import {
  BUILTIN_THEMES,
  type ThemeId,
  type TThemeDefinition,
} from "./builtins";
import type {
  TCanvasThemeStyle,
  TThemeCanvasStyle,
  TThemeColorFamily,
  TThemeColorScale,
  TThemeColorStep,
  TThemeColorToken,
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
} from "./types";

const DEFAULT_FILL_QUICK = [
  "@transparent",
  "@base/100",
  "@red/300",
  "@green/300",
  "@blue/300",
  "@yellow/300",
] as const satisfies readonly TThemeColorToken[];

const DEFAULT_STROKE_QUICK = [
  "@base/900",
  "@red/700",
  "@green/700",
  "@blue/700",
  "@yellow/700",
] as const satisfies readonly TThemeColorToken[];

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
    backgroundColor: "@base/300",
    strokeWidth: "@stroke-width/none",
    cornerRadius: "@corner-radius/none",
    opacity: 1,
    strokeStyle: "solid",
  },
  diamond: {
    backgroundColor: "@base/300",
    strokeWidth: "@stroke-width/none",
    cornerRadius: "@corner-radius/none",
    opacity: 1,
    strokeStyle: "solid",
  },
  ellipse: {
    backgroundColor: "@base/300",
    strokeWidth: "@stroke-width/none",
    cornerRadius: "@corner-radius/none",
    opacity: 1,
    strokeStyle: "solid",
  },
  line: {
    strokeColor: "@base/900",
    strokeWidth: "@stroke-width/medium",
    opacity: 0.92,
    strokeStyle: "solid",
  },
  arrow: {
    strokeColor: "@base/900",
    strokeWidth: "@stroke-width/medium",
    opacity: 0.92,
    strokeStyle: "solid",
  },
  pen: {
    strokeColor: "@base/900",
    strokeWidth: "@stroke-width/thick",
    opacity: 0.92,
    strokeStyle: "solid",
  },
  text: {
    strokeColor: "@base/900",
    opacity: 1,
    fontSize: "@text/s",
    textAlign: "left",
    verticalAlign: "top",
  },
  image: {
    opacity: 1,
  },
} as const satisfies TThemeStyleDefaultsMap;

export function getBaseThemeOrThrow(themeId: ThemeId): TThemeDefinition {
  const theme = BUILTIN_THEMES.find((candidate) => candidate.id === themeId);
  if (!theme) {
    throw new Error(`Missing base theme '${themeId}'`);
  }

  return structuredClone(theme);
}

function parseHexChannel(value: string) {
  return Number.parseInt(value, 16);
}

function toHexChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

function mixHex(left: string, right: string) {
  const normalizedLeft = left.replace("#", "");
  const normalizedRight = right.replace("#", "");

  if (normalizedLeft.length !== 6 || normalizedRight.length !== 6) {
    throw new Error(`Expected 6-digit hex colors, got '${left}' and '${right}'`);
  }

  const lr = parseHexChannel(normalizedLeft.slice(0, 2));
  const lg = parseHexChannel(normalizedLeft.slice(2, 4));
  const lb = parseHexChannel(normalizedLeft.slice(4, 6));
  const rr = parseHexChannel(normalizedRight.slice(0, 2));
  const rg = parseHexChannel(normalizedRight.slice(2, 4));
  const rb = parseHexChannel(normalizedRight.slice(4, 6));

  return `#${toHexChannel((lr + rr) / 2)}${toHexChannel((lg + rg) / 2)}${toHexChannel((lb + rb) / 2)}`;
}

export function createColorScale(
  c100: string,
  c300: string,
  c500: string,
  c700: string,
  c900: string,
): TThemeColorScale {
  return {
    "100": c100,
    "200": mixHex(c100, c300),
    "300": c300,
    "400": mixHex(c300, c500),
    "500": c500,
    "600": mixHex(c500, c700),
    "700": c700,
    "800": mixHex(c700, c900),
    "900": c900,
  } satisfies Record<TThemeColorStep, string>;
}

export function createThemeStyle(args: {
  id: ThemeId;
  palette: Record<TThemeColorFamily, TThemeColorScale>;
  fillQuick?: readonly TThemeColorToken[];
  strokeQuick?: readonly TThemeColorToken[];
}): TCanvasThemeStyle {
  return {
    id: args.id,
    base: getBaseThemeOrThrow(args.id),
    palette: args.palette,
    fillQuick: args.fillQuick ?? DEFAULT_FILL_QUICK,
    strokeQuick: args.strokeQuick ?? DEFAULT_STROKE_QUICK,
  };
}

export function createThemeStyleDefaults(scope: string): TThemeCanvasStyle {
  const defaultsByScope = THEME_STYLE_DEFAULTS_BY_SCOPE as Record<string, TThemeCanvasStyle>;
  return structuredClone(defaultsByScope[scope] ?? {});
}
