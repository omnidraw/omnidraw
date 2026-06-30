import { describe, expect, it } from "bun:test";
import { ThemeService } from "./ThemeService";
import { getThemeColorValueMap, isThemeColorToken } from "./styles";

describe("ThemeService", () => {
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

    theme.hooks.rememberedStyleChange.tap((scope, style) => {
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
});
