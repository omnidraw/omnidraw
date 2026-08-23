import { describe, expect, test } from "bun:test";
import {
  BUILTIN_THEMES,
  CANVAS_COLOR_CODES,
  THEME_ID_DARK,
  THEME_ID_LIGHT,
  THEME_ID_SEPIA,
  ThemeService,
  fnGetThemeCssVariables,
  type IThemeService,
} from "./index";

describe("ThemeService", () => {
  test("preserves the built-in visual values", () => {
    expect(BUILTIN_THEMES.map((theme) => theme.id)).toEqual([
      "light", "dark", "sepia", "graphite",
    ]);
    expect(BUILTIN_THEMES[0]?.ui).toMatchObject({
      background: "#fafaf9",
      foreground: "#1c1917",
      primary: "#f59e0b",
    });
    expect(BUILTIN_THEMES[1]?.canvas.chrome).toMatchObject({
      selectionStroke: "#60a5fa",
      text: "#fafaf9",
    });
    expect(BUILTIN_THEMES[2]?.terminal.background).toBe("#241d17");
    expect(BUILTIN_THEMES[3]?.canvas.colors.blue.ink).toMatchObject({
      space: "srgb",
      r: 147 / 255,
      g: 197 / 255,
      b: 253 / 255,
      a: 1,
    });
  });

  test("exposes exactly six fill and five ink product choices", () => {
    const palette = new ThemeService().getThemeColorPickerPalette();
    expect(palette.fillQuick.map((swatch) => swatch.code))
      .toEqual([...CANVAS_COLOR_CODES]);
    expect(palette.strokeQuick.map((swatch) => swatch.code)).toEqual([
      "neutral", "red", "yellow", "green", "blue",
    ]);
  });

  test("resolves role-specific values by isolated theme selection", () => {
    const theme = new ThemeService({ initialThemeId: THEME_ID_LIGHT });
    const lightFill = theme.resolveCanvasColor("green", "fill");
    const lightInk = theme.resolveCanvasColor("green", "ink");
    theme.setTheme(THEME_ID_DARK);
    expect(theme.resolveCanvasColor("green", "fill")).not.toEqual(lightFill);
    expect(lightInk).not.toEqual(lightFill);
    expect(() => theme.resolveCanvasColor("transparent", "ink")).toThrow();
  });

  test("registers complete custom themes and explicit inheritance", () => {
    const theme = new ThemeService();
    theme.addTheme({
      id: "sepia-child",
      label: "Sepia child",
      extends: THEME_ID_SEPIA,
      ui: { primary: "#654321" },
    });
    const child = theme.getThemes().find((entry) => entry.id === "sepia-child");
    expect(child).toMatchObject({
      ui: { primary: "#654321", card: BUILTIN_THEMES[2]?.ui.card },
      canvas: { colors: BUILTIN_THEMES[2]?.canvas.colors },
    });
    expect(() => theme.addTheme({
      id: "orphan",
      label: "Orphan",
      extends: "missing",
    })).toThrow("extends unknown theme");
  });

  test("commits multi-registration changes atomically", () => {
    const theme = new ThemeService();
    const before = theme.getSnapshot();
    expect(() => theme.addThemes([
      { id: "valid-child", label: "Valid", extends: THEME_ID_LIGHT },
      { id: "invalid-child", label: "Invalid", extends: "missing" },
    ])).toThrow("extends unknown theme");
    expect(theme.hasTheme("valid-child")).toBe(false);
    expect(theme.getSnapshot().revision).toBe(before.revision);
  });

  test("keeps selection, registry, subscriptions, and memory instance-local", () => {
    const first: IThemeService = new ThemeService({
      initialThemeId: THEME_ID_LIGHT,
    });
    const second: IThemeService = new ThemeService({
      initialThemeId: THEME_ID_SEPIA,
    });
    const changes: string[] = [];
    const release = first.subscribeThemeChange((theme) => changes.push(theme.id));
    first.addTheme({
      id: "first-only",
      label: "First only",
      extends: THEME_ID_LIGHT,
    });
    first.setTheme("first-only");
    first.setRememberedStyle("pen", { strokeColor: "blue", opacity: 0.5 });
    expect(second.hasTheme("first-only")).toBe(false);
    expect(second.getRememberedStyle("pen")).toEqual({});
    expect(first.getRememberedStyle("pen")).toEqual({
      strokeColor: "blue",
      opacity: 0.5,
    });
    expect(changes).toEqual(["first-only"]);
    release();
  });

  test("returns immutable coherent snapshots and namespaced projections", () => {
    const theme = new ThemeService();
    const snapshot = theme.getSnapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.definition.ui)).toBe(true);
    const variables = fnGetThemeCssVariables(snapshot.definition);
    expect(variables["--omnidraw-background"]).toBe("#fafaf9");
    expect(variables["--omnidraw-canvas-selection-stroke"])
      .toBe("#3b82f6");
    expect(variables["--omnidraw-terminal-background"]).toBe("#111214");
    expect(Object.keys(variables).every(
      (name) => name.startsWith("--omnidraw-"),
    )).toBe(true);
  });
});
