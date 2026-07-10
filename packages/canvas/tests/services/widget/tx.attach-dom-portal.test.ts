import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ThemeService } from "@vibecanvas/service-theme";
import { SyncHook } from "@vibecanvas/tapable";
import Konva from "konva";
import { describe, expect, test } from "vitest";
import type { CameraService, WidgetManagerService } from "../../../src/services";
import { WIDGET_HOST_HEADER_HEIGHT } from "../../../src/services/widget/CONSTANTS";
import { fnCreateWidgetNode } from "../../../src/services/widget/fn.create-widget-node";
import { fnGetHostThemeColors } from "../../../src/services/widget/fn.get-host-theme-colors";
import { txAttachDomPortal } from "../../../src/services/widget/attach-dom-portal";
import { txResizeWidgetHost } from "../../../src/services/widget/tx.resize-widget-host";
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
  test("shows loading instead of a definition error while widget discovery is pending", () => {
    const { cameraService, element, group, stage, widgetPortal } = createMountedWidget();
    const removeListener = txAttachDomPortal({
      node: group,
      document,
      widgetServie: { getWidgetError: () => null } as unknown as WidgetManagerService,
      widgetPortal,
      cameraService,
    }, { element });

    expect(widgetPortal.querySelector('[data-widget-host-loading]')?.textContent).toBe('Loading widget…');
    expect(widgetPortal.querySelector('[data-widget-host-error]')).toBeNull();

    removeListener?.();
    stage.destroy();
    widgetPortal.remove();
  });

  test("shows a definition error after widget discovery has settled", () => {
    const { cameraService, element, group, stage, widgetPortal } = createMountedWidget();
    const removeListener = txAttachDomPortal({
      node: group,
      document,
      widgetServie: {
        getWidgetError: () => ({
          phase: 'definition-fetch',
          code: 'WIDGET_DEFINITION_UNAVAILABLE',
          message: 'Widget definition is unavailable.',
          retryable: true,
        }),
      } as unknown as WidgetManagerService,
      widgetPortal,
      cameraService,
    }, { element });

    expect(widgetPortal.querySelector('[data-widget-host-error]')).not.toBeNull();
    expect(widgetPortal.querySelector('[data-widget-host-loading]')).toBeNull();

    removeListener?.();
    stage.destroy();
    widgetPortal.remove();
  });

  test("replaces a throwing renderer with escaped host-owned error text", () => {
    const { cameraService, element, group, stage, widgetPortal } = createMountedWidget();
    const removeListener = txAttachDomPortal({
      node: group,
      document,
      widgetServie: {} as WidgetManagerService,
      widgetPortal,
      cameraService,
      widgetConfig: {
        id: "example",
        renderDom: () => {
          throw new Error('<img src=x onerror="alert(1)">');
        },
      },
    }, { element });

    const alert = widgetPortal.querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.textContent).toContain('[Error loading Widget: <img src=x onerror="alert(1)">]');
    expect(alert?.textContent).toContain('Widget fault');
    expect(alert?.textContent).toContain('WIDGET_RENDER_FAILED');
    expect(alert?.querySelector('img')).toBeNull();
    expect(alert?.dataset.widgetErrorCode).toBe('WIDGET_RENDER_FAILED');

    removeListener?.();
    stage.destroy();
    widgetPortal.remove();
  });

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

  test("syncs the widget body div after widget resize", () => {
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
    expect(div.style.width).toBe("160px");
    expect(div.style.height).toBe(`${120 - WIDGET_HOST_HEADER_HEIGHT}px`);

    group.scale({ x: 2, y: 1.5 });
    txResizeWidgetHost({
      Group: Konva.Group,
      Rect: Konva.Rect,
    }, {
      node: group,
    });
    removeListener?.syncDiv();

    expect(div.style.width).toBe("320px");
    expect(div.style.height).toBe(`${180 - WIDGET_HOST_HEADER_HEIGHT}px`);
    expect(div.style.transform).toBe("matrix(1,0,0,1,10,48)");

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
