import { describe, expect, it } from "bun:test";
import { ThemeService } from "./ThemeService";
import {
  BUILTIN_THEMES,
  THEME_ID_DARK,
  THEME_ID_LIGHT,
  THEME_ID_SEPIA,
} from "./builtins";
import { fxGetThemeCssVariables } from "./dom";
import type { IThemeService } from "./interface";
import { getThemeColorValueMap, isThemeColorToken } from "./styles";

describe("ThemeService", () => {
  it("keeps the Cangine-owned canvas surface out of DOM theme variables", () => {
    expect(Object.keys(fxGetThemeCssVariables(BUILTIN_THEMES[0]!)))
      .not.toContain(["--vc", "canvas", "background"].join("-"));
  });

  it("supports @base full-range color tokens", () => {
    const theme = new ThemeService();

    expect(isThemeColorToken("@base/100")).toBe(true);
    expect(isThemeColorToken("@base/600")).toBe(true);
    expect(isThemeColorToken("@red/800")).toBe(true);
    expect(isThemeColorToken("@gray/300")).toBe(false);
    expect(theme.resolveThemeColor("@base/600")).toBe(getThemeColorValueMap(theme.getTheme())["@base/600"]);
    expect(theme.resolveThemeColor("@transparent")).toBe("transparent");
  });

  it("builds a base palette with nine swatches per group", () => {
    const theme = new ThemeService();
    const palette = theme.getThemeColorPickerPalette();
    const baseGroup = palette.groups.find((group) => group.id === "base");

    expect(baseGroup).toBeTruthy();
    expect(baseGroup?.swatches).toHaveLength(9);
    expect(baseGroup?.swatches[0]?.label).toBe("base/100");
    expect(baseGroup?.swatches[5]?.label).toBe("base/600");
  });

  it("resolves tokenized style defaults into runtime values", () => {
    const theme = new ThemeService();
    const resolved = theme.resolveStyle("pen", {
      strokeColor: "@red/600",
      strokeStyle: "dashed",
    });

    expect(resolved.merged.strokeWidth).toBe("@stroke-width/thick");
    expect(resolved.runtime.strokeColor).toBe(theme.resolveThemeColor("@red/600"));
    expect(resolved.runtime.strokeWidth).toBe(7);
    expect(resolved.runtime.strokeDash).toEqual([28, 14]);
  });

  it("stores remembered styles per scope without touching other scopes", () => {
    const theme = new ThemeService();
    const changes: Array<[string | null, Record<string, unknown> | null]> = [];

    theme.subscribeRememberedStyleChange((scope, style) => {
      changes.push([scope, style ? { ...style } : null]);
    });

    theme.setRememberedStyle("pen", { strokeColor: "@blue/700" });
    theme.setRememberedStyle("pen", { opacity: 0.5 });
    theme.setRememberedStyle("text", { fontSize: "@text/l" });

    expect(theme.getRememberedStyle("pen")).toEqual({
      strokeColor: "@blue/700",
      opacity: 0.5,
    });
    expect(theme.getRememberedStyle("text")).toEqual({ fontSize: "@text/l" });

    theme.clearRememberedStyle("pen");

    expect(theme.getRememberedStyle("pen")).toEqual({});
    expect(theme.getRememberedStyle("text")).toEqual({ fontSize: "@text/l" });
    expect(changes).toEqual([
      ["pen", { strokeColor: "@blue/700" }],
      ["pen", { strokeColor: "@blue/700", opacity: 0.5 }],
      ["text", { fontSize: "@text/l" }],
      ["pen", null],
    ]);
  });

  it("keeps registry, selection, subscriptions, and remembered styles instance-local", () => {
    const first: IThemeService = new ThemeService({ initialThemeId: THEME_ID_LIGHT });
    const second: IThemeService = new ThemeService({ initialThemeId: THEME_ID_SEPIA });
    const firstChanges: string[] = [];
    const secondChanges: string[] = [];
    const firstRegistryChanges: string[][] = [];
    const releaseFirst = first.subscribeThemeChange((theme) => {
      firstChanges.push(theme.id);
    });
    first.subscribeThemeRegistryChange((themes) => {
      firstRegistryChanges.push(themes.map((theme) => theme.id));
    });
    second.subscribeThemeChange((theme) => {
      secondChanges.push(theme.id);
    });

    first.getThemes().find((theme) => theme.id === THEME_ID_LIGHT)!.label = "First light";
    expect(second.getThemes().find((theme) => theme.id === THEME_ID_LIGHT)?.label).toBe("Light");

    const customTheme = structuredClone(BUILTIN_THEMES[0]!);
    customTheme.id = "first-only";
    customTheme.label = "First only";
    first.addTheme(customTheme);
    customTheme.label = "Mutated after registration";
    first.setTheme(customTheme.id);
    first.setRememberedStyle("pen", { strokeColor: "@blue/700" });

    expect(first.getTheme()).toMatchObject({ id: "first-only", label: "First only" });
    expect(first.hasTheme("first-only")).toBe(true);
    expect(second.hasTheme("first-only")).toBe(false);
    expect(second.getThemeId()).toBe(THEME_ID_SEPIA);
    expect(second.getRememberedStyle("pen")).toEqual({});
    expect(firstChanges).toEqual(["first-only"]);
    expect(secondChanges).toEqual([]);
    expect(firstRegistryChanges).toEqual([
      expect.arrayContaining(["first-only"]),
    ]);

    releaseFirst();
    first.setTheme(THEME_ID_DARK);
    expect(firstChanges).toEqual(["first-only"]);
  });
});
