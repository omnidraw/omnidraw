import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ThemeService } from "@vibecanvas/service-theme";
import { SyncHook } from "@vibecanvas/tapable";
import Konva from "konva";
import { describe, expect, test } from "vitest";
import { ELEMENT_DATA_ATTR } from "@vibecanvas/canvas/core/CONSTANTS";
import type { CameraService } from "@vibecanvas/canvas/services";
import type { WidgetManagerService } from "../../src/widget/WidgetManagerService";
import {
  WIDGET_DOM_PORTAL_FULLSCREEN_Z_INDEX,
  WIDGET_HOST_HEADER_HEIGHT,
} from "../../src/widget/CONSTANTS";
import { fnCreateWidgetNode } from "../../src/widget/fn.create-widget-node";
import { fnGetHostThemeColors } from "../../src/widget/fn.get-host-theme-colors";
import { txAttachDomPortal as txAttachDomPortalWithBrowser } from "../../src/widget/attach-dom-portal";
import { createTestContainer, createTestWidgetBrowser, ensureDom } from "../test-setup";

const txAttachDomPortal = (portal: Omit<Parameters<typeof txAttachDomPortalWithBrowser>[0], "browser">, args: Parameters<typeof txAttachDomPortalWithBrowser>[1]) => (
  txAttachDomPortalWithBrowser({ ...portal, browser: createTestWidgetBrowser() }, args)
);

function createWidgetElement(): TElement {
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
    data: {
      type: "widget",
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

describe("txAttachDomPortal fullscreen", () => {
  test("reuses the same body div and expands it over the portal parent", () => {
    ensureDom();

    const element = createWidgetElement();
    const container = createTestContainer({ width: 800, height: 600 });
    const stage = new Konva.Stage({ container, width: 800, height: 600 });
    const layer = new Konva.Layer();
    const widgetPortal = document.createElement("div");
    const node = fnCreateWidgetNode(Konva, fnGetHostThemeColors(new ThemeService()), element);
    const cameraService = createCameraService();

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
    }, { element });
    cameraService.hooks.change.call();

    const div = widgetPortal.querySelector<HTMLDivElement>("[data-widget-element-id='widget-fullscreen-1']");
    expect(div).not.toBeNull();
    expect(div?.style.width).toBe("160px");
    expect(div?.style.height).toBe(`${120 - WIDGET_HOST_HEADER_HEIGHT}px`);

    (node as Konva.Group).setAttr(ELEMENT_DATA_ATTR, {
      ...element.data,
      window: "fullscreen",
    });
    removeListener?.syncDiv();

    const fullscreenDiv = widgetPortal.querySelector<HTMLDivElement>("[data-widget-element-id='widget-fullscreen-1']");
    const fullscreenHeader = widgetPortal.querySelector<HTMLDivElement>("[data-widget-fullscreen-header-id='widget-fullscreen-1']");
    const fullscreenWindowButton = widgetPortal.querySelector<HTMLButtonElement>("[data-widget-fullscreen-window-button-id='widget-fullscreen-1']");
    expect(fullscreenDiv).toBe(div);
    expect(fullscreenHeader).not.toBeNull();
    expect(fullscreenWindowButton).not.toBeNull();
    expect(fullscreenWindowButton?.textContent).toBe("Exit Fullscreen");
    expect(fullscreenWindowButton?.getAttribute("aria-label")).toBe("Exit Fullscreen");
    expect(fullscreenHeader?.style.display).toBe("");
    expect(fullscreenHeader?.style.height).toBe(`${WIDGET_HOST_HEADER_HEIGHT}px`);
    expect(fullscreenDiv?.style.top).toBe(`${WIDGET_HOST_HEADER_HEIGHT}px`);
    expect(fullscreenDiv?.style.width).toBe("800px");
    expect(fullscreenDiv?.style.height).toBe(`${600 - WIDGET_HOST_HEADER_HEIGHT}px`);
    expect(fullscreenDiv?.style.transform).toBe("none");
    expect(fullscreenDiv?.style.zIndex).toBe(WIDGET_DOM_PORTAL_FULLSCREEN_Z_INDEX);

    fullscreenWindowButton?.click();
    expect(((node as Konva.Group).getAttr(ELEMENT_DATA_ATTR) as TElement["data"]).type).toBe("widget");
    expect(((node as Konva.Group).getAttr(ELEMENT_DATA_ATTR) as Extract<TElement["data"], { type: "widget" }>).window).toBe("contained");

    (node as Konva.Group).setAttr(ELEMENT_DATA_ATTR, element.data);
    removeListener?.syncDiv();

    const containedDiv = widgetPortal.querySelector<HTMLDivElement>("[data-widget-element-id='widget-fullscreen-1']");
    expect(containedDiv).toBe(div);
    expect(containedDiv?.style.width).toBe("160px");
    expect(containedDiv?.style.top).toBe("0px");
    expect(containedDiv?.style.height).toBe(`${120 - WIDGET_HOST_HEADER_HEIGHT}px`);
    expect(containedDiv?.style.zIndex).toBe("");
    expect(fullscreenHeader?.style.display).toBe("none");

    removeListener?.();
    stage.destroy();
    widgetPortal.remove();
  });
});
