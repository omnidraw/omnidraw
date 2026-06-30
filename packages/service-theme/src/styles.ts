import {
  DEFAULT_THEME_ID,
  type ThemeId,
  type TThemeDefinition,
} from "./builtins";
import { STYLE_DARK } from "./style.dark";
import { STYLE_GRAPHITE } from "./style.graphite";
import { STYLE_LIGHT } from "./style.light";
import { STYLE_SEPIA } from "./style.sepia";
import {
  THEME_COLOR_FAMILIES,
  THEME_COLOR_STEPS,
  type TCanvasThemeStyle,
  type TThemeColorFamily,
  type TThemeColorPickerPalette,
  type TThemeColorPaletteGroup,
  type TThemeColorSwatch,
  type TThemeColorToken,
  type TThemeColorValueMap,
} from "./types";

export const BUILTIN_THEME_STYLES = [
  STYLE_LIGHT,
  STYLE_DARK,
  STYLE_SEPIA,
  STYLE_GRAPHITE,
] as const satisfies readonly TCanvasThemeStyle[];

const THEME_STYLE_MAP = new Map<ThemeId, TCanvasThemeStyle>(
  BUILTIN_THEME_STYLES.map((style) => [style.id, style]),
);

function getFamilyLabel(family: TThemeColorFamily) {
  return family.charAt(0).toUpperCase() + family.slice(1);
}

function getThemeId(value: ThemeId | TThemeDefinition) {
  return typeof value === "string" ? value : value.id;
}

export function isThemeColorToken(value: string | undefined | null): value is TThemeColorToken {
  if (!value || !value.startsWith("@")) {
    return false;
  }

  if (value === "@transparent") {
    return true;
  }

  const [family, step] = value.slice(1).split("/");
  return THEME_COLOR_FAMILIES.includes(family as TThemeColorFamily)
    && THEME_COLOR_STEPS.includes(step as (typeof THEME_COLOR_STEPS)[number]);
}

export function getThemeStyle(value: ThemeId | TThemeDefinition) {
  const themeId = getThemeId(value);
  return THEME_STYLE_MAP.get(themeId)
    ?? THEME_STYLE_MAP.get(DEFAULT_THEME_ID)
    ?? BUILTIN_THEME_STYLES[0];
}

export function resolveThemeColor(
  theme: ThemeId | TThemeDefinition,
  value: string | undefined,
  fallback?: string,
) {
  if (!value) {
    return fallback;
  }

  if (!isThemeColorToken(value)) {
    return value;
  }

  if (value === "@transparent") {
    return "transparent";
  }

  const [family, step] = value.slice(1).split("/") as [TThemeColorFamily, (typeof THEME_COLOR_STEPS)[number]];
  const style = getThemeStyle(theme);
  return style.palette[family]?.[step] ?? fallback;
}

export function getThemeColorValueMap(theme: ThemeId | TThemeDefinition): TThemeColorValueMap {
  const style = getThemeStyle(theme);
  const entries: Array<[TThemeColorToken, string]> = [["@transparent", "transparent"]];

  THEME_COLOR_FAMILIES.forEach((family) => {
    THEME_COLOR_STEPS.forEach((step) => {
      entries.push([`@${family}/${step}`, style.palette[family][step]]);
    });
  });

  return Object.fromEntries(entries) as TThemeColorValueMap;
}

export function getThemeColorPickerPalette(theme: ThemeId | TThemeDefinition): TThemeColorPickerPalette {
  const style = getThemeStyle(theme);
  const colorValueMap = getThemeColorValueMap(style.id);

  const toSwatch = (token: TThemeColorToken): TThemeColorSwatch => {
    return {
      token,
      label: token === "@transparent" ? "Transparent" : token.slice(1),
      color: colorValueMap[token] ?? "transparent",
    };
  };

  const groups: TThemeColorPaletteGroup[] = THEME_COLOR_FAMILIES.map((family) => {
    return {
      id: family,
      label: getFamilyLabel(family),
      swatches: THEME_COLOR_STEPS.map((step) => toSwatch(`@${family}/${step}`)),
    };
  });

  return {
    fillQuick: style.fillQuick.map(toSwatch),
    strokeQuick: style.strokeQuick.map(toSwatch),
    groups,
  };
}
