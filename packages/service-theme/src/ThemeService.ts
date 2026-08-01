/** @file Runtime authority for atomic theme registration, selection, and resolution. */

import {
  CANVAS_INK_COLOR_CODES,
  fnAssertThemeDefinition,
} from "@omnidraw/theme-contract";
import type {
  ThemeId,
  TCanvasColorCode,
  TCanvasColorRole,
  TThemeDefinition,
  TThemeDefinitionInheritance,
  TThemeRegistration,
  TThemeSnapshot,
} from "@omnidraw/theme-contract";
import {
  BUILTIN_THEMES,
  DEFAULT_THEME_ID,
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
  getThemeColorPickerPalette,
  getThemeColorValueMap,
  getThemeStyle,
  resolveThemeCanvasColor,
  resolveThemeColor,
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
  themes?: readonly TThemeRegistration[];
  initialThemeId?: ThemeId;
}>;

function freezeDeep<T>(value: T): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const entry of Object.values(value)) freezeDeep(entry);
  return Object.freeze(value);
}

function immutableTheme(value: TThemeDefinition): TThemeDefinition {
  const copy = structuredClone(value);
  fnAssertThemeDefinition(copy);
  return freezeDeep(copy) as TThemeDefinition;
}

function inheritanceRegistration(value: TThemeRegistration): value is TThemeDefinitionInheritance {
  return "extends" in value;
}

function inheritTheme(
  registration: TThemeDefinitionInheritance,
  base: TThemeDefinition,
): TThemeDefinition {
  const colorOverrides = registration.canvas?.colors;
  const colors = {
    transparent: {
      ...base.canvas.colors.transparent,
      ...colorOverrides?.transparent,
    },
    ...Object.fromEntries(CANVAS_INK_COLOR_CODES.map((code) => [code, {
      ...base.canvas.colors[code],
      ...colorOverrides?.[code],
    }])),
  } as TThemeDefinition["canvas"]["colors"];
  return {
    id: registration.id,
    label: registration.label,
    appearance: registration.appearance ?? base.appearance,
    ui: { ...base.ui, ...registration.ui },
    canvas: {
      colors,
      viewport: { ...base.canvas.viewport, ...registration.canvas?.viewport },
      chrome: { ...base.canvas.chrome, ...registration.canvas?.chrome },
      selection: { ...base.canvas.selection, ...registration.canvas?.selection },
      path: { ...base.canvas.path, ...registration.canvas?.path },
    },
    terminal: { ...base.terminal, ...registration.terminal },
  };
}

function numericToken(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function shallowEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const leftEntries = Object.entries(left).filter(([, value]) => value !== undefined);
  const rightEntries = Object.entries(right).filter(([, value]) => value !== undefined);
  return leftEntries.length === rightEntries.length
    && leftEntries.every(([key, value]) => right[key] === value);
}

export class ThemeService implements IThemeService {
  readonly name = "theme";
  readonly #themes = new Map<ThemeId, TThemeDefinition>();
  readonly #rememberedStyles = new Map<TThemeStyleScopeId, Partial<TThemeRememberedStyle>>();
  readonly #themeChangeListeners = new Set<TThemeChangeListener>();
  readonly #themeRegistryChangeListeners = new Set<TThemeRegistryChangeListener>();
  readonly #rememberedStyleChangeListeners = new Set<TThemeRememberedStyleChangeListener>();
  #themeId: ThemeId = DEFAULT_THEME_ID;
  #revision = 0;

  constructor(args: TThemeServiceArgs = {}) {
    this.#register(BUILTIN_THEMES);
    if (args.themes) this.#register(args.themes);
    this.#themeId = this.#resolveThemeId(args.initialThemeId);
    this.#revision = 1;
  }

