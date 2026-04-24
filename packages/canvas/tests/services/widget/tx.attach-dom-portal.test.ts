import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ThemeService } from "@vibecanvas/service-theme";
import { SyncHook } from "@vibecanvas/tapable";
import Konva from "konva";
import { describe, expect, test } from "vitest";
import type { CameraService, WidgetManagerService } from "../../../src/services";
import { WIDGET_HOST_HEADER_HEIGHT } from "../../../src/services/widget/CONSTANTS";
import { fnCreateWidgetNode } from "../../../src/services/widget/fn.create-widget-node";
import { fnGetHostThemeColors } from "../../../src/services/widget/fn.get-host-theme-colors";
import { txAttachDomPortal } from "../../../src/services/widget/tx.attach-dom-portal";
import { createTestContainer, ensureDom } from "../../test-setup";

function createWidgetElement(): TElement {
  return {
    id: "widget-1",
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

function createMountedWidget() {
  ensureDom();

  const element = createWidgetElement();
  const container = createTestContainer();
  const stage = new Konva.Stage({
    container,
    width: 800,
    height: 600,
  });
  const layer = new Konva.Layer();
  const widgetPortal = document.createElement("div");
  const node = fnCreateWidgetNode(Konva, fnGetHostThemeColors(new ThemeService()), element);

  expect(node).toBeInstanceOf(Konva.Group);

  stage.add(layer);
  layer.add(node as Konva.Group);
  container.appendChild(widgetPortal);

  return {
    cameraService: createCameraService(),
    element,
    group: node as Konva.Group,
    layer,
    stage,
    widgetPortal,
  };
}

function firstPortalDiv(widgetPortal: HTMLDivElement) {
  const div = widgetPortal.querySelector<HTMLDivElement>("[data-widget-element-id='widget-1']");
  expect(div).not.toBeNull();
  return div as HTMLDivElement;
}

describe("txAttachDomPortal", () => {
  test("renders the widget body div from the canvas transform", async () => {
    const { cameraService, element, group, layer, stage, widgetPortal } = createMountedWidget();
    layer.position({ x: 50, y: 60 });
    layer.scale({ x: 2, y: 2 });

    const removeListener = txAttachDomPortal({
      node: group,
      document,
      widgetServie: {} as WidgetManagerService,
      widgetPortal,
      cameraService,
    }, { element });

    await new Promise((resolve) => window.setTimeout(resolve, 0));

    const div = firstPortalDiv(widgetPortal);
    expect(div.style.width).toBe("160px");
    expect(div.style.height).toBe(`${120 - WIDGET_HOST_HEADER_HEIGHT}px`);
    expect(div.style.transform).toBe("matrix(2,0,0,2,70,156)");

    removeListener?.();
    stage.destroy();
    widgetPortal.remove();
  });

  test("updates the widget body div when the camera changes", () => {
    const { cameraService, element, group, layer, stage, widgetPortal } = createMountedWidget();

    const removeListener = txAttachDomPortal({
      node: group,
      document,
      widgetServie: {} as WidgetManagerService,
      widgetPortal,
      cameraService,
    }, { element });

    cameraService.hooks.change.call();
    const div = firstPortalDiv(widgetPortal);
    expect(div.style.transform).toBe("matrix(1,0,0,1,10,48)");

    layer.position({ x: 100, y: 200 });
    layer.scale({ x: 1.5, y: 1.5 });
    cameraService.hooks.change.call();

    expect(div.style.transform).toBe("matrix(1.5,0,0,1.5,115,272)");

    removeListener?.();
    stage.destroy();
    widgetPortal.remove();
  });

  test("updates the widget body div when the widget is dragged", () => {
    const { cameraService, element, group, stage, widgetPortal } = createMountedWidget();

    const removeListener = txAttachDomPortal({
      node: group,
      document,
      widgetServie: {} as WidgetManagerService,
      widgetPortal,
      cameraService,
    }, { element });

    cameraService.hooks.change.call();
    const div = firstPortalDiv(widgetPortal);
    expect(div.style.transform).toBe("matrix(1,0,0,1,10,48)");

    group.position({ x: 30, y: 50 });
    group.fire('dragmove');

    expect(div.style.transform).toBe("matrix(1,0,0,1,30,78)");

    removeListener?.();
    stage.destroy();
    widgetPortal.remove();
  });
});
