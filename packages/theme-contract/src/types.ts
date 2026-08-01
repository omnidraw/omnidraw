/** @file Complete atomic theme and semantic canvas-color types. */

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
    }> & Partial<Record<TCanvasInkColorCode, Partial<TThemeCanvasColorPalette[TCanvasInkColorCode]>>>;
    viewport?: Partial<TThemeCanvasViewport>;
    chrome?: Partial<TThemeCanvasChrome>;
    selection?: Partial<TThemeSelectionAppearance>;
    path?: Partial<TThemePathAppearance>;
  }>;
  terminal?: Partial<TThemeTerminalColors>;
}>;

export type TThemeRegistration = TThemeDefinition | TThemeDefinitionInheritance;

export type TThemeSnapshot = Readonly<{
  revision: number;
  themeId: ThemeId;
  definition: TThemeDefinition;
}>;
