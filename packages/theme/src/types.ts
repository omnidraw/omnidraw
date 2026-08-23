/** Complete atomic theme, semantic canvas-color, and authoring-style types. */

import type {
  CANVAS_COLOR_CODES,
  CANVAS_COLOR_ROLES,
  CANVAS_INK_COLOR_CODES,
  THEME_APPEARANCES,
  THEME_UI_COLOR_ROLES,
} from "./CONSTANTS.js";

export type ThemeId = string;
export type TThemeAppearance = typeof THEME_APPEARANCES[number];
export type TThemeUiColorRole = typeof THEME_UI_COLOR_ROLES[number];
export type TThemeUiColors = Readonly<Record<TThemeUiColorRole, string>>;

export type TCanvasColorCode = typeof CANVAS_COLOR_CODES[number];
export type TCanvasFillColorCode = TCanvasColorCode;
export type TCanvasInkColorCode = typeof CANVAS_INK_COLOR_CODES[number];
export type TCanvasColorRole = typeof CANVAS_COLOR_ROLES[number];

export type TThemeSrgbColor = Readonly<{
  space: "srgb";
  r: number;
  g: number;
  b: number;
  a: number;
}>;

export type TThemeCanvasColorPalette = Readonly<{
  transparent: Readonly<{ fill: TThemeSrgbColor }>;
}> & Readonly<Record<TCanvasInkColorCode, Readonly<{
  fill: TThemeSrgbColor;
  ink: TThemeSrgbColor;
}>>>;

export type TThemeCanvasViewport = Readonly<{
  background: TThemeSrgbColor;
  gridMinor: TThemeSrgbColor;
  gridMajor: TThemeSrgbColor;
}>;

export type TThemeCanvasChrome = Readonly<{
  selectionFill: string;
  selectionStroke: string;
  groupBoundary: string;
  debugText: string;
  text: string;
  textEditorOutline: string;
}>;

export type TThemeSelectionAppearance = Readonly<{
  outline: TThemeSrgbColor;
  handleFill: TThemeSrgbColor;
  handleStroke: TThemeSrgbColor;
  handleSize: number;
  rotateHandleOffset: number;
  outlinePadding: number;
}>;

export type TThemePathAppearance = Readonly<{
  outline: TThemeSrgbColor;
  anchorFill: TThemeSrgbColor;
  midpointFill: TThemeSrgbColor;
  handleStroke: TThemeSrgbColor;
  handleSize: number;
  midpointSize: number;
  rotateOffset: number;
}>;

export type TThemeTerminalColors = Readonly<{
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  mutedForeground: string;
  errorForeground: string;
  warningForeground: string;
  successForeground: string;
}>;

export type TThemeDefinition = Readonly<{
  id: ThemeId;
  label: string;
  appearance: TThemeAppearance;
  ui: TThemeUiColors;
  canvas: Readonly<{
    colors: TThemeCanvasColorPalette;
    viewport: TThemeCanvasViewport;
    chrome: TThemeCanvasChrome;
    selection: TThemeSelectionAppearance;
    path: TThemePathAppearance;
  }>;
  terminal: TThemeTerminalColors;
}>;

export type TThemeDefinitionInheritance = Readonly<{
  id: ThemeId;
  label: string;
  extends: ThemeId;
  appearance?: TThemeAppearance;
  ui?: Partial<TThemeUiColors>;
  canvas?: Readonly<{
    colors?: Readonly<{
      transparent?: Partial<TThemeCanvasColorPalette["transparent"]>;
    }> & Partial<Record<
      TCanvasInkColorCode,
      Partial<TThemeCanvasColorPalette[TCanvasInkColorCode]>
    >>;
    viewport?: Partial<TThemeCanvasViewport>;
    chrome?: Partial<TThemeCanvasChrome>;
    selection?: Partial<TThemeSelectionAppearance>;
    path?: Partial<TThemePathAppearance>;
  }>;
  terminal?: Partial<TThemeTerminalColors>;
}>;

