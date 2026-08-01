import { describe, expect, it } from "bun:test";
import {
  CANVAS_COLOR_CODES,
  THEME_UI_COLOR_ROLES,
} from "@omnidraw/theme-contract";
import { ThemeService } from "./ThemeService";
import {
  BUILTIN_THEMES,
  THEME_ID_DARK,
  THEME_ID_LIGHT,
  THEME_ID_SEPIA,
} from "./builtins";
import { fxGetThemeCssVariables } from "./dom";
import type { IThemeService } from "./interface";

describe("ThemeService", () => {
  it("projects detailed UI, interaction, canvas chrome, and terminal variables", () => {
    for (const theme of BUILTIN_THEMES) {
      const variables = fxGetThemeCssVariables(theme);
      for (const role of THEME_UI_COLOR_ROLES) {
        const variable = `--${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
        expect(variables[variable]).toBe(theme.ui[role]);
      }
      expect(variables["--vc-terminal-background"]).toBe(theme.terminal.background);
      expect(variables["--preview-terminal-background"]).toBe(theme.terminal.background);
      expect(variables["--vc-canvas-selection-stroke"])
        .toBe(theme.canvas.chrome.selectionStroke);
      expect(variables).not.toHaveProperty("--vc-canvas-background");
    }
  });

  it("exposes exactly six fill and five ink product choices", () => {
    const palette = new ThemeService().getThemeColorPickerPalette();
    expect(palette.fillQuick.map((swatch) => swatch.code)).toEqual([...CANVAS_COLOR_CODES]);
    expect(palette.strokeQuick.map((swatch) => swatch.code)).toEqual([
      "neutral", "red", "yellow", "green", "blue",
    ]);
    expect(palette.fillQuick.map((swatch) => swatch.label)).not.toContain("Primary");
  });

  it("resolves neutral and green by theme and paint role", () => {
    const theme = new ThemeService({ initialThemeId: THEME_ID_LIGHT });
    const lightFill = theme.resolveCanvasColor("green", "fill");
    const lightInk = theme.resolveCanvasColor("green", "ink");
    const lightNeutral = theme.resolveCanvasColor("neutral", "fill");
    theme.setTheme(THEME_ID_DARK);
    expect(theme.resolveCanvasColor("green", "fill")).not.toEqual(lightFill);
    expect(lightInk).not.toEqual(lightFill);
    expect(theme.resolveCanvasColor("neutral", "fill")).not.toEqual(lightNeutral);
    expect(() => theme.resolveCanvasColor("transparent", "ink")).toThrow();
  });

  it("registers complete custom themes atomically and never borrows Light", () => {
    const theme = new ThemeService();
    const custom = structuredClone(BUILTIN_THEMES[2]);
    const registration = {
      ...custom,
      id: "custom-complete",
      label: "Custom complete",
      ui: { ...custom.ui, primary: "#123456" },
      canvas: {
        ...custom.canvas,
        colors: {
          ...custom.canvas.colors,
          green: {
            fill: { space: "srgb", r: 0.1, g: 0.2, b: 0.3, a: 1 } as const,
            ink: { space: "srgb", r: 0.8, g: 0.9, b: 1, a: 1 } as const,
          },
        },
      },
      terminal: { ...custom.terminal, background: "#010203" },
    };
    theme.addTheme(registration);
    theme.setTheme(registration.id);
    expect(theme.getTheme().ui.primary).toBe("#123456");
    expect(theme.resolveCanvasColor("green", "fill")).toEqual(registration.canvas.colors.green.fill);
    expect(theme.getTheme().terminal.background).toBe("#010203");
    expect(fxGetThemeCssVariables(theme.getTheme())).toMatchObject({
      "--primary": "#123456",
      "--vc-terminal-background": "#010203",
    });
    expect(theme.getThemeColorPickerPalette().fillQuick.find(
      (swatch) => swatch.code === "green",
    )?.value).toEqual(registration.canvas.colors.green.fill);
    expect(() => theme.addTheme({ id: "broken", label: "Broken" } as never)).toThrow(
      "Invalid theme definition",
    );
    expect(() => theme.setTheme("missing-custom")).toThrow(
      "Unknown theme 'missing-custom'",
    );
    expect(() => new ThemeService({ initialThemeId: "missing-custom" })).toThrow(
      "Unknown theme 'missing-custom'",
    );
  });

  it("supports explicit inheritance and rejects an unknown base", () => {
    const theme = new ThemeService();
    theme.addTheme({
      id: "sepia-child",
      label: "Sepia child",
      extends: THEME_ID_SEPIA,
      ui: { primary: "#654321" },
    });
    expect(theme.getThemes().find((entry) => entry.id === "sepia-child")).toMatchObject({
      ui: { primary: "#654321", card: BUILTIN_THEMES[2].ui.card },
      canvas: { colors: BUILTIN_THEMES[2].canvas.colors },
    });
    expect(() => theme.addTheme({
      id: "orphan", label: "Orphan", extends: "missing",
    })).toThrow("extends unknown theme");
  });

  it("returns immutable coherent snapshots with monotonic revisions", () => {
    const theme = new ThemeService();
    const first = theme.getSnapshot();
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.definition.ui)).toBe(true);
    theme.setTheme(THEME_ID_DARK);
    const second = theme.getSnapshot();
    expect(second.revision).toBeGreaterThan(first.revision);
    expect(second.themeId).toBe(THEME_ID_DARK);
    expect(second.definition.id).toBe(second.themeId);
  });

  it("keeps registry, selection, subscriptions, and remembered styles instance-local", () => {
    const first: IThemeService = new ThemeService({ initialThemeId: THEME_ID_LIGHT });
    const second: IThemeService = new ThemeService({ initialThemeId: THEME_ID_SEPIA });
    const changes: string[] = [];
    const release = first.subscribeThemeChange((theme) => changes.push(theme.id));
    first.addTheme({ id: "first-only", label: "First only", extends: THEME_ID_LIGHT });
    first.setTheme("first-only");
    first.setRememberedStyle("pen", { strokeColor: "blue", opacity: 0.5 });
    expect(second.hasTheme("first-only")).toBe(false);
    expect(second.getRememberedStyle("pen")).toEqual({});
    expect(first.getRememberedStyle("pen")).toEqual({ strokeColor: "blue", opacity: 0.5 });
    expect(changes).toEqual(["first-only"]);
    release();
    first.setTheme(THEME_ID_DARK);
    expect(changes).toEqual(["first-only"]);
  });
});
