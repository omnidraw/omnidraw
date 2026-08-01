import { ThemeService, type ThemeId, txApplyThemeToElement } from "@omnidraw/service-theme";
import { setStore, store } from "@/store";
import { fxGetRememberedThemeId, fxSyncThemeMemory, type TThemeAppearance, type TThemeMemory } from "./theme.memory";

export const themeService = new ThemeService();
if (themeService.hasTheme(store.theme)) themeService.setTheme(store.theme);

function fxGetThemeMemory(): TThemeMemory {
  return {
    theme: store.theme,
    lastLightThemeId: store.lastLightThemeId,
    lastDarkThemeId: store.lastDarkThemeId,
  };
}

function txSyncThemeDom() {
  if (typeof document === "undefined") {
    return;
  }

  txApplyThemeToElement(document.documentElement, themeService.getTheme());
}

export function txSetTheme(themeId: ThemeId) {
  return themeService.setTheme(themeId);
}

export function txSetThemeAppearance(appearance: TThemeAppearance) {
  const rememberedThemeId = fxGetRememberedThemeId({
    appearance,
    memory: fxGetThemeMemory(),
    themeService,
  });

  return txSetTheme(rememberedThemeId);
}

const initialThemeMemory = fxSyncThemeMemory({
  memory: fxGetThemeMemory(),
  themeService,
  nextThemeId: themeService.getThemeId(),
});

if (store.theme !== initialThemeMemory.theme) {
  setStore("theme", initialThemeMemory.theme);
}
if (store.lastLightThemeId !== initialThemeMemory.lastLightThemeId) {
  setStore("lastLightThemeId", initialThemeMemory.lastLightThemeId);
}
if (store.lastDarkThemeId !== initialThemeMemory.lastDarkThemeId) {
  setStore("lastDarkThemeId", initialThemeMemory.lastDarkThemeId);
}

txSyncThemeDom();

themeService.subscribeThemeChange((theme) => {
  txSyncThemeDom();

  const nextThemeMemory = fxSyncThemeMemory({
    memory: fxGetThemeMemory(),
    themeService,
    nextThemeId: theme.id,
  });

  if (store.theme !== nextThemeMemory.theme) {
    setStore("theme", nextThemeMemory.theme);
  }
  if (store.lastLightThemeId !== nextThemeMemory.lastLightThemeId) {
    setStore("lastLightThemeId", nextThemeMemory.lastLightThemeId);
  }
  if (store.lastDarkThemeId !== nextThemeMemory.lastDarkThemeId) {
    setStore("lastDarkThemeId", nextThemeMemory.lastDarkThemeId);
  }
});
