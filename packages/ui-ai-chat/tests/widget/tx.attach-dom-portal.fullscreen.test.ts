import type { TElement, TUiWidgetData, TWidgetData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ThemeService, THEME_ID_DARK, THEME_ID_LIGHT } from "@vibecanvas/service-theme";
import { SyncHook } from "@vibecanvas/tapable";
import Konva from "konva";
import { describe, expect, test, vi } from "vitest";
import { ELEMENT_DATA_ATTR } from "@vibecanvas/canvas/core/CONSTANTS";
import type { CameraService, SceneService } from "@vibecanvas/canvas/services";
import type { TWidgetHostData } from "@vibecanvas/canvas/widget-host/types";
import type { WidgetManagerService } from "../../src/widget/WidgetManagerService";
import type { TWidgetTitleBarPortal } from "../../src/widget/interface";
import {
  WIDGET_DOM_PORTAL_FULLSCREEN_Z_INDEX,
  WIDGET_HOST_HEADER_HEIGHT,
  WIDGET_HOST_TITLE_ID,
} from "../../src/widget/CONSTANTS";
import { fnCreateWidgetNode } from "../../src/widget/fn.create-widget-node";
import { fnGetHostThemeColors } from "../../src/widget/fn.get-host-theme-colors";
import { txAttachDomPortal as txAttachDomPortalWithBrowser } from "../../src/widget/attach-dom-portal";
import { createTestContainer, createTestWidgetBrowser, ensureDom } from "../test-setup";

const txAttachDomPortal = (portal: Omit<Parameters<typeof txAttachDomPortalWithBrowser>[0], "browser">, args: Parameters<typeof txAttachDomPortalWithBrowser>[1]) => (
  txAttachDomPortalWithBrowser({ ...portal, browser: createTestWidgetBrowser() }, args)
);

type TWidgetFixtureKind = "widget" | "ui-widget" | "widget-instance";

function createWidgetElement(type: TWidgetFixtureKind = "widget"): TElement {
  return {
    id: "widget-fullscreen-1",
    x: 10,
    y: 20,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    zIndex: "",
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    style: {},
    data: type === "widget-instance"
      ? {
          type,
          definitionId: "definition-1",
          revisionId: "revision-1",
          instanceId: "instance-1",
          stateDocumentId: "state-1",
          w: 160,
          h: 120,
          expanded: true,
          window: "contained",
        }
      : {
          type,
          kind: "example",
          w: 160,
          h: 120,
          expanded: true,
          window: "contained",
          payload: {},
        },
  };
}

function createCameraService() {
  return {
    hooks: {
      change: new SyncHook<[]>(),
    },
  } as unknown as CameraService;
}

function createSceneService() {
  return {
    hooks: {
      resize: new SyncHook<[number, number]>(),
    },
  } as unknown as SceneService;
}

function normalizedColor(color: string) {
  const element = document.createElement("div");
  element.style.color = color;
  return element.style.color;
}

function setWidgetData(
  node: Konva.Group,
  patch: Partial<Pick<TWidgetHostData, "expanded" | "window">>,
) {
  const current = node.getAttr(ELEMENT_DATA_ATTR) as TWidgetHostData;
  node.setAttr(ELEMENT_DATA_ATTR, { ...current, ...patch });
}

