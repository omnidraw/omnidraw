/** @file Pure validation for complete theme registrations and canvas codes. */

import {
  CANVAS_COLOR_CODES,
  CANVAS_INK_COLOR_CODES,
  THEME_APPEARANCES,
  THEME_UI_COLOR_ROLES,
} from "./CONSTANTS.js";
import type {
  TCanvasColorCode,
  TCanvasInkColorCode,
  TThemeDefinition,
  TThemeSrgbColor,
} from "./types.js";

function fnRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function fnIsCanvasColorCode(value: unknown): value is TCanvasColorCode {
  return typeof value === "string"
    && CANVAS_COLOR_CODES.includes(value as TCanvasColorCode);
}

export function fnIsCanvasInkColorCode(value: unknown): value is TCanvasInkColorCode {
  return typeof value === "string"
    && CANVAS_INK_COLOR_CODES.includes(value as TCanvasInkColorCode);
}

export function fnThemeSrgbColorValid(value: unknown): value is TThemeSrgbColor {
  const color = fnRecord(value);
  if (color === null || color.space !== "srgb") return false;
  return [color.r, color.g, color.b, color.a].every(
    (channel) => typeof channel === "number" && Number.isFinite(channel)
      && channel >= 0 && channel <= 1,
  );
}

export function fnThemeDefinitionIssues(value: unknown): readonly string[] {
  const definition = fnRecord(value);
  if (definition === null) return ["theme must be an object"];
  const issues: string[] = [];
  if (typeof definition.id !== "string" || definition.id.trim().length === 0) {
    issues.push("id must be a non-empty string");
  }
  if (typeof definition.label !== "string" || definition.label.trim().length === 0) {
    issues.push("label must be a non-empty string");
  }
  if (!THEME_APPEARANCES.includes(definition.appearance as never)) {
    issues.push("appearance must be light or dark");
  }
  const ui = fnRecord(definition.ui);
  for (const role of THEME_UI_COLOR_ROLES) {
    if (typeof ui?.[role] !== "string" || (ui[role] as string).trim().length === 0) {
      issues.push(`ui.${role} must be a non-empty CSS color`);
    }
  }
  const canvas = fnRecord(definition.canvas);
  const colors = fnRecord(canvas?.colors);
  for (const code of CANVAS_COLOR_CODES) {
    const resolution = fnRecord(colors?.[code]);
    if (!fnThemeSrgbColorValid(resolution?.fill)) {
      issues.push(`canvas.colors.${code}.fill must be a bounded sRGB color`);
    }
    if (code !== "transparent" && !fnThemeSrgbColorValid(resolution?.ink)) {
      issues.push(`canvas.colors.${code}.ink must be a bounded sRGB color`);
    }
  }
  const viewport = fnRecord(canvas?.viewport);
  for (const role of ["background", "gridMinor", "gridMajor"] as const) {
    if (!fnThemeSrgbColorValid(viewport?.[role])) {
      issues.push(`canvas.viewport.${role} must be a bounded sRGB color`);
    }
  }
  const stringGroups = [
    ["canvas.chrome", canvas?.chrome, [
      "selectionFill", "selectionStroke", "groupBoundary", "debugText",
      "text", "textEditorOutline",
    ]],
    ["terminal", definition.terminal, [
      "background", "foreground", "cursor", "selectionBackground",
      "mutedForeground", "errorForeground", "warningForeground",
      "successForeground",
    ]],
  ] as const;
  for (const [path, candidate, roles] of stringGroups) {
    const group = fnRecord(candidate);
    for (const role of roles) {
      if (typeof group?.[role] !== "string" || (group[role] as string).trim().length === 0) {
        issues.push(`${path}.${role} must be a non-empty CSS color`);
      }
    }
  }
  const appearances = [
    {
      path: "canvas.selection",
      candidate: canvas?.selection,
      colorRoles: ["outline", "handleFill", "handleStroke"],
      numberRoles: ["handleSize", "rotateHandleOffset", "outlinePadding"],
      numbersMustBePositive: false,
    },
    {
      path: "canvas.path",
      candidate: canvas?.path,
      colorRoles: ["outline", "anchorFill", "midpointFill", "handleStroke"],
      numberRoles: ["handleSize", "midpointSize", "rotateOffset"],
      numbersMustBePositive: true,
    },
  ] as const;
  for (const {
    path,
    candidate,
    colorRoles,
    numberRoles,
    numbersMustBePositive,
  } of appearances) {
    const appearance = fnRecord(candidate);
    for (const role of colorRoles) {
      if (!fnThemeSrgbColorValid(appearance?.[role])) {
        issues.push(`${path}.${role} must be a bounded sRGB color`);
      }
    }
    for (const role of numberRoles) {
      const entry = appearance?.[role];
      const invalid = typeof entry !== "number"
        || !Number.isFinite(entry)
        || (numbersMustBePositive ? entry <= 0 : entry < 0);
      if (invalid) {
        issues.push(
          `${path}.${role} must be finite and ${
            numbersMustBePositive ? "positive" : "non-negative"
          }`,
        );
      }
    }
  }
  return Object.freeze(issues);
}

export function fnAssertThemeDefinition(
  value: unknown,
): asserts value is TThemeDefinition {
  const issues = fnThemeDefinitionIssues(value);
  if (issues.length === 0) return;
  throw new TypeError(`Invalid theme definition:\n${issues.join("\n")}`);
}
