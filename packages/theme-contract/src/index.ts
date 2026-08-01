/** @file Public state-free theme contract surface. */

export {
  CANVAS_COLOR_CODES,
  CANVAS_COLOR_ROLES,
  CANVAS_FILL_COLOR_CODES,
  CANVAS_INK_COLOR_CODES,
  THEME_APPEARANCES,
  THEME_UI_COLOR_ROLES,
} from "./CONSTANTS.js";
export {
  fnAssertThemeDefinition,
  fnIsCanvasColorCode,
  fnIsCanvasInkColorCode,
  fnThemeDefinitionIssues,
  fnThemeSrgbColorValid,
} from "./fn.validation.js";
export type {
  ThemeId,
  TCanvasColorCode,
  TCanvasColorRole,
  TCanvasFillColorCode,
  TCanvasInkColorCode,
  TThemeAppearance,
  TThemeCanvasChrome,
  TThemeCanvasColorPalette,
  TThemeCanvasViewport,
  TThemeDefinition,
  TThemeDefinitionInheritance,
  TThemePathAppearance,
  TThemeRegistration,
  TThemeSelectionAppearance,
  TThemeSnapshot,
  TThemeSrgbColor,
  TThemeTerminalColors,
  TThemeUiColorRole,
  TThemeUiColors,
} from "./types.js";
