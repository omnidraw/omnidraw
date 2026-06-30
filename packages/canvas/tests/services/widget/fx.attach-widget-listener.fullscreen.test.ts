import type { TElement, TWidgetData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ThemeService } from "@vibecanvas/service-theme";
import { SyncExitHook, SyncHook } from "@vibecanvas/tapable";
import Konva from "konva";
import { describe, expect, test } from "vitest";
import { ELEMENT_DATA_ATTR } from "../../../src/core/CONSTANTS";
import type { CameraService, CrdtService, WidgetManagerService } from "../../../src/services";
import { SelectionService } from "../../../src/services/selection/SelectionService";
import type { IRuntimeHooks } from "../../../src/types";
import {
  WIDGET_DOM_PORTAL_FULLSCREEN_Z_INDEX,
  WIDGET_DOM_PORTAL_SYNC_ATTR,
  WIDGET_HOST_HEADER_HEIGHT,
  WIDGET_HOST_MAXIMIZE_BUTTON_ID,
} from "../../../src/services/widget/CONSTANTS";
import { fnCreateWidgetNode } from "../../../src/services/widget/fn.create-widget-node";
import { fnGetHostThemeColors } from "../../../src/services/widget/fn.get-host-theme-colors";
import { fxAttachWidgetListener } from "../../../src/services/widget/fx.attach-widget-listener";
import { txAttachDomPortal } from "../../../src/services/widget/attach-dom-portal";
import { createTestContainer, ensureDom } from "../../test-setup";

function createWidgetElement(): TElement {
  return {
    id: "widget-fullscreen-button-1",
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

function createHooks() {
  return {
    elementPointerClick: new SyncExitHook(),
    elementPointerDown: new SyncExitHook(),
    elementPointerDoubleClick: new SyncExitHook(),
  } as unknown as IRuntimeHooks;
}

describe("widget fullscreen button", () => {
  test("toggles fullscreen without replacing the mounted body div", () => {
    ensureDom();

    const element = createWidgetElement();
    const container = createTestContainer({ width: 900, height: 700 });
    const stage = new Konva.Stage({ container, width: 900, height: 700 });
    const layer = new Konva.Layer();
    const widgetPortal = document.createElement("div");
    const cameraService = createCameraService();
    const selectionService = new SelectionService();
    const node = fnCreateWidgetNode(Konva, fnGetHostThemeColors(new ThemeService()), element);

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
      selectionService,
    }, { element });
    if (removeListener) {
      (node as Konva.Group).setAttr(WIDGET_DOM_PORTAL_SYNC_ATTR, removeListener.syncDiv);
    }
    cameraService.hooks.change.call();

    fxAttachWidgetListener({
      node: node as Konva.Group,
      Circle: Konva.Circle,
      Group: Konva.Group,
      Rect: Konva.Rect,
      hooks: createHooks(),
      selection: selectionService,
      toElement: () => element,
      crdtService: {} as CrdtService,
    }, {});

    const div = widgetPortal.querySelector<HTMLDivElement>("[data-widget-element-id='widget-fullscreen-button-1']");
    expect(div).not.toBeNull();

    const maximize = (node as Konva.Group).findOne(`#${WIDGET_HOST_MAXIMIZE_BUTTON_ID}`);
    expect(maximize).toBeInstanceOf(Konva.Circle);
    maximize?.fire("pointerclick", { cancelBubble: false });

    const fullscreenData = (node as Konva.Group).getAttr(ELEMENT_DATA_ATTR) as TWidgetData;
    const fullscreenDiv = widgetPortal.querySelector<HTMLDivElement>("[data-widget-element-id='widget-fullscreen-button-1']");
    const fullscreenHeader = widgetPortal.querySelector<HTMLDivElement>("[data-widget-fullscreen-header-id='widget-fullscreen-button-1']");
    expect(fullscreenData.window).toBe("fullscreen");
    expect(fullscreenDiv).toBe(div);
    expect(fullscreenHeader).not.toBeNull();
    expect(fullscreenHeader?.style.height).toBe(`${WIDGET_HOST_HEADER_HEIGHT}px`);
    expect(fullscreenDiv?.style.top).toBe(`${WIDGET_HOST_HEADER_HEIGHT}px`);
    expect(fullscreenDiv?.style.width).toBe("900px");
    expect(fullscreenDiv?.style.height).toBe(`${700 - WIDGET_HOST_HEADER_HEIGHT}px`);
    expect(fullscreenDiv?.style.zIndex).toBe(WIDGET_DOM_PORTAL_FULLSCREEN_Z_INDEX);

    maximize?.fire("pointerclick", { cancelBubble: false });

    const containedData = (node as Konva.Group).getAttr(ELEMENT_DATA_ATTR) as TWidgetData;
    const containedDiv = widgetPortal.querySelector<HTMLDivElement>("[data-widget-element-id='widget-fullscreen-button-1']");
    expect(containedData.window).toBe("contained");
    expect(containedDiv).toBe(div);
    expect(containedDiv?.style.width).toBe("160px");
    expect(containedDiv?.style.zIndex).toBe("");

    removeListener?.();
    stage.destroy();
    widgetPortal.remove();
  });
});
