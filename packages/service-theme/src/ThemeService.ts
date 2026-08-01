import {
  BUILTIN_THEMES,
  DEFAULT_THEME_ID,
  type ThemeId,
  type TThemeDefinition,
} from "./builtins.js";
import type {
  IThemeService,
  TThemeChangeListener,
  TThemeRegistryChangeListener,
  TThemeRememberedStyleChangeListener,
} from "./interface.js";
import {
  THEME_CORNER_RADIUS_OPTIONS,
  THEME_CORNER_RADIUS_VALUE_MAP,
  THEME_FONT_SIZE_OPTIONS,
  THEME_FONT_SIZE_VALUE_MAP,
  THEME_STROKE_STYLE_OPTIONS,
  THEME_STROKE_WIDTH_OPTIONS,
  THEME_STROKE_WIDTH_VALUE_MAP,
  THEME_STYLE_DEFAULTS_BY_SCOPE,
  THEME_TEXT_ALIGN_OPTIONS,
  THEME_VERTICAL_ALIGN_OPTIONS,
} from "./style.shared.js";
import {
  getThemeColorPickerPalette as getThemeColorPickerPaletteFromTheme,
  getThemeColorValueMap,
  getThemeStyle,
  resolveThemeColor as resolveThemeColorFromTheme,
} from "./styles.js";
import type {
  TCanvasThemeStyle,
  TResolvedThemeCanvasStyle,
  TThemeCanvasStyle,
  TThemeColorPickerPalette,
  TThemeColorValueMap,
  TThemeCornerRadiusOption,
  TThemeCornerRadiusValueMap,
  TThemeFontSizeOption,
  TThemeFontSizeValueMap,
  TThemeRememberedStyle,
  TThemeRememberedStyleMap,
  TThemeStrokeStyle,
  TThemeStrokeStyleOption,
  TThemeStrokeWidthOption,
  TThemeStrokeWidthValueMap,
  TThemeStyleDefaultsMap,
  TThemeStyleScopeId,
  TThemeTextAlignOption,
  TThemeVerticalAlignOption,
} from "./types.js";

export type TThemeServiceArgs = Readonly<{
  themes?: readonly TThemeDefinition[];
  initialThemeId?: ThemeId;
}>;

