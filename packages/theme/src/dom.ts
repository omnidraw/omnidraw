/** Pure CSS projection plus one explicitly scoped DOM application helper. */

import {
  CANVAS_COLOR_CODES,
  CANVAS_INK_COLOR_CODES,
  OMNIDRAW_THEME_APPEARANCE_ATTRIBUTE,
  OMNIDRAW_THEME_DARK_CLASS,
  OMNIDRAW_THEME_ID_ATTRIBUTE,
  OMNIDRAW_THEME_SCOPE_ATTRIBUTE,
  THEME_UI_COLOR_ROLES,
} from "./CONSTANTS.js";
import { fnThemeSrgbColorToCss } from "./styles.js";
import type { TThemeDefinition } from "./types.js";

function fnKebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

export function fnGetThemeCssVariables(
  theme: TThemeDefinition,
): Readonly<Record<`--omnidraw-${string}`, string>> {
  const variables: Record<`--omnidraw-${string}`, string> = Object.fromEntries(
    THEME_UI_COLOR_ROLES.map((role) => [
      `--omnidraw-${fnKebabCase(role)}`,
      theme.ui[role],
    ]),
  );

  for (const code of CANVAS_COLOR_CODES) {
    variables[`--omnidraw-canvas-color-${code}-fill`] =
      fnThemeSrgbColorToCss(theme.canvas.colors[code].fill);
  }
  for (const code of CANVAS_INK_COLOR_CODES) {
    variables[`--omnidraw-canvas-color-${code}-ink`] =
      fnThemeSrgbColorToCss(theme.canvas.colors[code].ink);
  }

  const viewport = theme.canvas.viewport;
  variables["--omnidraw-canvas-viewport-background"] =
    fnThemeSrgbColorToCss(viewport.background);
  variables["--omnidraw-canvas-grid-minor"] =
    fnThemeSrgbColorToCss(viewport.gridMinor);
  variables["--omnidraw-canvas-grid-major"] =
    fnThemeSrgbColorToCss(viewport.gridMajor);

  const chrome = theme.canvas.chrome;
  variables["--omnidraw-canvas-selection-fill"] = chrome.selectionFill;
  variables["--omnidraw-canvas-selection-stroke"] = chrome.selectionStroke;
  variables["--omnidraw-canvas-group-boundary"] = chrome.groupBoundary;
  variables["--omnidraw-canvas-debug-text"] = chrome.debugText;
  variables["--omnidraw-canvas-text"] = chrome.text;
  variables["--omnidraw-canvas-text-editor-outline"] =
    chrome.textEditorOutline;

  const selection = theme.canvas.selection;
  variables["--omnidraw-canvas-selection-outline"] =
    fnThemeSrgbColorToCss(selection.outline);
  variables["--omnidraw-canvas-selection-handle-fill"] =
    fnThemeSrgbColorToCss(selection.handleFill);
  variables["--omnidraw-canvas-selection-handle-stroke"] =
    fnThemeSrgbColorToCss(selection.handleStroke);
  variables["--omnidraw-canvas-selection-handle-size"] =
    `${selection.handleSize}px`;
  variables["--omnidraw-canvas-selection-rotate-handle-offset"] =
    `${selection.rotateHandleOffset}px`;
  variables["--omnidraw-canvas-selection-outline-padding"] =
    `${selection.outlinePadding}px`;

  const path = theme.canvas.path;
  variables["--omnidraw-canvas-path-outline"] =
    fnThemeSrgbColorToCss(path.outline);
  variables["--omnidraw-canvas-path-anchor-fill"] =
    fnThemeSrgbColorToCss(path.anchorFill);
  variables["--omnidraw-canvas-path-midpoint-fill"] =
    fnThemeSrgbColorToCss(path.midpointFill);
  variables["--omnidraw-canvas-path-handle-stroke"] =
    fnThemeSrgbColorToCss(path.handleStroke);
  variables["--omnidraw-canvas-path-handle-size"] = `${path.handleSize}px`;
  variables["--omnidraw-canvas-path-midpoint-size"] =
    `${path.midpointSize}px`;
  variables["--omnidraw-canvas-path-rotate-offset"] =
    `${path.rotateOffset}px`;

  for (const [role, value] of Object.entries(theme.terminal)) {
    variables[`--omnidraw-terminal-${fnKebabCase(role)}`] = value;
  }

  return Object.freeze(variables);
}

export function fnThemeCssRule(theme: TThemeDefinition): string {
  const declarations = Object.entries(fnGetThemeCssVariables(theme))
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
  return [
    `[${OMNIDRAW_THEME_SCOPE_ATTRIBUTE}] {`,
    `  color-scheme: ${theme.appearance};`,
    declarations,
    "}",
    "",
  ].join("\n");
}

/**
 * Applies one complete theme to a host explicitly marked as an Omnidraw scope.
 * This function never reads or mutates `document`, `documentElement`, or any
 * node other than the element supplied by the caller.
 */
export function applyThemeToElement(
  element: HTMLElement,
  theme: TThemeDefinition,
): void {
  if (!element.hasAttribute(OMNIDRAW_THEME_SCOPE_ATTRIBUTE)) {
    throw new TypeError(
      `Theme hosts must be marked with ${OMNIDRAW_THEME_SCOPE_ATTRIBUTE}.`,
    );
  }
  for (const [cssVariable, value] of Object.entries(
    fnGetThemeCssVariables(theme),
  )) {
    element.style.setProperty(cssVariable, value);
  }
  element.style.colorScheme = theme.appearance;
  element.setAttribute(OMNIDRAW_THEME_ID_ATTRIBUTE, theme.id);
  element.setAttribute(
    OMNIDRAW_THEME_APPEARANCE_ATTRIBUTE,
    theme.appearance,
  );
  element.classList.toggle(
    OMNIDRAW_THEME_DARK_CLASS,
    theme.appearance === "dark",
  );
}
