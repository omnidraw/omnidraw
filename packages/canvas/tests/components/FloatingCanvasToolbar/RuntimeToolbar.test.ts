import { createComponent } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeToolbar } from "../../../src/components/FloatingCanvasToolbar/RuntimeToolbar";
import { TOOL_GROUPS_CHANGED_EVENT } from "../../../src/components/FloatingCanvasToolbar/CONSTANTS";
import type { TTool } from "../../../src/services/tool/types";

type TListener<TArgs extends unknown[]> = (...args: TArgs) => unknown;

function hook<TArgs extends unknown[]>() {
  const listeners = new Set<TListener<TArgs>>();
  return {
    tap(listener: TListener<TArgs>) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    call(...args: TArgs) {
      listeners.forEach((listener) => listener(...args));
    },
    size() {
      return listeners.size;
    },
  };
}

function tool(id: string, args: Partial<TTool> = {}): TTool {
  return {
    id,
    label: id.toUpperCase(),
    behavior: { type: "mode", mode: "draw-create" },
    ...args,
  };
}

function createToolService(tools: TTool[]) {
  const toolsChange = hook<[]>();
  const activeToolChange = hook<[string]>();
  return {
    activeToolId: "select",
    getTools: () => tools,
    hooks: { toolsChange, activeToolChange },
  };
}

let viewport: HTMLDivElement | undefined;
let dispose: (() => void) | undefined;
let viewportHeight = 320;
let resizeCallback: ResizeObserverCallback | undefined;
const disconnect = vi.fn();

beforeEach(() => {
  viewportHeight = 320;
  resizeCallback = undefined;
  disconnect.mockClear();
  class TestResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      resizeCallback = callback;
    }
    observe() {}
    disconnect() {
      disconnect();
    }
  }
  vi.stubGlobal("ResizeObserver", TestResizeObserver);

  viewport = document.createElement("div");
  Object.defineProperty(viewport, "clientHeight", {
    configurable: true,
    get: () => viewportHeight,
  });
  viewport.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 600,
    bottom: viewportHeight,
    width: 600,
    height: viewportHeight,
    toJSON: () => ({}),
  });
  document.body.appendChild(viewport);
});

afterEach(() => {
  vi.useRealTimers();
  dispose?.();
  dispose = undefined;
  viewport?.remove();
  viewport = undefined;
  vi.unstubAllGlobals();
});