export type TThemeRegistration =
  | TThemeDefinition
  | TThemeDefinitionInheritance;

export type TThemeSnapshot = Readonly<{
  revision: number;
  themeId: ThemeId;
  definition: TThemeDefinition;
}>;

export const THEME_STROKE_WIDTH_NAMES = [
  "none", "thin", "medium", "thick", "heavy",
] as const;
export const THEME_CORNER_RADIUS_NAMES = ["none", "sm", "md", "lg"] as const;
export const THEME_FONT_SIZE_NAMES = ["s", "m", "l", "xl"] as const;
export const THEME_STROKE_STYLES = ["solid", "dashed", "dotted"] as const;
export const THEME_TEXT_ALIGNS = ["left", "center", "right"] as const;
export const THEME_VERTICAL_ALIGNS = ["top", "middle", "bottom"] as const;
export const THEME_STYLE_SCOPE_IDS = [
  "rect", "diamond", "ellipse", "line", "arrow", "pen", "text", "image",
] as const;

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
  backgroundColor?: TCanvasFillColorCode;
  strokeColor?: TCanvasInkColorCode;
  strokeWidth?: string;
  opacity?: number;
  cornerRadius?: string;
  strokeStyle?: TThemeStrokeStyle;
  fontSize?: string;
  textAlign?: TThemeTextAlign;
  verticalAlign?: TThemeVerticalAlign;
};

export type TThemeCanvasColorSwatch = Readonly<{
  code: TCanvasFillColorCode;
  label: string;
  color: string;
  value: TThemeSrgbColor;
}>;

export type TThemeCanvasInkSwatch = Readonly<{
  code: TCanvasInkColorCode;
  label: string;
  color: string;
  value: TThemeSrgbColor;
}>;

export type TThemeColorPickerPalette = Readonly<{
  fillQuick: readonly TThemeCanvasColorSwatch[];
  strokeQuick: readonly TThemeCanvasInkSwatch[];
}>;

export type TThemeColorValueMap = Readonly<{
  fill: Readonly<Record<TCanvasFillColorCode, string>>;
  ink: Readonly<Record<TCanvasInkColorCode, string>>;
}>;

export type TThemeTokenOption<TToken extends string, TValue> = {
  token: TToken;
  label: string;
  value: TValue;
};
export type TThemeStrokeWidthOption =
  TThemeTokenOption<TThemeStrokeWidthToken, number>;
export type TThemeCornerRadiusOption =
  TThemeTokenOption<TThemeCornerRadiusToken, number>;
export type TThemeFontSizeOption = TThemeTokenOption<TThemeFontSizeToken, number>;
export type TThemeStrokeStyleOption = {
  value: TThemeStrokeStyle;
  label: string;
};
export type TThemeTextAlignOption = { value: TThemeTextAlign; label: string };
export type TThemeVerticalAlignOption = {
  value: TThemeVerticalAlign;
  label: string;
};
export type TThemeStrokeWidthValueMap =
  Record<TThemeStrokeWidthToken, number>;
export type TThemeCornerRadiusValueMap =
  Record<TThemeCornerRadiusToken, number>;
export type TThemeFontSizeValueMap = Record<TThemeFontSizeToken, number>;
export type TThemeStyleDefaultsMap =
  Record<TThemeStyleScopeId, TThemeCanvasStyle>;

export type TThemeRememberedStyle = {
  fillColor?: TCanvasFillColorCode;
  backgroundColor?: TCanvasFillColorCode;
  strokeColor?: TCanvasInkColorCode;
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

export type TThemeRememberedStyleMap = Partial<Record<
  TThemeStyleScopeId,
  Partial<TThemeRememberedStyle>
>>;

export type TResolvedThemeCanvasStyle = {
  merged: TThemeCanvasStyle;
  runtime: {
    backgroundColor?: TThemeSrgbColor;
    strokeColor?: TThemeSrgbColor;
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

export type TCanvasThemeStyle = Readonly<{ id: string }>
  & TThemeDefinition["canvas"];
