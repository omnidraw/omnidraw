/** @file Pure role-aware canvas color resolution and picker presentation. */

import {
  CANVAS_COLOR_CODES,
  CANVAS_INK_COLOR_CODES,
  fnIsCanvasColorCode,
} from "@omnidraw/theme-contract";
import type {
  TCanvasColorCode,
  TCanvasColorRole,
  TCanvasInkColorCode,
  TThemeDefinition,
  TThemeSrgbColor,
} from "@omnidraw/theme-contract";
import type {
  TCanvasThemeStyle,
  TThemeColorPickerPalette,
  TThemeColorValueMap,
} from "./types.js";

function label(code: TCanvasColorCode): string {
  return code.charAt(0).toUpperCase() + code.slice(1);
}

export function themeSrgbColorToCss(color: TThemeSrgbColor): string {
  const channels = [color.r, color.g, color.b].map((channel) => Math.round(channel * 255));
  if (color.a === 0) return "transparent";
  if (color.a < 1) return `rgba(${channels.join(", ")}, ${color.a})`;
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function isThemeColorToken(value: string | undefined | null): value is TCanvasColorCode {
  return fnIsCanvasColorCode(value);
}

export function getThemeStyle(theme: TThemeDefinition): TCanvasThemeStyle {
  return { id: theme.id, ...theme.canvas };
}

export function resolveThemeCanvasColor(
  theme: TThemeDefinition,
  code: TCanvasColorCode,
  role: TCanvasColorRole,
): TThemeSrgbColor {
  const resolution = theme.canvas.colors[code];
  if (role === "fill") return resolution.fill;
  if (code === "transparent") {
    throw new RangeError("Transparent is valid only for canvas fill.");
  }
  return theme.canvas.colors[code].ink;
}

export function resolveThemeColor(
  theme: TThemeDefinition,
  value: string | undefined,
  fallback?: string,
  role: TCanvasColorRole = "fill",
): string | undefined {
  if (value === undefined) return fallback;
  if (!fnIsCanvasColorCode(value)) return value;
  return themeSrgbColorToCss(resolveThemeCanvasColor(theme, value, role));
}

export function getThemeColorValueMap(theme: TThemeDefinition): TThemeColorValueMap {
  return {
    fill: Object.fromEntries(CANVAS_COLOR_CODES.map((code) => [
      code,
      themeSrgbColorToCss(theme.canvas.colors[code].fill),
    ])) as TThemeColorValueMap["fill"],
    ink: Object.fromEntries(CANVAS_INK_COLOR_CODES.map((code) => [
      code,
      themeSrgbColorToCss(theme.canvas.colors[code].ink),
    ])) as TThemeColorValueMap["ink"],
  };
}

export function getThemeColorPickerPalette(theme: TThemeDefinition): TThemeColorPickerPalette {
  const swatch = (code: TCanvasColorCode, role: TCanvasColorRole) => {
    const value = resolveThemeCanvasColor(theme, code, role);
    return { code, label: label(code), color: themeSrgbColorToCss(value), value };
  };
  return {
    fillQuick: CANVAS_COLOR_CODES.map((code) => swatch(code, "fill")),
    strokeQuick: CANVAS_INK_COLOR_CODES.map((code) => (
      swatch(code, "ink") as ReturnType<typeof swatch> & { code: TCanvasInkColorCode }
    )),
  };
}