function parseNumericTokenValue(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cloneStyle(value: Partial<TThemeCanvasStyle> | null | undefined) {
  return structuredClone(value ?? {});
}

function cloneRememberedStyle(value: Partial<TThemeRememberedStyle> | null | undefined) {
  return structuredClone(value ?? {});
}

function cloneThemeDefinition(value: TThemeDefinition) {
  return structuredClone(value);
}

function shallowStyleEqual(left: Partial<TThemeCanvasStyle>, right: Partial<TThemeCanvasStyle>) {
  const leftEntries = Object.entries(left).filter(([, value]) => value !== undefined);
  const rightEntries = Object.entries(right).filter(([, value]) => value !== undefined);

  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(([key, value]) => right[key as keyof TThemeCanvasStyle] === value);
}

function shallowRememberedStyleEqual(left: Partial<TThemeRememberedStyle>, right: Partial<TThemeRememberedStyle>) {
  const leftEntries = Object.entries(left).filter(([, value]) => value !== undefined);
  const rightEntries = Object.entries(right).filter(([, value]) => value !== undefined);

  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(([key, value]) => right[key as keyof TThemeRememberedStyle] === value);
}

export class ThemeService implements IThemeService {
  readonly name = "theme";

  #themes = new Map<ThemeId, TThemeDefinition>();
  #themeId: ThemeId = DEFAULT_THEME_ID;
  #rememberedStyles = new Map<TThemeStyleScopeId, Partial<TThemeRememberedStyle>>();
  #themeChangeListeners = new Set<TThemeChangeListener>();
  #themeRegistryChangeListeners = new Set<TThemeRegistryChangeListener>();
  #rememberedStyleChangeListeners = new Set<TThemeRememberedStyleChangeListener>();

  constructor(args: TThemeServiceArgs = {}) {
    this.addThemes(BUILTIN_THEMES);

    if (args.themes && args.themes.length > 0) {
      this.addThemes(args.themes);
    }

    this.#themeId = this.#resolveThemeId(args.initialThemeId);
  }

  getThemeId() {
    return this.#themeId;
  }

  getTheme() {
    return this.#themes.get(this.#themeId) ?? this.#getFallbackTheme();
  }

  getThemes() {
    return [...this.#themes.values()];
  }

  getCanvasThemeStyle(): TCanvasThemeStyle {
    return getThemeStyle(this.getTheme());
  }

  getThemeColorValueMap(): TThemeColorValueMap {
    return getThemeColorValueMap(this.getTheme());
  }

  resolveThemeColor(value: string | undefined, fallback?: string) {
    return resolveThemeColorFromTheme(this.getTheme(), value, fallback);
  }

  getThemeColorPickerPalette(): TThemeColorPickerPalette {
    return getThemeColorPickerPaletteFromTheme(this.getTheme());
  }

  getStrokeWidthOptions(): readonly TThemeStrokeWidthOption[] {
    return [...THEME_STROKE_WIDTH_OPTIONS];
  }

  getStrokeWidthValueMap(): TThemeStrokeWidthValueMap {
    return { ...THEME_STROKE_WIDTH_VALUE_MAP };
  }

  resolveStrokeWidth(value: string | undefined, fallback = 0) {
    if (!value) {
      return fallback;
    }

    return THEME_STROKE_WIDTH_VALUE_MAP[value as keyof TThemeStrokeWidthValueMap]
      ?? parseNumericTokenValue(value, fallback);
  }

  getCornerRadiusOptions(): readonly TThemeCornerRadiusOption[] {
    return [...THEME_CORNER_RADIUS_OPTIONS];
  }

  getCornerRadiusValueMap(): TThemeCornerRadiusValueMap {
    return { ...THEME_CORNER_RADIUS_VALUE_MAP };
  }

  resolveCornerRadius(value: string | undefined, fallback = 0) {
    if (!value) {
      return fallback;
    }

    return THEME_CORNER_RADIUS_VALUE_MAP[value as keyof TThemeCornerRadiusValueMap]
      ?? parseNumericTokenValue(value, fallback);
  }

  getFontSizeOptions(): readonly TThemeFontSizeOption[] {
    return [...THEME_FONT_SIZE_OPTIONS];
  }

  getFontSizeValueMap(): TThemeFontSizeValueMap {
    return { ...THEME_FONT_SIZE_VALUE_MAP };
  }

  resolveFontSize(value: string | undefined, fallback: number = THEME_FONT_SIZE_OPTIONS[0]?.value ?? 16) {
    if (!value) {
      return fallback;
    }

    return THEME_FONT_SIZE_VALUE_MAP[value as keyof TThemeFontSizeValueMap]
      ?? parseNumericTokenValue(value, fallback);
  }

  getStrokeStyleOptions(): readonly TThemeStrokeStyleOption[] {
    return [...THEME_STROKE_STYLE_OPTIONS];
  }

  getTextAlignOptions(): readonly TThemeTextAlignOption[] {
    return [...THEME_TEXT_ALIGN_OPTIONS];
  }

  getVerticalAlignOptions(): readonly TThemeVerticalAlignOption[] {
    return [...THEME_VERTICAL_ALIGN_OPTIONS];
  }

  resolveStrokeDash(strokeStyle: TThemeStrokeStyle | undefined, strokeWidth?: number | string) {
    const resolvedStrokeWidth = typeof strokeWidth === "number"
      ? strokeWidth
      : this.resolveStrokeWidth(strokeWidth, 1);

    if (strokeStyle === "dashed") {
      return [resolvedStrokeWidth * 4, resolvedStrokeWidth * 2];
    }

    if (strokeStyle === "dotted") {
      return [resolvedStrokeWidth, resolvedStrokeWidth * 1.5];
    }

    return [];
  }

  getDefaultStyles(): TThemeStyleDefaultsMap {
    return structuredClone(THEME_STYLE_DEFAULTS_BY_SCOPE);
  }

  getDefaultStyle(scope: TThemeStyleScopeId): TThemeCanvasStyle {
    const defaultsByScope = THEME_STYLE_DEFAULTS_BY_SCOPE as Record<string, TThemeCanvasStyle>;
    return cloneStyle(defaultsByScope[scope]);
  }

  mergeStyleWithDefaults(scope: TThemeStyleScopeId, style?: Partial<TThemeCanvasStyle>): TThemeCanvasStyle {
    return {
      ...this.getDefaultStyle(scope),
      ...cloneStyle(style),
    };
  }

  resolveStyle(scope: TThemeStyleScopeId, style?: Partial<TThemeCanvasStyle>): TResolvedThemeCanvasStyle {
    const merged = this.mergeStyleWithDefaults(scope, style);
    const strokeWidth = this.resolveStrokeWidth(merged.strokeWidth, 0);

    return {
      merged,
      runtime: {
        backgroundColor: this.resolveThemeColor(merged.backgroundColor),
        strokeColor: this.resolveThemeColor(merged.strokeColor),
        strokeWidth,
        opacity: merged.opacity ?? 1,
        cornerRadius: this.resolveCornerRadius(merged.cornerRadius, 0),
        strokeStyle: merged.strokeStyle ?? "solid",
        strokeDash: this.resolveStrokeDash(merged.strokeStyle, strokeWidth),
        fontSize: this.resolveFontSize(merged.fontSize, THEME_FONT_SIZE_OPTIONS[0]?.value ?? 16),
        textAlign: merged.textAlign ?? "left",
        verticalAlign: merged.verticalAlign ?? "top",
      },
    };
  }

  getRememberedStyles(): TThemeRememberedStyleMap {
    return Object.fromEntries(
      [...this.#rememberedStyles.entries()].map(([scope, style]) => [scope, cloneRememberedStyle(style)]),
    ) as TThemeRememberedStyleMap;
  }

  getRememberedStyle(scope: TThemeStyleScopeId): Partial<TThemeRememberedStyle> {
    return cloneRememberedStyle(this.#rememberedStyles.get(scope));
  }

  subscribeThemeChange(listener: TThemeChangeListener) {
    this.#themeChangeListeners.add(listener);
    return () => {
      this.#themeChangeListeners.delete(listener);
    };
  }

  subscribeThemeRegistryChange(listener: TThemeRegistryChangeListener) {
    this.#themeRegistryChangeListeners.add(listener);
    return () => {
      this.#themeRegistryChangeListeners.delete(listener);
    };
  }

  subscribeRememberedStyleChange(listener: TThemeRememberedStyleChangeListener) {
    this.#rememberedStyleChangeListeners.add(listener);
    return () => {
      this.#rememberedStyleChangeListeners.delete(listener);
    };
  }

  setRememberedStyle(scope: TThemeStyleScopeId, patch: Partial<TThemeRememberedStyle>) {
    const current = this.#rememberedStyles.get(scope) ?? {};
    const next = {
      ...cloneRememberedStyle(current),
      ...cloneRememberedStyle(patch),
    } satisfies Partial<TThemeRememberedStyle>;

    Object.keys(next).forEach((key) => {
      if (next[key as keyof TThemeRememberedStyle] === undefined) {
        delete next[key as keyof TThemeRememberedStyle];
      }
    });

    if (shallowRememberedStyleEqual(current, next)) {
      return cloneRememberedStyle(current);
    }

    if (Object.keys(next).length === 0) {
      this.#rememberedStyles.delete(scope);
      this.#emitRememberedStyleChange(scope, null);
      return {};
    }

    this.#rememberedStyles.set(scope, next);
    const clonedNext = cloneRememberedStyle(next);
    this.#emitRememberedStyleChange(scope, clonedNext);
    return clonedNext;
  }

  clearRememberedStyle(scope?: TThemeStyleScopeId) {
    if (scope) {
      if (!this.#rememberedStyles.has(scope)) {
        return false;
      }

      this.#rememberedStyles.delete(scope);
      this.#emitRememberedStyleChange(scope, null);
      return true;
    }

    if (this.#rememberedStyles.size === 0) {
      return false;
    }

    this.#rememberedStyles.clear();
    this.#emitRememberedStyleChange(null, null);
    return true;
  }

  hasTheme(themeId: ThemeId) {
    return this.#themes.has(themeId);
  }

  setTheme(themeId: ThemeId) {
    const nextThemeId = this.#resolveThemeId(themeId);
    if (nextThemeId === this.#themeId) {
      return this.getTheme();
    }

    this.#themeId = nextThemeId;
    const theme = this.getTheme();
    this.#emitThemeChange(theme, this.#themeId);
    return theme;
  }

  addTheme(theme: TThemeDefinition) {
    const nextTheme = cloneThemeDefinition(theme);
    this.#themes.set(nextTheme.id, nextTheme);
    this.#emitThemeRegistryChange();

    if (nextTheme.id === this.#themeId) {
      this.#emitThemeChange(nextTheme, this.#themeId);
    }

    return nextTheme;
  }

  addThemes(themes: readonly TThemeDefinition[]) {
    themes.forEach((theme) => {
      const nextTheme = cloneThemeDefinition(theme);
      this.#themes.set(nextTheme.id, nextTheme);
    });
    this.#emitThemeRegistryChange();

    const activeTheme = this.#themes.get(this.#themeId);
    if (activeTheme) {
      this.#emitThemeChange(activeTheme, this.#themeId);
    }

    return this.getThemes();
  }

  #emitThemeChange(theme: TThemeDefinition, themeId: ThemeId) {
    [...this.#themeChangeListeners].forEach((listener) => {
      listener(theme, themeId);
    });
  }

  #emitThemeRegistryChange() {
    const themes = this.getThemes();
    [...this.#themeRegistryChangeListeners].forEach((listener) => {
      listener(themes);
    });
  }

  #emitRememberedStyleChange(
    scope: TThemeStyleScopeId | null,
    style: Partial<TThemeRememberedStyle> | null,
  ) {
    [...this.#rememberedStyleChangeListeners].forEach((listener) => {
      listener(scope, style === null ? null : cloneRememberedStyle(style));
    });
  }

  #resolveThemeId(themeId: ThemeId | undefined) {
    if (themeId && this.#themes.has(themeId)) {
      return themeId;
    }

    if (this.#themes.has(DEFAULT_THEME_ID)) {
      return DEFAULT_THEME_ID;
    }

    return this.#getFallbackTheme().id;
  }

  #getFallbackTheme() {
    const firstTheme = this.#themes.values().next().value;
    if (!firstTheme) {
      throw new Error("ThemeService requires at least one theme");
    }

    return firstTheme;
  }
}
