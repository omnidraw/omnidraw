import {
  OMNIDRAW_THEME_SCOPE_ATTRIBUTE,
  ThemeService,
  applyThemeToElement,
  type ThemeId,
} from "@omnidraw/theme";
import {
  fnGetRememberedThemeId,
  fnSyncThemeMemory,
  type TThemeAppearance,
  type TThemeMemory,
} from "@/core/app/theme.memory";
import type { TFrontendStore } from "../framework/state/store";

export type TFrontendThemeController = Readonly<{
  service: ThemeService;
  setTheme(themeId: ThemeId): void;
  setAppearance(appearance: TThemeAppearance): void;
  dispose(): void;
}>;

export function createFrontendThemeController(args: Readonly<{
  store: TFrontendStore;
  document: Document;
}>): TFrontendThemeController {
  const { state, set } = args.store;
  const service = new ThemeService();
  if (service.hasTheme(state.theme)) service.setTheme(state.theme);

  let currentMemory: TThemeMemory = {
    theme: state.theme,
    lastLightThemeId: state.lastLightThemeId,
    lastDarkThemeId: state.lastDarkThemeId,
  };
  const syncDom = (): void => {
    const host = args.document.documentElement;
    host.setAttribute(OMNIDRAW_THEME_SCOPE_ATTRIBUTE, "application");
    applyThemeToElement(host, service.getTheme());
  };
  const syncMemory = (nextThemeId: ThemeId): void => {
    const previous = currentMemory;
    const next = fnSyncThemeMemory({ memory: previous, themeService: service, nextThemeId });
    currentMemory = next;
    if (previous.theme !== next.theme) set("theme", next.theme);
    if (previous.lastLightThemeId !== next.lastLightThemeId) set("lastLightThemeId", next.lastLightThemeId);
    if (previous.lastDarkThemeId !== next.lastDarkThemeId) set("lastDarkThemeId", next.lastDarkThemeId);
  };

  syncMemory(service.getThemeId());
  syncDom();
  const unsubscribe = service.subscribeThemeChange((theme) => {
    syncDom();
    syncMemory(theme.id);
  });

  return Object.freeze({
    service,
    setTheme(themeId) {
      service.setTheme(themeId);
    },
    setAppearance(appearance) {
      service.setTheme(fnGetRememberedThemeId({
        appearance,
        memory: currentMemory,
        themeService: service,
      }));
    },
    dispose: unsubscribe,
  });
}
