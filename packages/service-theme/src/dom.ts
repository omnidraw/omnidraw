import type { TThemeDefinition } from "./builtins";

const CSS_VARIABLE_ENTRIES = [
  ["--background", "background"],
  ["--foreground", "foreground"],
  ["--card", "card"],
  ["--card-foreground", "cardForeground"],
  ["--popover", "popover"],
  ["--popover-foreground", "popoverForeground"],
  ["--muted", "muted"],
  ["--muted-foreground", "mutedForeground"],
  ["--primary", "primary"],
  ["--primary-foreground", "primaryForeground"],
  ["--secondary", "secondary"],
  ["--secondary-foreground", "secondaryForeground"],
  ["--accent", "accent"],
  ["--accent-foreground", "accentForeground"],
  ["--destructive", "destructive"],
  ["--destructive-foreground", "destructiveForeground"],
  ["--success", "success"],
  ["--success-foreground", "successForeground"],
  ["--warning", "warning"],
  ["--warning-foreground", "warningForeground"],
  ["--border", "border"],
  ["--input", "input"],
  ["--ring", "ring"],
  ["--vc-canvas-background", "canvasBackground"],
  ["--vc-canvas-grid-minor", "canvasGridMinor"],
  ["--vc-canvas-grid-major", "canvasGridMajor"],
  ["--vc-canvas-selection-fill", "canvasSelectionFill"],
  ["--vc-canvas-selection-stroke", "canvasSelectionStroke"],
  ["--vc-canvas-group-boundary", "canvasGroupBoundary"],
  ["--vc-canvas-debug-text", "canvasDebugText"],
  ["--vc-canvas-text", "canvasText"],
  ["--vc-canvas-text-editor-outline", "canvasTextEditorOutline"],
  ["--vc-terminal-background", "terminalBackground"],
  ["--vc-terminal-foreground", "terminalForeground"],
  ["--vc-terminal-cursor", "terminalCursor"],
  ["--vc-terminal-selection-background", "terminalSelectionBackground"],
  ["--vc-terminal-error-foreground", "terminalErrorForeground"],
] as const satisfies ReadonlyArray<readonly [string, keyof TThemeDefinition["colors"]]>;

export function fxGetThemeCssVariables(theme: TThemeDefinition) {
  return Object.fromEntries(CSS_VARIABLE_ENTRIES.map(([cssVariable, colorKey]) => {
    return [cssVariable, theme.colors[colorKey]];
  })) as Record<string, string>;
}

export function txApplyThemeToElement(element: HTMLElement, theme: TThemeDefinition) {
  const cssVariables = fxGetThemeCssVariables(theme);

  Object.entries(cssVariables).forEach(([cssVariable, value]) => {
    element.style.setProperty(cssVariable, value);
  });

  element.dataset.themeId = theme.id;
  element.dataset.themeAppearance = theme.appearance;
  element.classList.toggle("dark", theme.appearance === "dark");
}
