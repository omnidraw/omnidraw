import { THEME_ID_DARK, THEME_ID_LIGHT, type ThemeId, type ThemeService } from "@vibecanvas/service-theme";

export type TThemeAppearance = "light" | "dark";

export type TThemeMemory = {
  theme: ThemeId;
  lastLightThemeId: ThemeId;
  lastDarkThemeId: ThemeId;
};

export function fxGetDefaultThemeIdForAppearance(appearance: TThemeAppearance) {
  return appearance === "dark" ? THEME_ID_DARK : THEME_ID_LIGHT;
}

export function fxGetRememberedThemeId(args: {
  appearance: TThemeAppearance;
  memory: TThemeMemory;
  themeService: ThemeService;
}) {
  const rememberedThemeId = args.appearance === "dark"
    ? args.memory.lastDarkThemeId
    : args.memory.lastLightThemeId;

  if (args.themeService.hasTheme(rememberedThemeId)) {
    const rememberedTheme = args.themeService.getThemes().find((theme) => theme.id === rememberedThemeId);
    if (rememberedTheme?.appearance === args.appearance) {
      return rememberedThemeId;
    }
  }

  return fxGetDefaultThemeIdForAppearance(args.appearance);
}

export function fxSyncThemeMemory(args: {
  memory: TThemeMemory;
  themeService: ThemeService;
  nextThemeId: ThemeId;
}) {
  const nextTheme = args.themeService.getThemes().find((theme) => theme.id === args.nextThemeId);
  if (!nextTheme) {
    return {
      ...args.memory,
      theme: fxGetRememberedThemeId({
        appearance: args.themeService.getTheme().appearance,
        memory: args.memory,
        themeService: args.themeService,
      }),
    } satisfies TThemeMemory;
  }

  return {
    theme: nextTheme.id,
    lastLightThemeId: nextTheme.appearance === "light" ? nextTheme.id : args.memory.lastLightThemeId,
    lastDarkThemeId: nextTheme.appearance === "dark" ? nextTheme.id : args.memory.lastDarkThemeId,
  } satisfies TThemeMemory;
}
