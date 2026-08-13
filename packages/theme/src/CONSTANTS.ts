/** Stable theme, semantic canvas-color, and DOM scope vocabularies. */

export const THEME_APPEARANCES = ["light", "dark"] as const;

export const THEME_UI_COLOR_ROLES = [
  "background",
  "foreground",
  "card",
  "cardForeground",
  "popover",
  "popoverForeground",
  "muted",
  "mutedForeground",
  "primary",
  "primaryForeground",
  "secondary",
  "secondaryForeground",
  "accent",
  "accentForeground",
  "destructive",
  "destructiveForeground",
  "success",
  "successForeground",
  "warning",
  "warningForeground",
  "border",
  "input",
  "ring",
  "hover",
  "hoverForeground",
  "active",
  "activeForeground",
  "selected",
  "selectedForeground",
  "focusVisible",
  "disabled",
  "disabledForeground",
] as const;

export const CANVAS_COLOR_CODES = [
  "transparent",
  "neutral",
  "red",
  "yellow",
  "green",
  "blue",
] as const;

export const CANVAS_FILL_COLOR_CODES = CANVAS_COLOR_CODES;
export const CANVAS_INK_COLOR_CODES = [
  "neutral",
  "red",
  "yellow",
  "green",
  "blue",
] as const;

export const CANVAS_COLOR_ROLES = ["fill", "ink"] as const;

export const OMNIDRAW_THEME_SCOPE_ATTRIBUTE = "data-omnidraw-theme-scope";
export const OMNIDRAW_THEME_ID_ATTRIBUTE = "data-omnidraw-theme-id";
export const OMNIDRAW_THEME_APPEARANCE_ATTRIBUTE =
  "data-omnidraw-theme-appearance";
export const OMNIDRAW_THEME_DARK_CLASS = "omnidraw-theme-dark";
