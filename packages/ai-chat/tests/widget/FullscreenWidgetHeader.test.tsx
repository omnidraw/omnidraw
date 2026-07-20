import { ThemeService, THEME_ID_DARK, THEME_ID_LIGHT } from "@vibecanvas/service-theme";
import { render } from "solid-js/web";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  FullscreenWidgetHeader,
  type TFullscreenWidgetHeaderProps,
} from "../../src/widget/FullscreenWidgetHeader";
import { WIDGET_HOST_HEADER_HEIGHT } from "../../src/widget/CONSTANTS";
import { fnGetHostThemeColors } from "../../src/widget/fn.get-host-theme-colors";
import { ensureDom } from "../test-setup";

const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  document.body.replaceChildren();
});

function mountHeader(overrides: Partial<TFullscreenWidgetHeaderProps> = {}) {
  ensureDom();
  const root = document.createElement("div");
  document.body.appendChild(root);
  const callbacks = {
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onExitFullscreen: vi.fn(),
    onOpenMenu: vi.fn(),
    onTitleAction: vi.fn(),
  };
  const colors = fnGetHostThemeColors(new ThemeService({ initialThemeId: THEME_ID_LIGHT }), "ui-widget");
  const dispose = render(() => (
    <FullscreenWidgetHeader
      widgetId="widget-1"
      visible
      width={640}
      label="A very long hosted widget label"
      colors={colors}
      titleActions={[
        { id: "settings", label: "Back to chat", pressed: true },
        { id: "locked", label: "Locked", disabled: true },
      ]}
      {...callbacks}
      {...overrides}
    />
  ), root);
  cleanups.push(dispose);
  return { root, callbacks, colors };
}

function normalizedColor(color: string) {
  const element = document.createElement("div");
  element.style.color = color;
  return element.style.color;
}

describe("FullscreenWidgetHeader", () => {
  test("renders accessible host chrome and dispatches every enabled action", () => {
    const { root, callbacks, colors } = mountHeader();
    const header = root.querySelector<HTMLElement>("[data-widget-fullscreen-header-id='widget-1']");
    const title = root.querySelector<HTMLElement>("[data-widget-fullscreen-title]");
    const close = root.querySelector<HTMLButtonElement>("[data-widget-fullscreen-control='close']");
    const minimize = root.querySelector<HTMLButtonElement>("[data-widget-fullscreen-control='minimize']");
    const exitFullscreen = root.querySelector<HTMLButtonElement>("[data-widget-fullscreen-control='exit-fullscreen']");
    const settings = root.querySelector<HTMLButtonElement>("[data-widget-title-action-id='settings']");
    const locked = root.querySelector<HTMLButtonElement>("[data-widget-title-action-id='locked']");
    const menu = root.querySelector<HTMLButtonElement>("[data-widget-fullscreen-menu-button='widget-1']");

    expect(header?.getAttribute("role")).toBe("toolbar");
    expect(header?.getAttribute("aria-label")).toContain("A very long hosted widget label");
    expect(header?.style.height).toBe(`${WIDGET_HOST_HEADER_HEIGHT}px`);
    expect(header?.style.backgroundColor).toBe(normalizedColor(colors.headerFill));
    expect(title?.textContent).toBe("A very long hosted widget label");
    expect(title?.style.textOverflow).toBe("ellipsis");
    expect(close?.getAttribute("aria-label")).toBe("Close widget");
    expect(minimize?.title).toBe("Minimize widget");
    expect(exitFullscreen?.getAttribute("aria-label")).toBe("Exit fullscreen");
    expect(settings?.getAttribute("aria-pressed")).toBe("true");
    expect(settings?.dataset.pressed).toBe("true");
    expect(locked?.disabled).toBe(true);
    expect(menu?.getAttribute("aria-haspopup")).toBe("menu");

    close?.click();
    minimize?.click();
    exitFullscreen?.click();
    settings?.click();
    locked?.click();
    menu?.click();

    expect(callbacks.onClose).toHaveBeenCalledOnce();
    expect(callbacks.onMinimize).toHaveBeenCalledOnce();
    expect(callbacks.onExitFullscreen).toHaveBeenCalledOnce();
    expect(callbacks.onTitleAction).toHaveBeenCalledWith("settings");
    expect(callbacks.onTitleAction).not.toHaveBeenCalledWith("locked");
    expect(callbacks.onOpenMenu).toHaveBeenCalledWith(menu);
  });

  test("uses the shared light/dark widget and ui-widget palettes", () => {
    for (const themeId of [THEME_ID_LIGHT, THEME_ID_DARK]) {
      for (const widgetType of ["widget", "ui-widget"] as const) {
        const colors = fnGetHostThemeColors(new ThemeService({ initialThemeId: themeId }), widgetType);
        const { root } = mountHeader({ colors, widgetId: `${themeId}-${widgetType}` });
        const header = root.querySelector<HTMLElement>(`[data-widget-fullscreen-header-id='${themeId}-${widgetType}']`);
        const close = root.querySelector<HTMLButtonElement>("[data-widget-fullscreen-control='close']");
        const minimize = root.querySelector<HTMLButtonElement>("[data-widget-fullscreen-control='minimize']");
        const exitFullscreen = root.querySelector<HTMLButtonElement>("[data-widget-fullscreen-control='exit-fullscreen']");

        expect(header?.style.backgroundColor).toBe(normalizedColor(colors.headerFill));
        expect(header?.style.color).toBe(normalizedColor(colors.headerTitleFill));
        expect(close?.style.backgroundColor).toBe(normalizedColor(colors.closeButtonFill));
        expect(minimize?.style.backgroundColor).toBe(normalizedColor(colors.minimizeButtonFill));
        expect(exitFullscreen?.style.backgroundColor).toBe(normalizedColor(colors.maximizeButtonFill));
      }
    }
  });
});
