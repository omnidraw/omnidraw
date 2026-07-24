import { ThemeService } from "@vibecanvas/service-theme";
import { describe, expect, test } from "vitest";
import { fxReadCanvasProjectionTheme } from "../../src/engine/projection/fx.theme";
import { fnResolveCanvasElementStyle } from "../../src/engine/projection/fn.style";
import { createElement } from "../services/crdt/helpers";

describe("projection theme edge", () => {
  test("reads all renderer-independent values from ThemeService", () => {
    const themeService = new ThemeService({ initialThemeId: "dark" });
    const theme = fxReadCanvasProjectionTheme(themeService, {});

    expect(theme.id).toBe("dark");
    expect(theme.colors).toEqual(themeService.getTheme().colors);
    expect(theme.colorTokens["@base/900"])
      .toBe(themeService.resolveThemeColor("@base/900"));
    expect(theme.strokeWidths?.["@stroke-width/thick"]).toBe(7);
    expect(theme.cornerRadii?.["@corner-radius/md"]).toBe(16);
    expect(theme.fontSizes?.["@text/xl"]).toBe(36);
    expect(theme.styleDefaults?.rect?.backgroundColor).toBe("@base/300");
  });

  test("projects tokenized defaults through the selected theme", () => {
    const themeService = new ThemeService({ initialThemeId: "sepia" });
    const theme = fxReadCanvasProjectionTheme(themeService, {});
    const style = fnResolveCanvasElementStyle({
      element: createElement("rect"),
      theme,
    });

    expect(style.opacity).toBe(1);
    expect(style.fill?.type).toBe("solid");
    if (style.fill?.type === "solid") {
      expect(style.fill.color.a).toBe(1);
    }
  });
});
