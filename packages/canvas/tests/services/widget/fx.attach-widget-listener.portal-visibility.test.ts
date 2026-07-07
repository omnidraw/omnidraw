import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ThemeService } from "@vibecanvas/service-theme";
import { SyncExitHook } from "@vibecanvas/tapable";
import { SyncHook } from "@vibecanvas/tapable";
import Konva from "konva";
import { describe, expect, test } from "vitest";
import type { CameraService, CrdtService, WidgetManagerService } from "../../../src/services";
import { SelectionService } from "../../../src/services/selection/SelectionService";
import type { IRuntimeHooks } from "../../../src/types";
import { fnCreateWidgetNode } from "../../../src/services/widget/fn.create-widget-node";
import { fnGetHostThemeColors } from "../../../src/services/widget/fn.get-host-theme-colors";
import { fxAttachWidgetListener } from "../../../src/services/widget/fx.attach-widget-listener";
import { WIDGET_DOM_PORTAL_SYNC_ATTR, WIDGET_HOST_MINIMIZE_BUTTON_ID } from "../../../src/services/widget/CONSTANTS";
import { txAttachDomPortal } from "../../../src/services/widget/attach-dom-portal";
import { createTestContainer, ensureDom } from "../../test-setup";

function createWidgetElement(): TElement {
  return {
    id: "widget-button-1",
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

describe("widget button portal visibility", () => {
  test("keeps the mounted body div synced while dragging after widget listeners attach", () => {
    ensureDom();

    const element = createWidgetElement();
    const container = createTestContainer();
    const stage = new Konva.Stage({ container, width: 800, height: 600 });
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

    const div = widgetPortal.querySelector<HTMLDivElement>("[data-widget-element-id='widget-button-1']");
    expect(div).not.toBeNull();
    const initialTransform = div?.style.transform;

    (node as Konva.Group).position({ x: 80, y: 90 });
    (node as Konva.Group).fire("dragmove");

    expect(div?.style.transform).not.toBe(initialTransform);
    expect(div?.style.transform).toContain("80");
    expect(div?.style.transform).toContain("118");

    removeListener?.();
    stage.destroy();
    widgetPortal.remove();
  });

  test("hides the mounted body div when minimize toggles expanded false", () => {
    ensureDom();

    const element = createWidgetElement();
    const container = createTestContainer();
    const stage = new Konva.Stage({ container, width: 800, height: 600 });
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

    const div = widgetPortal.querySelector<HTMLDivElement>("[data-widget-element-id='widget-button-1']");
    expect(div).not.toBeNull();
    expect(div?.style.display).toBe("");

    const minimize = (node as Konva.Group).findOne(`#${WIDGET_HOST_MINIMIZE_BUTTON_ID}`);
    expect(minimize).toBeInstanceOf(Konva.Circle);
    minimize?.fire("pointerclick", { cancelBubble: false });

    expect(div?.style.display).toBe("none");

    removeListener?.();
    stage.destroy();
    widgetPortal.remove();
  });
});
