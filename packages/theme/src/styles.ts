/** Pure role-aware canvas color resolution and picker presentation. */

import {
  CANVAS_COLOR_CODES,
  CANVAS_INK_COLOR_CODES,
} from "./CONSTANTS.js";
import { fnIsCanvasColorCode } from "./fn.validation.js";
import type {
  TCanvasColorCode,
  TCanvasColorRole,
  TCanvasInkColorCode,
  TCanvasThemeStyle,
  TThemeColorPickerPalette,
  TThemeColorValueMap,
  TThemeDefinition,
  TThemeSrgbColor,
} from "./types.js";

function fnCanvasColorLabel(code: TCanvasColorCode): string {
  return code.charAt(0).toUpperCase() + code.slice(1);
}

export function fnThemeSrgbColorToCss(color: TThemeSrgbColor): string {
  const channels = [color.r, color.g, color.b].map(
    (channel) => Math.round(channel * 255),
  );
  if (color.a === 0) return "transparent";
  if (color.a < 1) return `rgba(${channels.join(", ")}, ${color.a})`;
  return `#${channels.map(
    (channel) => channel.toString(16).padStart(2, "0"),
  ).join("")}`;
}

export function fnIsThemeColorToken(
  value: string | undefined | null,
): value is TCanvasColorCode {
  return fnIsCanvasColorCode(value);
}

export function fnGetThemeStyle(theme: TThemeDefinition): TCanvasThemeStyle {
  return { id: theme.id, ...theme.canvas };
}

export function fnResolveThemeCanvasColor(
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

export function fnResolveThemeColor(
  theme: TThemeDefinition,
  value: string | undefined,
  fallback?: string,
  role: TCanvasColorRole = "fill",
): string | undefined {
  if (value === undefined) return fallback;
  if (!fnIsCanvasColorCode(value)) return value;
  return fnThemeSrgbColorToCss(fnResolveThemeCanvasColor(theme, value, role));
}

export function fnGetThemeColorValueMap(
  theme: TThemeDefinition,
): TThemeColorValueMap {
  return {
    fill: Object.fromEntries(CANVAS_COLOR_CODES.map((code) => [
      code,
      fnThemeSrgbColorToCss(theme.canvas.colors[code].fill),
    ])) as TThemeColorValueMap["fill"],
    ink: Object.fromEntries(CANVAS_INK_COLOR_CODES.map((code) => [
      code,
      fnThemeSrgbColorToCss(theme.canvas.colors[code].ink),
    ])) as TThemeColorValueMap["ink"],
  };
}

export function fnGetThemeColorPickerPalette(
  theme: TThemeDefinition,
): TThemeColorPickerPalette {
  const swatch = (code: TCanvasColorCode, role: TCanvasColorRole) => {
    const value = fnResolveThemeCanvasColor(theme, code, role);
    return {
      code,
      label: fnCanvasColorLabel(code),
      color: fnThemeSrgbColorToCss(value),
      value,
    };
  };
  return {
    fillQuick: CANVAS_COLOR_CODES.map((code) => swatch(code, "fill")),
    strokeQuick: CANVAS_INK_COLOR_CODES.map((code) => (
      swatch(code, "ink") as ReturnType<typeof swatch> & {
        code: TCanvasInkColorCode;
      }
    )),
  };
}
