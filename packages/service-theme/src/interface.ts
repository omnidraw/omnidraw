/** @file Stable host-consumable ThemeService capability. */

import type {
  ThemeId,
  TCanvasColorCode,
  TCanvasColorRole,
  TThemeDefinition,
  TThemeRegistration,
  TThemeSnapshot,
  TThemeSrgbColor,
} from "@omnidraw/theme-contract";
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
  snapshot: TThemeSnapshot,
) => void;
export type TThemeRegistryChangeListener = (
  themes: readonly TThemeDefinition[],
) => void;
export type TThemeRememberedStyleChangeListener = (
  scope: TThemeStyleScopeId | null,
  style: Partial<TThemeRememberedStyle> | null,
) => void;

export interface IThemeService {
  getThemeId(): ThemeId;
  getTheme(): TThemeDefinition;
  getSnapshot(): TThemeSnapshot;
  getThemes(): readonly TThemeDefinition[];
  getCanvasThemeStyle(): TCanvasThemeStyle;
  getThemeColorValueMap(): TThemeColorValueMap;
  resolveCanvasColor(code: TCanvasColorCode, role: TCanvasColorRole): TThemeSrgbColor;
  resolveThemeColor(
    value: string | undefined,
    fallback?: string,
    role?: TCanvasColorRole,
  ): string | undefined;
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
  resolveStrokeDash(strokeStyle: TThemeStrokeStyle | undefined, strokeWidth?: number | string): number[];
  getDefaultStyles(): TThemeStyleDefaultsMap;
  getDefaultStyle(scope: TThemeStyleScopeId): TThemeCanvasStyle;
  mergeStyleWithDefaults(scope: TThemeStyleScopeId, style?: Partial<TThemeCanvasStyle>): TThemeCanvasStyle;
  resolveStyle(scope: TThemeStyleScopeId, style?: Partial<TThemeCanvasStyle>): TResolvedThemeCanvasStyle;
  getRememberedStyles(): TThemeRememberedStyleMap;
  getRememberedStyle(scope: TThemeStyleScopeId): Partial<TThemeRememberedStyle>;
  setRememberedStyle(scope: TThemeStyleScopeId, patch: Partial<TThemeRememberedStyle>): Partial<TThemeRememberedStyle>;
  clearRememberedStyle(scope?: TThemeStyleScopeId): boolean;
  hasTheme(themeId: ThemeId): boolean;
  setTheme(themeId: ThemeId): TThemeDefinition;
  addTheme(theme: TThemeRegistration): TThemeDefinition;
  addThemes(themes: readonly TThemeRegistration[]): readonly TThemeDefinition[];
  subscribeThemeChange(listener: TThemeChangeListener): () => void;
  subscribeThemeRegistryChange(listener: TThemeRegistryChangeListener): () => void;
  subscribeRememberedStyleChange(listener: TThemeRememberedStyleChangeListener): () => void;
}
