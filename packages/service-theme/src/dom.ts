/** @file ThemeService snapshot projection to DOM CSS variables. */

import type { TThemeDefinition } from "@omnidraw/theme-contract";

export function fxGetThemeCssVariables(theme: TThemeDefinition): Readonly<Record<string, string>> {
  const ui = theme.ui;
  const chrome = theme.canvas.chrome;
  const terminal = theme.terminal;
  return Object.freeze({
    "--background": ui.background,
    "--foreground": ui.foreground,
    "--card": ui.card,
    "--card-foreground": ui.cardForeground,
    "--popover": ui.popover,
    "--popover-foreground": ui.popoverForeground,
    "--muted": ui.muted,
    "--muted-foreground": ui.mutedForeground,
    "--primary": ui.primary,
    "--primary-foreground": ui.primaryForeground,
    "--secondary": ui.secondary,
    "--secondary-foreground": ui.secondaryForeground,
    "--accent": ui.accent,
    "--accent-foreground": ui.accentForeground,
    "--destructive": ui.destructive,
    "--destructive-foreground": ui.destructiveForeground,
    "--success": ui.success,
    "--success-foreground": ui.successForeground,
    "--warning": ui.warning,
    "--warning-foreground": ui.warningForeground,
    "--border": ui.border,
    "--input": ui.input,
    "--ring": ui.ring,
    "--hover": ui.hover,
    "--hover-foreground": ui.hoverForeground,
    "--active": ui.active,
    "--active-foreground": ui.activeForeground,
    "--selected": ui.selected,
    "--selected-foreground": ui.selectedForeground,
    "--focus-visible": ui.focusVisible,
    "--disabled": ui.disabled,
    "--disabled-foreground": ui.disabledForeground,
    "--vc-canvas-selection-fill": chrome.selectionFill,
    "--vc-canvas-selection-stroke": chrome.selectionStroke,
    "--vc-canvas-group-boundary": chrome.groupBoundary,
    "--vc-canvas-debug-text": chrome.debugText,
    "--vc-canvas-text": chrome.text,
    "--vc-canvas-text-editor-outline": chrome.textEditorOutline,
    "--vc-terminal-background": terminal.background,
    "--vc-terminal-foreground": terminal.foreground,
    "--vc-terminal-cursor": terminal.cursor,
    "--vc-terminal-selection-background": terminal.selectionBackground,
    "--vc-terminal-muted-foreground": terminal.mutedForeground,
    "--vc-terminal-error-foreground": terminal.errorForeground,
    "--vc-terminal-warning-foreground": terminal.warningForeground,
    "--vc-terminal-success-foreground": terminal.successForeground,
    "--preview-terminal-background": terminal.background,
    "--preview-terminal-foreground": terminal.foreground,
    "--preview-terminal-muted": terminal.mutedForeground,
    "--preview-terminal-error": terminal.errorForeground,
    "--preview-terminal-warning": terminal.warningForeground,
    "--preview-terminal-success": terminal.successForeground,
    // Compatibility aliases for consumers migrating from the old raw scales.
    "--stone-50": ui.background,
    "--stone-100": ui.card,
    "--stone-200": ui.hover,
    "--stone-300": ui.border,
    "--stone-400": ui.disabledForeground,
    "--stone-500": ui.mutedForeground,
    "--stone-600": ui.mutedForeground,
    "--stone-700": ui.active,
    "--stone-800": ui.active,
    "--stone-900": ui.foreground,
    "--stone-950": ui.foreground,
    "--amber-100": ui.selected,
    "--amber-200": ui.accent,
    "--amber-300": ui.warning,
    "--amber-400": ui.warning,
    "--amber-500": ui.primary,
    "--amber-600": ui.warning,
    "--amber-700": ui.accentForeground,
    "--red-500": ui.destructive,
    "--red-600": ui.destructive,
    "--red-700": ui.destructive,
    "--green-500": ui.success,
    "--green-600": ui.success,
    "--gray-400": ui.disabledForeground,
    "--white": ui.popover,
  });
}

export function txApplyThemeToElement(element: HTMLElement, theme: TThemeDefinition) {
  for (const [cssVariable, value] of Object.entries(fxGetThemeCssVariables(theme))) {
    element.style.setProperty(cssVariable, value);
  }
  element.style.colorScheme = theme.appearance;
  element.dataset.themeId = theme.id;
  element.dataset.themeAppearance = theme.appearance;
  element.classList.toggle("dark", theme.appearance === "dark");
}
