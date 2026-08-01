import type { ThemeId, TThemeDefinition } from "./builtins.js";

export const THEME_COLOR_FAMILIES = [
  "base",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
  "brown",
] as const;

export const THEME_COLOR_STEPS = [
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
] as const;

export const THEME_STROKE_WIDTH_NAMES = ["none", "thin", "medium", "thick", "heavy"] as const;
export const THEME_CORNER_RADIUS_NAMES = ["none", "sm", "md", "lg"] as const;
export const THEME_FONT_SIZE_NAMES = ["s", "m", "l", "xl"] as const;
export const THEME_STROKE_STYLES = ["solid", "dashed", "dotted"] as const;
export const THEME_TEXT_ALIGNS = ["left", "center", "right"] as const;
export const THEME_VERTICAL_ALIGNS = ["top", "middle", "bottom"] as const;
export const THEME_STYLE_SCOPE_IDS = [
  "rect",
  "diamond",
  "ellipse",
  "line",
  "arrow",
  "pen",
  "text",
  "image",
] as const;

export type TThemeColorFamily = typeof THEME_COLOR_FAMILIES[number];
export type TThemeColorStep = typeof THEME_COLOR_STEPS[number];
export type TThemeColorToken = "@transparent" | `@${TThemeColorFamily}/${TThemeColorStep}`;
export type TThemeColorScale = Record<TThemeColorStep, string>;
export type TThemeColorPalette = Record<TThemeColorFamily, TThemeColorScale>;
export type TThemeStrokeWidthName = typeof THEME_STROKE_WIDTH_NAMES[number];
export type TThemeStrokeWidthToken = `@stroke-width/${TThemeStrokeWidthName}`;
export type TThemeCornerRadiusName = typeof THEME_CORNER_RADIUS_NAMES[number];
export type TThemeCornerRadiusToken = `@corner-radius/${TThemeCornerRadiusName}`;
export type TThemeFontSizeName = typeof THEME_FONT_SIZE_NAMES[number];
export type TThemeFontSizeToken = `@text/${TThemeFontSizeName}`;
export type TThemeStrokeStyle = typeof THEME_STROKE_STYLES[number];
export type TThemeTextAlign = typeof THEME_TEXT_ALIGNS[number];
export type TThemeVerticalAlign = typeof THEME_VERTICAL_ALIGNS[number];
export type TThemeBuiltinStyleScopeId = typeof THEME_STYLE_SCOPE_IDS[number];
export type TThemeStyleScopeId = TThemeBuiltinStyleScopeId | (string & {});

export type TThemeCanvasStyle = {
  backgroundColor?: string;
  strokeColor?: string;
  strokeWidth?: string;
  opacity?: number;
  cornerRadius?: string;
  strokeStyle?: TThemeStrokeStyle;
  fontSize?: string;
  textAlign?: TThemeTextAlign;
  verticalAlign?: TThemeVerticalAlign;
};

export type TThemeColorSwatch = {
  token: TThemeColorToken;
  label: string;
  color: string;
};

export type TThemeColorPaletteGroup = {
  id: TThemeColorFamily;
  label: string;
  swatches: TThemeColorSwatch[];
};

export type TThemeColorPickerPalette = {
  fillQuick: TThemeColorSwatch[];
  strokeQuick: TThemeColorSwatch[];
  groups: TThemeColorPaletteGroup[];
};

export type TThemeTokenOption<TToken extends string, TValue> = {
  token: TToken;
  label: string;
  value: TValue;
};

export type TThemeStrokeWidthOption = TThemeTokenOption<TThemeStrokeWidthToken, number>;
export type TThemeCornerRadiusOption = TThemeTokenOption<TThemeCornerRadiusToken, number>;
export type TThemeFontSizeOption = TThemeTokenOption<TThemeFontSizeToken, number>;
export type TThemeStrokeStyleOption = {
  value: TThemeStrokeStyle;
  label: string;
};
export type TThemeTextAlignOption = {
  value: TThemeTextAlign;
  label: string;
};
export type TThemeVerticalAlignOption = {
  value: TThemeVerticalAlign;
  label: string;
};

export type TThemeColorValueMap = Record<TThemeColorToken, string>;
export type TThemeStrokeWidthValueMap = Record<TThemeStrokeWidthToken, number>;
export type TThemeCornerRadiusValueMap = Record<TThemeCornerRadiusToken, number>;
export type TThemeFontSizeValueMap = Record<TThemeFontSizeToken, number>;
export type TThemeStyleDefaultsMap = Record<TThemeStyleScopeId, TThemeCanvasStyle>;
export type TThemeRememberedStyle = {
  fillColor?: string;
  backgroundColor?: string;
  strokeColor?: string;
  strokeWidth?: string;
  opacity?: number;
  cornerRadius?: string;
  strokeStyle?: TThemeStrokeStyle;
  fontSize?: string;
  fontFamily?: string;
  textAlign?: TThemeTextAlign;
  verticalAlign?: TThemeVerticalAlign;
  lineType?: "straight" | "curved";
  startCap?: "none" | "arrow" | "dot" | "diamond";
  endCap?: "none" | "arrow" | "dot" | "diamond";
};

export type TThemeRememberedStyleMap = Partial<Record<TThemeStyleScopeId, Partial<TThemeRememberedStyle>>>;

export type TResolvedThemeCanvasStyle = {
  merged: TThemeCanvasStyle;
  runtime: {
    backgroundColor?: string;
    strokeColor?: string;
    strokeWidth: number;
    opacity: number;
    cornerRadius: number;
    strokeStyle: TThemeStrokeStyle;
    strokeDash: number[];
    fontSize: number;
    textAlign: TThemeTextAlign;
    verticalAlign: TThemeVerticalAlign;
  };
};

export type TCanvasThemeStyle = {
  id: ThemeId;
  base: TThemeDefinition;
  palette: TThemeColorPalette;
  fillQuick: readonly TThemeColorToken[];
  strokeQuick: readonly TThemeColorToken[];
};