describe("RuntimeToolbar", () => {
  it("loads persisted group definitions and renders their stored icon", async () => {
    const service = createToolService([
      tool("one", { group: "health" }),
      tool("two", { group: "health" }),
    ]);
    let icon = "🩺";
    const list = vi.fn().mockImplementation(async () => [null, [{ name: "health", json: { svgIcon: icon } }]]);
    dispose = render(() => createComponent(RuntimeToolbar, {
      tool: service as never,
      apiService: { api: { tool: { groups: { list } } } } as never,
      viewportElement: viewport!,
      onToolSelect: () => {},
    }), viewport!);

    await vi.waitFor(() => {
      expect(viewport?.querySelector<HTMLButtonElement>("button[aria-label='health']")?.textContent).toContain("🩺");
    });
    expect(list).toHaveBeenCalledOnce();

    icon = "♥";
    window.dispatchEvent(new Event(TOOL_GROUPS_CHANGED_EVENT));
    await vi.waitFor(() => {
      expect(viewport?.querySelector<HTMLButtonElement>("button[aria-label='health']")?.textContent).toContain("♥");
    });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("shows a tool label popover after hover and closes it on pointer leave", async () => {
    vi.useFakeTimers();
    const service = createToolService([tool("select", { label: "Select tool" })]);
    dispose = render(() => createComponent(RuntimeToolbar, {
      tool: service as never,
      viewportElement: viewport!,
      onToolSelect: () => {},
    }), viewport!);

    const button = viewport?.querySelector<HTMLButtonElement>("button[aria-label='Select tool']");
    const anchor = button?.closest<HTMLElement>(".vc-toolbar-label-anchor");
    anchor?.dispatchEvent(new MouseEvent("pointerenter"));
    await vi.advanceTimersByTimeAsync(299);
    expect(document.querySelector(".vc-toolbar-label-popover")).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    expect(document.querySelector(".vc-toolbar-label-popover")?.textContent).toBe("Select tool");

    anchor?.dispatchEvent(new MouseEvent("pointerleave"));
    const closedPopover = document.querySelector(".vc-toolbar-label-popover");
    expect(closedPopover === null || closedPopover.hasAttribute("data-closed")).toBe(true);
  });

  it("shows tool labels immediately for keyboard focus", () => {
    const service = createToolService([tool("hand", { label: "Hand tool" })]);
    dispose = render(() => createComponent(RuntimeToolbar, {
      tool: service as never,
      viewportElement: viewport!,
      onToolSelect: () => {},
    }), viewport!);

    viewport?.querySelector<HTMLButtonElement>("button[aria-label='Hand tool']")?.focus();

    expect(document.querySelector(".vc-toolbar-label-popover")?.textContent).toBe("Hand tool");
  });

  it("opens grouped tools on focus, selects a member, and closes the flyout", () => {
    const service = createToolService([
      tool("select"),
      tool("image", { group: "media" }),
      tool("video", { group: "media" }),
    ]);
    const onToolSelect = vi.fn();
    dispose = render(() => createComponent(RuntimeToolbar, {
      tool: service as never,
      viewportElement: viewport!,
      onToolSelect,
      groupDefinitions: { media: { icon: "M", label: "media" } },
    }), viewport!);

    const groupButton = viewport?.querySelector<HTMLButtonElement>("button[aria-label='media']");
    groupButton?.focus();

    const menu = viewport?.querySelector<HTMLElement>("[role='menu'][aria-label='media']");
    expect(groupButton?.getAttribute("aria-expanded")).toBe("true");
    expect(menu).not.toBeNull();
    expect(menu?.style.transform).toBe("");

    viewport?.querySelector<HTMLButtonElement>("button[aria-label='VIDEO']")?.click();

    expect(onToolSelect).toHaveBeenCalledWith("video");
    expect(groupButton?.getAttribute("aria-expanded")).toBe("false");
    expect(viewport?.querySelector("[role='menu'][aria-label='media']")).toBeNull();
  });

  it("dismisses an open group with Escape", () => {
    const service = createToolService([
      tool("one", { group: "bundle" }),
      tool("two", { group: "bundle" }),
    ]);
    dispose = render(() => createComponent(RuntimeToolbar, {
      tool: service as never,
      viewportElement: viewport!,
      onToolSelect: () => {},
      groupDefinitions: { bundle: { icon: "B", label: "bundle" } },
    }), viewport!);

    const groupButton = viewport?.querySelector<HTMLButtonElement>("button[aria-label='bundle']");
    groupButton?.focus();
    groupButton?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(groupButton?.getAttribute("aria-expanded")).toBe("false");
    expect(viewport?.querySelector("[role='menu']")).toBeNull();
  });

  it("adapts from a scrolling three-column layout back to one column on resize", () => {
    viewportHeight = 100;
    const service = createToolService(Array.from({ length: 6 }, (_, index) => tool(`tool-${index}`)));
    dispose = render(() => createComponent(RuntimeToolbar, {
      tool: service as never,
      viewportElement: viewport!,
      onToolSelect: () => {},
    }), viewport!);

    expect(viewport?.querySelectorAll(".vc-runtime-toolbar-column")).toHaveLength(3);
    expect(viewport?.querySelector(".vc-runtime-toolbar-list")?.classList.contains("vc-runtime-toolbar-list--scroll")).toBe(true);

    viewportHeight = 500;
    resizeCallback?.([], {} as ResizeObserver);

    expect(viewport?.querySelectorAll(".vc-runtime-toolbar-column")).toHaveLength(1);
    expect(viewport?.querySelector(".vc-runtime-toolbar-list")?.classList.contains("vc-runtime-toolbar-list--scroll")).toBe(false);
  });

  it("unsubscribes tool hooks and disconnects its resize observer", () => {
    const service = createToolService([tool("select")]);
    dispose = render(() => createComponent(RuntimeToolbar, {
      tool: service as never,
      viewportElement: viewport!,
      onToolSelect: () => {},
    }), viewport!);

    expect(service.hooks.toolsChange.size()).toBe(1);
    expect(service.hooks.activeToolChange.size()).toBe(1);
    dispose();
    dispose = undefined;

    expect(service.hooks.toolsChange.size()).toBe(0);
    expect(service.hooks.activeToolChange.size()).toBe(0);
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