describe("txAttachDomPortal fullscreen", () => {
  test.each(["widget", "widget-instance"] as const)("keeps the mounted %s body while Solid chrome enters and exits fullscreen, then disposes completely", (type) => {
    ensureDom();

    const element = createWidgetElement(type);
    const themeService = new ThemeService({ initialThemeId: THEME_ID_LIGHT });
    const hostColors = fnGetHostThemeColors(themeService, type);
    const container = createTestContainer({ width: 800, height: 600 });
    const stage = new Konva.Stage({ container, width: 800, height: 600 });
    const layer = new Konva.Layer();
    const widgetPortal = document.createElement("div");
    const node = fnCreateWidgetNode(Konva, hostColors, element);
    const cameraService = createCameraService();
    const sceneService = createSceneService();
    const closeMenu = vi.fn();
    let sync = () => undefined;

    expect(node).toBeInstanceOf(Konva.Group);
    stage.add(layer);
    layer.add(node as Konva.Group);
    container.appendChild(widgetPortal);

    const removeListener = txAttachDomPortal({
      node,
      document,
      widgetServie: {} as WidgetManagerService,
      widgetPortal,
      cameraService,
      sceneService,
      themeService,
      hostColors,
      fullscreenHostActions: {
        close: vi.fn(),
        minimize: vi.fn(),
        exitFullscreen: () => {
          setWidgetData(node as Konva.Group, { window: "contained" });
          sync();
        },
        openMenu: vi.fn(),
        closeMenu,
      },
    }, { element });
    sync = removeListener?.syncDiv ?? sync;
    cameraService.hooks.change.call();

    const div = widgetPortal.querySelector<HTMLDivElement>("[data-widget-element-id='widget-fullscreen-1']");
    const headerRoot = widgetPortal.querySelector<HTMLDivElement>("[data-widget-fullscreen-header-root-for='widget-fullscreen-1']");
    expect(div).not.toBeNull();
    expect(headerRoot).not.toBeNull();
    expect(div?.style.width).toBe("160px");
    expect(div?.style.height).toBe(`${120 - WIDGET_HOST_HEADER_HEIGHT}px`);

    setWidgetData(node as Konva.Group, { window: "fullscreen" });
    sync();

    const fullscreenDiv = widgetPortal.querySelector<HTMLDivElement>("[data-widget-element-id='widget-fullscreen-1']");
    const fullscreenHeader = widgetPortal.querySelector<HTMLDivElement>("[data-widget-fullscreen-header-id='widget-fullscreen-1']");
    const exitFullscreen = widgetPortal.querySelector<HTMLButtonElement>("[data-widget-fullscreen-control='exit-fullscreen']");
    expect(fullscreenDiv).toBe(div);
    expect(fullscreenHeader?.style.display).toBe("flex");
    expect(fullscreenHeader?.style.height).toBe(`${WIDGET_HOST_HEADER_HEIGHT}px`);
    expect(fullscreenHeader?.style.backgroundColor).toBe(normalizedColor(hostColors.headerFill));
    expect(fullscreenDiv?.style.top).toBe(`${WIDGET_HOST_HEADER_HEIGHT}px`);
    expect(fullscreenDiv?.style.width).toBe("800px");
    expect(fullscreenDiv?.style.height).toBe(`${600 - WIDGET_HOST_HEADER_HEIGHT}px`);
    expect(fullscreenDiv?.style.transform).toBe("none");
    expect(fullscreenDiv?.style.zIndex).toBe(WIDGET_DOM_PORTAL_FULLSCREEN_Z_INDEX);

    Object.defineProperty(container, "clientWidth", { configurable: true, value: 1000 });
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 700 });
    sceneService.hooks.resize.call(1000, 700);
    expect(fullscreenHeader?.style.width).toBe("1000px");
    expect(fullscreenDiv?.style.width).toBe("1000px");
    expect(fullscreenDiv?.style.height).toBe(`${700 - WIDGET_HOST_HEADER_HEIGHT}px`);

    exitFullscreen?.click();
    const containedData = (node as Konva.Group).getAttr(ELEMENT_DATA_ATTR) as TWidgetHostData;
    const containedDiv = widgetPortal.querySelector<HTMLDivElement>("[data-widget-element-id='widget-fullscreen-1']");
    expect(containedData.window).toBe("contained");
    expect(containedDiv).toBe(div);
    expect(containedDiv?.style.width).toBe("160px");
    expect(containedDiv?.style.top).toBe("0px");
    expect(containedDiv?.style.height).toBe(`${120 - WIDGET_HOST_HEADER_HEIGHT}px`);
    expect(containedDiv?.style.zIndex).toBe("");
    expect(fullscreenHeader?.style.display).toBe("none");

    removeListener?.();
    expect(closeMenu).toHaveBeenCalledOnce();
    expect(headerRoot?.isConnected).toBe(false);
    expect(fullscreenHeader?.isConnected).toBe(false);
    expect(div?.isConnected).toBe(false);
    stage.destroy();
    widgetPortal.remove();
  });

  test("dispatches traffic lights, DOM-anchored menu, and live custom title actions", () => {
    ensureDom();

    const element = createWidgetElement("ui-widget");
    const themeService = new ThemeService();
    const hostColors = fnGetHostThemeColors(themeService, "ui-widget");
    const container = createTestContainer({ width: 700, height: 500 });
    const stage = new Konva.Stage({ container, width: 700, height: 500 });
    const layer = new Konva.Layer();
    const widgetPortal = document.createElement("div");
    const node = fnCreateWidgetNode(Konva, hostColors, element, { label: "AI Chat" }) as Konva.Group;
    const close = vi.fn();
    const openMenu = vi.fn();
    let titleBar: TWidgetTitleBarPortal | undefined;
    let sync = () => undefined;

    stage.add(layer);
    layer.add(node);
    container.appendChild(widgetPortal);

    const removeListener = txAttachDomPortal({
      node,
      document,
      widgetServie: {} as WidgetManagerService,
      widgetPortal,
      cameraService: createCameraService(),
      themeService,
      hostColors,
      widgetConfig: {
        id: "example",
        dataType: "ui-widget",
        tool: { label: "AI Chat" },
        titleBarActions: [{ id: "settings", label: "Settings" }],
        renderDom: (args) => { titleBar = args.titleBar; },
      },
      fullscreenHostActions: {
        close,
        minimize: () => {
          setWidgetData(node, { window: "contained", expanded: false });
          sync();
        },
        exitFullscreen: () => {
          setWidgetData(node, { window: "contained", expanded: true });
          sync();
        },
        openMenu,
        closeMenu: vi.fn(),
      },
    }, { element });
    sync = removeListener?.syncDiv ?? sync;
    setWidgetData(node, { window: "fullscreen", expanded: true });
    sync();

    let titleActionCalls = 0;
    titleBar?.onAction("settings", () => { titleActionCalls += 1; });
    titleBar?.setActionState("settings", { label: "Back to chat", pressed: true });

    const header = widgetPortal.querySelector<HTMLElement>("[data-widget-fullscreen-header-id='widget-fullscreen-1']");
    const closeButton = header?.querySelector<HTMLButtonElement>("[data-widget-fullscreen-control='close']");
    const minimizeButton = header?.querySelector<HTMLButtonElement>("[data-widget-fullscreen-control='minimize']");
    const exitButton = header?.querySelector<HTMLButtonElement>("[data-widget-fullscreen-control='exit-fullscreen']");
    const settingsButton = header?.querySelector<HTMLButtonElement>("[data-widget-title-action-id='settings']");
    const menuButton = header?.querySelector<HTMLButtonElement>("[data-widget-fullscreen-menu-button='widget-fullscreen-1']");
    let bubbledPointerDown = 0;
    container.addEventListener("pointerdown", () => { bubbledPointerDown += 1; });

    expect(settingsButton?.textContent).toBe("Back to chat");
    expect(settingsButton?.getAttribute("aria-pressed")).toBe("true");
    settingsButton?.click();
    expect(titleActionCalls).toBe(1);

    Object.defineProperty(menuButton, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 100, top: 40, right: 122, bottom: 62, x: 100, y: 40, width: 22, height: 22, toJSON: () => ({}) }),
    });
    menuButton?.click();
    expect(openMenu).toHaveBeenCalledWith({ anchor: { x: 122, y: 62 } });

    closeButton?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    closeButton?.click();
    expect(bubbledPointerDown).toBe(0);
    expect(close).toHaveBeenCalledOnce();

    minimizeButton?.click();
    let widgetData = node.getAttr(ELEMENT_DATA_ATTR) as TUiWidgetData;
    expect(widgetData.window).toBe("contained");
    expect(widgetData.expanded).toBe(false);
    expect(widgetPortal.querySelector<HTMLElement>("[data-widget-fullscreen-header-id='widget-fullscreen-1']")?.style.display).toBe("none");
    expect(widgetPortal.querySelector<HTMLElement>("[data-widget-element-id='widget-fullscreen-1']")?.style.display).toBe("none");

    setWidgetData(node, { window: "fullscreen", expanded: true });
    sync();
    exitButton?.click();
    widgetData = node.getAttr(ELEMENT_DATA_ATTR) as TUiWidgetData;
    expect(widgetData.window).toBe("contained");
    expect(widgetData.expanded).toBe(true);

    removeListener?.();
    stage.destroy();
    widgetPortal.remove();
  });

  test("reacts to Konva label updates and shared theme changes", () => {
    ensureDom();

    const element = createWidgetElement("ui-widget");
    const themeService = new ThemeService({ initialThemeId: THEME_ID_LIGHT });
    const hostColors = fnGetHostThemeColors(themeService, "ui-widget");
    const container = createTestContainer();
    const stage = new Konva.Stage({ container, width: 800, height: 600 });
    const layer = new Konva.Layer();
    const widgetPortal = document.createElement("div");
    const node = fnCreateWidgetNode(Konva, hostColors, element, { label: "Original" }) as Konva.Group;

    stage.add(layer);
    layer.add(node);
    container.appendChild(widgetPortal);

    const removeListener = txAttachDomPortal({
      node,
      document,
      widgetServie: {} as WidgetManagerService,
      widgetPortal,
      cameraService: createCameraService(),
      themeService,
      hostColors,
    }, { element });
    setWidgetData(node, { window: "fullscreen" });
    removeListener?.syncDiv();

    const header = widgetPortal.querySelector<HTMLElement>("[data-widget-fullscreen-header-id='widget-fullscreen-1']");
    const title = node.findOne(`#${WIDGET_HOST_TITLE_ID}`) as Konva.Text;
    expect(header?.style.backgroundColor).toBe(normalizedColor(hostColors.headerFill));
    expect(header?.querySelector("[data-widget-fullscreen-title]")?.textContent).toBe("Original");

    title.text("Renamed widget");
    removeListener?.syncDiv();
    expect(header?.querySelector("[data-widget-fullscreen-title]")?.textContent).toBe("Renamed widget");

    themeService.setTheme(THEME_ID_DARK);
    const darkColors = fnGetHostThemeColors(themeService, "ui-widget");
    expect(header?.style.backgroundColor).toBe(normalizedColor(darkColors.headerFill));
    expect(header?.style.color).toBe(normalizedColor(darkColors.headerTitleFill));

    removeListener?.();
    stage.destroy();
    widgetPortal.remove();
  });
});
