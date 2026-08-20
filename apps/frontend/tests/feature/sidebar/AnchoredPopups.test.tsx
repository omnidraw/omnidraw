import { render } from "@solidjs/web";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ToolIconPicker } from "../../../src/shell/framework/feature/sidebar/ToolIconPicker/ToolIconPicker";
import SidebarItem from "../../../src/shell/framework/feature/sidebar/components/SidebarItem";

const cleanups: Array<() => void> = [];

function domRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

function mount(view: () => unknown, options: Readonly<{ themeScope?: boolean }> = {}): HTMLDivElement {
  const host = document.createElement("div");
  const scope = options.themeScope ? document.createElement("div") : undefined;
  if (scope !== undefined) {
    scope.setAttribute("data-omnidraw-theme-scope", "test");
    host.style.overflow = "auto";
    scope.append(host);
    document.body.append(scope);
  } else {
    document.body.append(host);
  }
  const dispose = render(view as never, host);
  cleanups.push(() => {
    dispose();
    (scope ?? host).remove();
  });
  return host;
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("owned anchored popups", () => {
  test("ports the icon listbox outside overflow, flips and clamps at the viewport edge, and closes after Tab leaves", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.matches('[data-anchored-popup="tool-icon-picker"]')) {
        return domRect(0, 0, 240, 240);
      }
      if (this.querySelector('[role="combobox"]') !== null) {
        return domRect(900, 730, 240, 30);
      }
      return domRect(0, 0, 0, 0);
    });

    const host = mount(() => <>
      <ToolIconPicker value={null} onChange={() => undefined} />
      <button type="button" data-after-picker>After picker</button>
    </>, { themeScope: true });
    const input = host.querySelector<HTMLInputElement>('[role="combobox"]')!;
    input.focus();
    input.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowDown",
    }));

    const listbox = await vi.waitFor(() => {
      const value = document.body.querySelector<HTMLElement>('[role="listbox"]');
      expect(value).not.toBeNull();
      return value!;
    });
    const popup = listbox.parentElement!;
    expect(host.contains(popup)).toBe(false);
    expect(host.parentElement?.contains(popup)).toBe(true);
    expect(popup.dataset.anchoredSide).toBe("top");
    expect(popup.style.left).toBe("776px");
    expect(popup.style.top).toBe("486px");
    expect(popup.style.width).toBe("240px");
    expect(input.getAttribute("aria-activedescendant")).toBeTruthy();

    input.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Tab",
    }));
    host.querySelector<HTMLButtonElement>("[data-after-picker]")!.focus();
    await vi.waitFor(() => expect(document.body.querySelector('[role="listbox"]')).toBeNull());
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  test("enters the sidebar menu from either trigger arrow, roves real focus, repositions, and cleans up", async () => {
    let triggerTop = 740;
    let resizeCallback: ResizeObserverCallback | undefined;
    const observed: Element[] = [];
    const disconnect = vi.fn();
    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe(element: Element) {
        observed.push(element);
      }
      unobserve() { /* not needed by the owned connection */ }
      disconnect() {
        disconnect();
      }
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.matches('[aria-label="Options for Canvas A"]')) {
        return domRect(995, triggerTop, 20, 20);
      }
      if (this.matches('[data-anchored-popup="sidebar-item-menu"]')) {
        return domRect(0, 0, 140, 80);
      }
      return domRect(0, 0, 0, 0);
    });

    const host = mount(() => <>
      <SidebarItem name="Canvas A" />
      <button type="button" data-after-menu>After menu</button>
    </>);
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Options for Canvas A"]')!;
    let escapePathIncludedMenu = false;
    const observeEscapePath = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      escapePathIncludedMenu = event.composedPath().some((target) => (
        target instanceof HTMLElement && target.getAttribute("role") === "menu"
      ));
    };
    document.addEventListener("keydown", observeEscapePath, true);
    cleanups.push(() => document.removeEventListener("keydown", observeEscapePath, true));
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowUp",
    }));

    const menu = await vi.waitFor(() => {
      const value = document.body.querySelector<HTMLElement>('[role="menu"]');
      expect(value).not.toBeNull();
      return value!;
    });
    await vi.waitFor(() => expect(document.activeElement?.textContent).toContain("Delete"));
    expect(host.contains(menu)).toBe(false);
    expect(menu.dataset.anchoredSide).toBe("top");
    expect(menu.style.left).toBe("875px");
    expect(menu.style.top).toBe("656px");
    expect(observed).toEqual([trigger, menu]);

    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Home",
    }));
    expect(document.activeElement?.textContent).toContain("Rename");
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "End",
    }));
    expect(document.activeElement?.textContent).toContain("Delete");

    triggerTop = 100;
    resizeCallback?.([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
    expect(menu.dataset.anchoredSide).toBe("bottom");
    expect(menu.style.top).toBe("124px");

    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    }));
    await vi.waitFor(() => expect(document.body.querySelector('[role="menu"]')).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(escapePathIncludedMenu).toBe(true);
    expect(disconnect).toHaveBeenCalledOnce();

    trigger.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowDown",
    }));
    await vi.waitFor(() => expect(document.activeElement?.textContent).toContain("Rename"));
    const reopenedMenu = document.body.querySelector<HTMLElement>('[role="menu"]')!;
    triggerTop = 200;
    window.dispatchEvent(new Event("resize"));
    expect(reopenedMenu.style.top).toBe("224px");
    triggerTop = 300;
    document.dispatchEvent(new Event("scroll"));
    expect(reopenedMenu.style.top).toBe("324px");
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Tab",
    }));
    host.querySelector<HTMLButtonElement>("[data-after-menu]")!.focus();
    await vi.waitFor(() => expect(document.body.querySelector('[role="menu"]')).toBeNull());
    expect(document.activeElement).toBe(host.querySelector("[data-after-menu]"));
    expect(disconnect).toHaveBeenCalledTimes(2);
  });
});
