import { createComponent } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeToolbar } from "../../../src/components/FloatingCanvasToolbar/RuntimeToolbar";
import type { TTool } from "../../../src/services/tool/types";
import type { TWidgetDropRequest } from "../../../src/services/widget-placement/types";

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
  it("marks draft tools with a distinct toolbar tone", () => {
    const service = createToolService([tool("weather-draft", { label: "Weather · Draft", tone: "draft" })]);
    dispose = render(() => createComponent(RuntimeToolbar, {
      tool: service as never,
      viewportElement: viewport!,
      onToolSelect: () => {},
    }), viewport!);

    expect(viewport?.querySelector<HTMLButtonElement>("button[aria-label='Weather · Draft']")?.classList.contains("vc-toolbar-button--draft")).toBe(true);
  });

  it("loads persisted group definitions and renders their stored icon", async () => {
    const service = createToolService([
      tool("one", { group: "health" }),
      tool("two", { group: "health" }),
    ]);
    let icon = "🩺";
    const listeners = new Set<() => void>();
    const list = vi.fn().mockImplementation(async () => [{ name: "health", json: { svgIcon: icon } }]);
    const toolbarGroups = {
      list,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    dispose = render(() => createComponent(RuntimeToolbar, {
      tool: service as never,
      toolbarGroups,
      viewportElement: viewport!,
      onToolSelect: () => {},
    }), viewport!);

    await vi.waitFor(() => {
      expect(viewport?.querySelector<HTMLButtonElement>("button[aria-label='health']")?.textContent).toContain("🩺");
    });
    expect(list).toHaveBeenCalledOnce();

    icon = "♥";
    listeners.forEach((listener) => listener());
    await vi.waitFor(() => {
      expect(viewport?.querySelector<HTMLButtonElement>("button[aria-label='health']")?.textContent).toContain("♥");
    });
    expect(list).toHaveBeenCalledTimes(2);

    dispose();
    dispose = undefined;
    expect(listeners.size).toBe(0);
  });

  it("keeps the last group definitions when a refresh fails", async () => {
    const service = createToolService([
      tool("one", { group: "health" }),
      tool("two", { group: "health" }),
    ]);
    const listeners = new Set<() => void>();
    const list = vi.fn()
      .mockResolvedValueOnce([{ name: "health", json: { svgIcon: "🩺" } }])
      .mockRejectedValueOnce(new Error("temporary catalog failure"));
    dispose = render(() => createComponent(RuntimeToolbar, {
      tool: service as never,
      toolbarGroups: {
        list,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      viewportElement: viewport!,
      onToolSelect: () => {},
    }), viewport!);

    await vi.waitFor(() => {
      expect(viewport?.querySelector<HTMLButtonElement>("button[aria-label='health']")?.textContent).toContain("🩺");
    });

    listeners.forEach((listener) => listener());
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(viewport?.querySelector<HTMLButtonElement>("button[aria-label='health']")?.textContent).toContain("🩺");
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

  it("starts widget placement without consuming clicks and exposes the keyboard Add action", async () => {
    vi.useFakeTimers();
    const request = {
      reference: { source: "published" as const, name: "Weather", revision: "revision-1" },
      bounds: { width: 360, height: 320 },
      label: "Weather",
      onCommit: vi.fn(),
    };
    let activeRequest: TWidgetDropRequest | undefined;
    const beginPointerSession = vi.fn((nextRequest: TWidgetDropRequest) => {
      activeRequest = nextRequest;
      return true;
    });
    const addAtViewportCenter = vi.fn();
    const onToolSelect = vi.fn();
    const service = createToolService([tool("weather", { label: "Weather", widgetPlacement: request })]);
    dispose = render(() => createComponent(RuntimeToolbar, {
      tool: service as never,
      viewportElement: viewport!,
      widgetPlacement: { beginPointerSession, addAtViewportCenter } as never,
      onToolSelect,
    }), viewport!);

    const button = viewport?.querySelector<HTMLButtonElement>("button[aria-label='Weather']");
    button?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    expect(beginPointerSession).toHaveBeenCalledOnce();
    button?.click();
    expect(onToolSelect).toHaveBeenCalledOnce();

    activeRequest?.onDragStart?.();
    button?.click();
    expect(onToolSelect).toHaveBeenCalledOnce();
    activeRequest?.onDragEnd?.();
    await vi.runAllTimersAsync();
    button?.click();
    expect(onToolSelect).toHaveBeenCalledTimes(2);

    button?.focus();
    const add = document.querySelector<HTMLButtonElement>(".vc-toolbar-label-popover__action");
    expect(add?.textContent).toBe("Add to canvas");
    add?.click();
    expect(addAtViewportCenter).toHaveBeenCalledWith(request);
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

  it("keeps a grouped widget flyout mounted for its active drag", () => {
    const placement = {
      reference: { source: "draft" as const, name: "Weather", revision: "revision-2" },
      bounds: { width: 360, height: 320 },
      label: "Weather Draft",
      onCommit: vi.fn(),
    };
    let activeRequest: TWidgetDropRequest | undefined;
    const service = createToolService([
      tool("weather-draft", { group: "widgets", widgetPlacement: placement }),
      tool("weather-published", { group: "widgets" }),
    ]);
    dispose = render(() => createComponent(RuntimeToolbar, {
      tool: service as never,
      viewportElement: viewport!,
      widgetPlacement: {
        beginPointerSession(nextRequest: TWidgetDropRequest) {
          activeRequest = nextRequest;
          return true;
        },
        addAtViewportCenter: vi.fn(),
      } as never,
      onToolSelect: vi.fn(),
      groupDefinitions: { widgets: { icon: "W", label: "widgets" } },
    }), viewport!);

    const groupButton = viewport?.querySelector<HTMLButtonElement>("button[aria-label='widgets']");
    groupButton?.focus();
    const member = viewport?.querySelector<HTMLButtonElement>("button[aria-label='WEATHER-DRAFT']");
    member?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    activeRequest?.onDragStart?.();
    expect(viewport?.querySelector("[role='menu'][aria-label='widgets']")).not.toBeNull();

    activeRequest?.onDragEnd?.();
    expect(viewport?.querySelector("[role='menu'][aria-label='widgets']")).toBeNull();
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