  getThemeId() { return this.#themeId; }
  getTheme() { return this.#themes.get(this.#themeId) ?? this.#fallback(); }
  getThemes() { return Object.freeze([...this.#themes.values()]); }
  getSnapshot(): TThemeSnapshot {
    return Object.freeze({
      revision: this.#revision,
      themeId: this.#themeId,
      definition: this.getTheme(),
    });
  }
  getCanvasThemeStyle(): TCanvasThemeStyle { return getThemeStyle(this.getTheme()); }
  getThemeColorValueMap(): TThemeColorValueMap { return getThemeColorValueMap(this.getTheme()); }
  resolveCanvasColor(code: TCanvasColorCode, role: TCanvasColorRole) {
    return resolveThemeCanvasColor(this.getTheme(), code, role);
  }
  resolveThemeColor(value: string | undefined, fallback?: string, role: TCanvasColorRole = "fill") {
    return resolveThemeColor(this.getTheme(), value, fallback, role);
  }
  getThemeColorPickerPalette(): TThemeColorPickerPalette {
    return getThemeColorPickerPalette(this.getTheme());
  }
  getStrokeWidthOptions(): readonly TThemeStrokeWidthOption[] { return [...THEME_STROKE_WIDTH_OPTIONS]; }
  getStrokeWidthValueMap(): TThemeStrokeWidthValueMap { return { ...THEME_STROKE_WIDTH_VALUE_MAP }; }
  resolveStrokeWidth(value: string | undefined, fallback = 0) {
    return value === undefined ? fallback
      : THEME_STROKE_WIDTH_VALUE_MAP[value as keyof TThemeStrokeWidthValueMap]
        ?? numericToken(value, fallback);
  }
  getCornerRadiusOptions(): readonly TThemeCornerRadiusOption[] { return [...THEME_CORNER_RADIUS_OPTIONS]; }
  getCornerRadiusValueMap(): TThemeCornerRadiusValueMap { return { ...THEME_CORNER_RADIUS_VALUE_MAP }; }
  resolveCornerRadius(value: string | undefined, fallback = 0) {
    return value === undefined ? fallback
      : THEME_CORNER_RADIUS_VALUE_MAP[value as keyof TThemeCornerRadiusValueMap]
        ?? numericToken(value, fallback);
  }
  getFontSizeOptions(): readonly TThemeFontSizeOption[] { return [...THEME_FONT_SIZE_OPTIONS]; }
  getFontSizeValueMap(): TThemeFontSizeValueMap { return { ...THEME_FONT_SIZE_VALUE_MAP }; }
  resolveFontSize(value: string | undefined, fallback = THEME_FONT_SIZE_OPTIONS[0]?.value ?? 16) {
    return value === undefined ? fallback
      : THEME_FONT_SIZE_VALUE_MAP[value as keyof TThemeFontSizeValueMap]
        ?? numericToken(value, fallback);
  }
  getStrokeStyleOptions(): readonly TThemeStrokeStyleOption[] { return [...THEME_STROKE_STYLE_OPTIONS]; }
  getTextAlignOptions(): readonly TThemeTextAlignOption[] { return [...THEME_TEXT_ALIGN_OPTIONS]; }
  getVerticalAlignOptions(): readonly TThemeVerticalAlignOption[] { return [...THEME_VERTICAL_ALIGN_OPTIONS]; }
  resolveStrokeDash(strokeStyle: TThemeStrokeStyle | undefined, strokeWidth?: number | string) {
    const width = typeof strokeWidth === "number" ? strokeWidth : this.resolveStrokeWidth(strokeWidth, 1);
    if (strokeStyle === "dashed") return [width * 4, width * 2];
    if (strokeStyle === "dotted") return [width, width * 1.5];
    return [];
  }
  getDefaultStyles(): TThemeStyleDefaultsMap { return structuredClone(THEME_STYLE_DEFAULTS_BY_SCOPE); }
  getDefaultStyle(scope: TThemeStyleScopeId): TThemeCanvasStyle {
    return structuredClone((THEME_STYLE_DEFAULTS_BY_SCOPE as Record<string, TThemeCanvasStyle>)[scope] ?? {});
  }
  mergeStyleWithDefaults(scope: TThemeStyleScopeId, style?: Partial<TThemeCanvasStyle>): TThemeCanvasStyle {
    return { ...this.getDefaultStyle(scope), ...structuredClone(style ?? {}) };
  }
  resolveStyle(scope: TThemeStyleScopeId, style?: Partial<TThemeCanvasStyle>): TResolvedThemeCanvasStyle {
    const merged = this.mergeStyleWithDefaults(scope, style);
    const strokeWidth = this.resolveStrokeWidth(merged.strokeWidth, 0);
    return {
      merged,
      runtime: {
        backgroundColor: merged.backgroundColor === undefined
          ? undefined : this.resolveCanvasColor(merged.backgroundColor, "fill"),
        strokeColor: merged.strokeColor === undefined
          ? undefined : this.resolveCanvasColor(merged.strokeColor, "ink"),
        strokeWidth,
        opacity: merged.opacity ?? 1,
        cornerRadius: this.resolveCornerRadius(merged.cornerRadius, 0),
        strokeStyle: merged.strokeStyle ?? "solid",
        strokeDash: this.resolveStrokeDash(merged.strokeStyle, strokeWidth),
        fontSize: this.resolveFontSize(merged.fontSize),
        textAlign: merged.textAlign ?? "left",
        verticalAlign: merged.verticalAlign ?? "top",
      },
    };
  }
  getRememberedStyles(): TThemeRememberedStyleMap {
    return Object.fromEntries([...this.#rememberedStyles].map(([scope, style]) => [scope, structuredClone(style)]));
  }
  getRememberedStyle(scope: TThemeStyleScopeId): Partial<TThemeRememberedStyle> {
    return structuredClone(this.#rememberedStyles.get(scope) ?? {});
  }
  setRememberedStyle(scope: TThemeStyleScopeId, patch: Partial<TThemeRememberedStyle>) {
    const current = this.#rememberedStyles.get(scope) ?? {};
    const next = { ...current, ...structuredClone(patch) };
    for (const key of Object.keys(next)) {
      if (next[key as keyof TThemeRememberedStyle] === undefined) delete next[key as keyof TThemeRememberedStyle];
    }
    if (shallowEqual(current, next)) return structuredClone(current);
    if (Object.keys(next).length === 0) this.#rememberedStyles.delete(scope);
    else this.#rememberedStyles.set(scope, next);
    this.#emitRemembered(scope, Object.keys(next).length === 0 ? null : next);
    return structuredClone(next);
  }
  clearRememberedStyle(scope?: TThemeStyleScopeId) {
    if (scope !== undefined) {
      if (!this.#rememberedStyles.delete(scope)) return false;
      this.#emitRemembered(scope, null);
      return true;
    }
    if (this.#rememberedStyles.size === 0) return false;
    this.#rememberedStyles.clear();
    this.#emitRemembered(null, null);
    return true;
  }
  hasTheme(themeId: ThemeId) { return this.#themes.has(themeId); }
  setTheme(themeId: ThemeId) {
    const next = this.#resolveThemeId(themeId);
    if (next === this.#themeId) return this.getTheme();
    this.#themeId = next;
    this.#revision += 1;
    this.#emitTheme();
    return this.getTheme();
  }
  addTheme(theme: TThemeRegistration) {
    const registered = this.#resolveRegistration(theme);
    this.#themes.set(registered.id, registered);
    this.#revision += 1;
    this.#emitRegistry();
    if (registered.id === this.#themeId) this.#emitTheme();
    return registered;
  }
  addThemes(themes: readonly TThemeRegistration[]) {
    this.#register(themes);
    this.#revision += 1;
    this.#emitRegistry();
    if (themes.some((theme) => theme.id === this.#themeId)) this.#emitTheme();
    return this.getThemes();
  }
  subscribeThemeChange(listener: TThemeChangeListener) {
    this.#themeChangeListeners.add(listener);
    return () => { this.#themeChangeListeners.delete(listener); };
  }
  subscribeThemeRegistryChange(listener: TThemeRegistryChangeListener) {
    this.#themeRegistryChangeListeners.add(listener);
    return () => { this.#themeRegistryChangeListeners.delete(listener); };
  }
  subscribeRememberedStyleChange(listener: TThemeRememberedStyleChangeListener) {
    this.#rememberedStyleChangeListeners.add(listener);
    return () => { this.#rememberedStyleChangeListeners.delete(listener); };
  }
  #resolveRegistration(registration: TThemeRegistration): TThemeDefinition {
    if (!inheritanceRegistration(registration)) return immutableTheme(registration);
    const base = this.#themes.get(registration.extends);
    if (base === undefined) {
      throw new RangeError(`Theme '${registration.id}' extends unknown theme '${registration.extends}'.`);
    }
    return immutableTheme(inheritTheme(registration, base));
  }
  #register(registrations: readonly TThemeRegistration[]) {
    for (const registration of registrations) {
      const theme = this.#resolveRegistration(registration);
      this.#themes.set(theme.id, theme);
    }
  }
  #emitTheme() {
    const snapshot = this.getSnapshot();
    for (const listener of [...this.#themeChangeListeners]) {
      listener(snapshot.definition, snapshot.themeId, snapshot);
    }
  }
  #emitRegistry() {
    const themes = this.getThemes();
    for (const listener of [...this.#themeRegistryChangeListeners]) listener(themes);
  }
  #emitRemembered(scope: TThemeStyleScopeId | null, style: Partial<TThemeRememberedStyle> | null) {
    for (const listener of [...this.#rememberedStyleChangeListeners]) {
      listener(scope, style === null ? null : structuredClone(style));
    }
  }
  #resolveThemeId(themeId: ThemeId | undefined) {
    if (themeId !== undefined) {
      if (this.#themes.has(themeId)) return themeId;
      throw new RangeError(`Unknown theme '${themeId}'.`);
    }
    if (this.#themes.has(DEFAULT_THEME_ID)) return DEFAULT_THEME_ID;
    return this.#fallback().id;
  }
  #fallback() {
    const first = this.#themes.values().next().value;
    if (first === undefined) throw new Error("ThemeService requires at least one theme");
    return first;
  }
}
