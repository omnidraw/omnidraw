/** @file Stable theme and canvas-color vocabularies. */

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
