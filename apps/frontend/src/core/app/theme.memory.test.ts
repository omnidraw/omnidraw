import { describe, expect, test } from "vitest";
import { ThemeService, THEME_ID_DARK, THEME_ID_GRAPHITE, THEME_ID_LIGHT, THEME_ID_SEPIA } from "@omnidraw/theme";
import { fnGetRememberedThemeId, fnSyncThemeMemory } from "./theme.memory";

describe("theme memory", () => {
  test("restores sepia after toggling dark then light", () => {
    const themeService = new ThemeService({ initialThemeId: THEME_ID_SEPIA });
    let memory = {
      theme: THEME_ID_SEPIA,
      lastLightThemeId: THEME_ID_SEPIA,
      lastDarkThemeId: THEME_ID_DARK,
    };

    memory = fnSyncThemeMemory({ memory, themeService, nextThemeId: THEME_ID_DARK });
    expect(memory.theme).toBe(THEME_ID_DARK);
    expect(memory.lastLightThemeId).toBe(THEME_ID_SEPIA);

    const rememberedLightThemeId = fnGetRememberedThemeId({
      appearance: "light",
      memory,
      themeService,
    });

    expect(rememberedLightThemeId).toBe(THEME_ID_SEPIA);
  });

  test("restores graphite after toggling light then dark", () => {
    const themeService = new ThemeService({ initialThemeId: THEME_ID_GRAPHITE });
    let memory = {
      theme: THEME_ID_GRAPHITE,
      lastLightThemeId: THEME_ID_LIGHT,
      lastDarkThemeId: THEME_ID_GRAPHITE,
    };

    memory = fnSyncThemeMemory({ memory, themeService, nextThemeId: THEME_ID_LIGHT });
    expect(memory.theme).toBe(THEME_ID_LIGHT);
    expect(memory.lastDarkThemeId).toBe(THEME_ID_GRAPHITE);

    const rememberedDarkThemeId = fnGetRememberedThemeId({
      appearance: "dark",
      memory,
      themeService,
    });

    expect(rememberedDarkThemeId).toBe(THEME_ID_GRAPHITE);
  });

  test("falls back to default appearance theme when remembered id is invalid", () => {
    const themeService = new ThemeService();

    expect(fnGetRememberedThemeId({
      appearance: "light",
      memory: {
        theme: THEME_ID_DARK,
        lastLightThemeId: "missing-light",
        lastDarkThemeId: THEME_ID_DARK,
      },
      themeService,
    })).toBe(THEME_ID_LIGHT);

    expect(fnGetRememberedThemeId({
      appearance: "dark",
      memory: {
        theme: THEME_ID_LIGHT,
        lastLightThemeId: THEME_ID_LIGHT,
        lastDarkThemeId: "missing-dark",
      },
      themeService,
    })).toBe(THEME_ID_DARK);
  });
});
