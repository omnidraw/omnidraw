import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ThemeService } from "@vibecanvas/service-theme";
import { SyncExitHook } from "@vibecanvas/tapable";
import { SyncHook } from "@vibecanvas/tapable";
import Konva from "konva";
import { describe, expect, test, vi } from "vitest";
import type { CameraService, CrdtService } from "@vibecanvas/canvas/services";
import { SelectionService } from "@vibecanvas/canvas/services/selection/SelectionService";
import type { IRuntimeHooks } from "@vibecanvas/canvas";
import type { WidgetManagerService } from "../../src/widget/WidgetManagerService";
import { fnCreateWidgetNode } from "../../src/widget/fn.create-widget-node";
import { fnGetHostThemeColors } from "../../src/widget/fn.get-host-theme-colors";
import { fxAttachWidgetListener } from "../../src/widget/fx.attach-widget-listener";
import {
  WIDGET_DOM_PORTAL_SYNC_ATTR,
  WIDGET_HOST_BODY_ID,
  WIDGET_HOST_MINIMIZE_BUTTON_ID,
} from "../../src/widget/CONSTANTS";
import { txAttachDomPortal as txAttachDomPortalWithBrowser } from "../../src/widget/attach-dom-portal";
import { createTestContainer, createTestWidgetBrowser, ensureDom } from "../test-setup";

const txAttachDomPortal = (portal: Omit<Parameters<typeof txAttachDomPortalWithBrowser>[0], "browser">, args: Parameters<typeof txAttachDomPortalWithBrowser>[1]) => (
  txAttachDomPortalWithBrowser({ ...portal, browser: createTestWidgetBrowser() }, args)
);

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
      type: "widget-instance",
      definitionId: "definition-1",
      revisionId: "revision-1",
      instanceId: "instance-1",
      stateDocumentId: "state-1",
      w: 160,
      h: 120,
      expanded: true,
      window: "contained",
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
  test("keeps the mounted widget instance body div synced while dragging after listeners attach", () => {
    const type = "widget-instance" as const;
    ensureDom();

    const element = createWidgetElement();
    const container = createTestContainer();
    const stage = new Konva.Stage({ container, width: 800, height: 600 });
    const layer = new Konva.Layer();
    const widgetPortal = document.createElement("div");
    const cameraService = createCameraService();
    const selectionService = new SelectionService();
    const node = fnCreateWidgetNode(Konva, fnGetHostThemeColors(new ThemeService(), type), element);

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

  test("hides the mounted widget instance body div when minimize toggles expanded false", () => {
    const type = "widget-instance" as const;
    ensureDom();

    const element = createWidgetElement();
    const container = createTestContainer();
    const stage = new Konva.Stage({ container, width: 800, height: 600 });
    const layer = new Konva.Layer();
    const widgetPortal = document.createElement("div");
    const cameraService = createCameraService();
    const selectionService = new SelectionService();
    const node = fnCreateWidgetNode(Konva, fnGetHostThemeColors(new ThemeService(), type), element);

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

  test("activates neutral DOM pointer handling only while the exact host is focused", () => {
    ensureDom();

    const element = createWidgetElement();
    const container = createTestContainer();
    const stage = new Konva.Stage({ container, width: 800, height: 600 });
    const layer = new Konva.Layer();
    const widgetPortal = document.createElement("div");
    const cameraService = createCameraService();
    const selectionService = new SelectionService();
    const node = fnCreateWidgetNode(
      Konva,
      fnGetHostThemeColors(new ThemeService(), "widget-instance"),
      element,
    ) as Konva.Group;
    stage.add(layer);
    layer.add(node);
    container.appendChild(widgetPortal);

    const removeListener = txAttachDomPortal({
      node,
      document,
      widgetServie: {} as WidgetManagerService,
      widgetPortal,
      cameraService,
      selectionService,
    }, { element });
    if (removeListener) node.setAttr(WIDGET_DOM_PORTAL_SYNC_ATTR, removeListener.syncDiv);
    cameraService.hooks.change.call();

    fxAttachWidgetListener({
      node,
      Circle: Konva.Circle,
      Group: Konva.Group,
      Rect: Konva.Rect,
      hooks: createHooks(),
      selection: selectionService,
      toElement: () => element,
      crdtService: {} as CrdtService,
    }, {});

    const div = widgetPortal.querySelector<HTMLDivElement>("[data-widget-element-id='widget-button-1']");
    const body = node.findOne(`#${WIDGET_HOST_BODY_ID}`);
    expect(div?.style.pointerEvents).toBe("none");

    body?.fire("pointerdown", { cancelBubble: false }, true);
    expect(selectionService.focusedId).toBe(element.id);
    expect(div?.style.pointerEvents).toBe("auto");

    let bubbledPointerDown = 0;
    container.addEventListener("pointerdown", () => { bubbledPointerDown += 1; });
    div?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(bubbledPointerDown).toBe(0);

    selectionService.setFocusedId(null);
    expect(div?.style.pointerEvents).toBe("none");
    div?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(bubbledPointerDown).toBe(1);

    removeListener?.();
    expect(div?.isConnected).toBe(false);
    stage.destroy();
    widgetPortal.remove();
  });

  test('mounts a neutral runtime only inside the preloaded viewport and tears it down offscreen', () => {
    ensureDom();
    const element = createWidgetElement();
    element.x = 5_000;
    const container = createTestContainer({ width: 800, height: 600 });
    const stage = new Konva.Stage({ container, width: 800, height: 600 });
    const layer = new Konva.Layer();
    const widgetPortal = document.createElement('div');
    const cameraService = createCameraService();
    const selectionService = new SelectionService();
    const cleanupRuntime = vi.fn();
    const renderDom = vi.fn(({ root }: { root: HTMLDivElement }) => {
      root.textContent = 'mounted';
      return cleanupRuntime;
    });
    const node = fnCreateWidgetNode(
      Konva,
      fnGetHostThemeColors(new ThemeService(), 'widget-instance'),
      element,
    ) as Konva.Group;
    stage.add(layer);
    layer.add(node);
    container.appendChild(widgetPortal);

    const removeListener = txAttachDomPortal({
      node,
      document,
      widgetServie: {} as WidgetManagerService,
      widgetPortal,
      cameraService,
      selectionService,
      widgetConfig: { id: 'neutral-runtime', renderDom },
    }, { element });
    cameraService.hooks.change.call();
    expect(renderDom).not.toHaveBeenCalled();

    node.position({ x: 10, y: 20 });
    cameraService.hooks.change.call();
    expect(renderDom).toHaveBeenCalledOnce();

    node.position({ x: 5_000, y: 20 });
    cameraService.hooks.change.call();
    expect(cleanupRuntime).toHaveBeenCalledOnce();
    cameraService.hooks.change.call();
    expect(cleanupRuntime).toHaveBeenCalledOnce();

    removeListener?.();
    stage.destroy();
    widgetPortal.remove();
  });
});
