import type { ThemeId, TThemeDefinition } from "./builtins.js";
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

export type TThemeChangeListener = (
  theme: TThemeDefinition,
  themeId: ThemeId,
) => void;

export type TThemeRegistryChangeListener = (
  themes: readonly TThemeDefinition[],
) => void;

export type TThemeRememberedStyleChangeListener = (
  scope: TThemeStyleScopeId | null,
  style: Partial<TThemeRememberedStyle> | null,
) => void;

/** Stable, host-consumable theme capability. */
export interface IThemeService {
  getThemeId(): ThemeId;
  getTheme(): TThemeDefinition;
  getThemes(): readonly TThemeDefinition[];
  getCanvasThemeStyle(): TCanvasThemeStyle;
  getThemeColorValueMap(): TThemeColorValueMap;
  resolveThemeColor(value: string | undefined, fallback?: string): string | undefined;
  getThemeColorPickerPalette(): TThemeColorPickerPalette;
  getStrokeWidthOptions(): readonly TThemeStrokeWidthOption[];
  getStrokeWidthValueMap(): TThemeStrokeWidthValueMap;
  resolveStrokeWidth(value: string | undefined, fallback?: number): number;
  getCornerRadiusOptions(): readonly TThemeCornerRadiusOption[];
  getCornerRadiusValueMap(): TThemeCornerRadiusValueMap;
  resolveCornerRadius(value: string | undefined, fallback?: number): number;
  getFontSizeOptions(): readonly TThemeFontSizeOption[];
  getFontSizeValueMap(): TThemeFontSizeValueMap;
  resolveFontSize(value: string | undefined, fallback?: number): number;
  getStrokeStyleOptions(): readonly TThemeStrokeStyleOption[];
  getTextAlignOptions(): readonly TThemeTextAlignOption[];
  getVerticalAlignOptions(): readonly TThemeVerticalAlignOption[];
  resolveStrokeDash(
    strokeStyle: TThemeStrokeStyle | undefined,
    strokeWidth?: number | string,
  ): number[];
  getDefaultStyles(): TThemeStyleDefaultsMap;
  getDefaultStyle(scope: TThemeStyleScopeId): TThemeCanvasStyle;
  mergeStyleWithDefaults(
    scope: TThemeStyleScopeId,
    style?: Partial<TThemeCanvasStyle>,
  ): TThemeCanvasStyle;
  resolveStyle(
    scope: TThemeStyleScopeId,
    style?: Partial<TThemeCanvasStyle>,
  ): TResolvedThemeCanvasStyle;
  getRememberedStyles(): TThemeRememberedStyleMap;
  getRememberedStyle(scope: TThemeStyleScopeId): Partial<TThemeRememberedStyle>;
  setRememberedStyle(
    scope: TThemeStyleScopeId,
    patch: Partial<TThemeRememberedStyle>,
  ): Partial<TThemeRememberedStyle>;
  clearRememberedStyle(scope?: TThemeStyleScopeId): boolean;
  hasTheme(themeId: ThemeId): boolean;
  setTheme(themeId: ThemeId): TThemeDefinition;
  addTheme(theme: TThemeDefinition): TThemeDefinition;
  addThemes(themes: readonly TThemeDefinition[]): readonly TThemeDefinition[];
  subscribeThemeChange(listener: TThemeChangeListener): () => void;
  subscribeThemeRegistryChange(listener: TThemeRegistryChangeListener): () => void;
  subscribeRememberedStyleChange(
    listener: TThemeRememberedStyleChangeListener,
  ): () => void;
}
