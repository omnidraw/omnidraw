import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ThemeService } from "@vibecanvas/service-theme";
import { SyncExitHook, SyncHook } from "@vibecanvas/tapable";
import Konva from "konva";
import { describe, expect, test } from "vitest";
import { VC_NODE_KIND_ATTR } from "../../../src/core/CONSTANTS";
import type { CameraService, CrdtService, ElementService, HistoryService, LoggingService, WidgetManagerService } from "../../../src/services";
import { SelectionService } from "../../../src/services/selection/SelectionService";
import { txSetupGroupNode } from "../../../src/services/group/tx.setup-group-node";
import { WIDGET_DOM_PORTAL_SYNC_ATTR, WIDGET_HOST_HEADER_HEIGHT } from "../../../src/services/widget/CONSTANTS";
import { fnCreateWidgetNode } from "../../../src/services/widget/fn.create-widget-node";
import { fnGetHostThemeColors } from "../../../src/services/widget/fn.get-host-theme-colors";
import { fnToWidgetElement } from "../../../src/services/widget/fn.to-widget-element";
import { txAttachDomPortal } from "../../../src/services/widget/tx.attach-dom-portal";
import { txUpdateWidgetNodeFromElement } from "../../../src/services/widget/tx.update-widget-node-from-element";
import type { IRuntimeHooks } from "../../../src/types";
import { createTestContainer, ensureDom } from "../../test-setup";

function createWidgetElement(): TElement {
  return {
    id: "grouped-widget-1",
    x: 10,
    y: 20,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    zIndex: "",
    parentGroupId: "group-1",
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

function createCrdtService() {
  const builder = {
    patchElement: () => builder,
    commit: () => ({ redoOps: [], rollback: () => undefined }),
  };

  return {
    build: () => builder,
  } as unknown as CrdtService;
}

function firstPortalDiv(widgetPortal: HTMLDivElement) {
  const div = widgetPortal.querySelector<HTMLDivElement>("[data-widget-element-id='grouped-widget-1']");
  expect(div).not.toBeNull();
  return div as HTMLDivElement;
}

describe("grouped widget portal regression", () => {
  test("keeps the mounted widget body div synced when its containing group moves", () => {
    ensureDom();

    const element = createWidgetElement();
    const container = createTestContainer();
    const stage = new Konva.Stage({ container, width: 800, height: 600 });
    const layer = new Konva.Layer();
    const parentGroup = new Konva.Group({ id: "group-1", x: 100, y: 50, draggable: true });
    parentGroup.setAttr(VC_NODE_KIND_ATTR, "group");
    const widgetPortal = document.createElement("div");
    const cameraService = createCameraService();
    const selectionService = new SelectionService();
    const widgetNode = fnCreateWidgetNode(Konva, fnGetHostThemeColors(new ThemeService()), element);
    const patchedElements: TElement[][] = [];

    expect(widgetNode).toBeInstanceOf(Konva.Group);

    stage.add(layer);
    layer.add(parentGroup);
    parentGroup.add(widgetNode as Konva.Group);
    container.appendChild(widgetPortal);

    const removeListener = txAttachDomPortal({
      node: widgetNode,
      document,
      widgetServie: {} as WidgetManagerService,
      widgetPortal,
      cameraService,
      selectionService,
    }, { element });
    if (removeListener) {
      (widgetNode as Konva.Group).setAttr(WIDGET_DOM_PORTAL_SYNC_ATTR, removeListener.syncDiv);
    }

    txSetupGroupNode({
      crdt: createCrdtService(),
      element: {
        toElement: (node: Konva.Node) => node === widgetNode ? fnToWidgetElement(node) : null,
      } as ElementService,
      history: {} as HistoryService,
      logging: { isEnabled: () => false } as unknown as LoggingService,
      selection: selectionService,
      hooks: createHooks(),
      Shape: Konva.Shape,
      refreshBoundaries: () => undefined,
      startCloneDrag: () => undefined,
      createThrottledPatch: (callback) => {
        return (elements) => {
          patchedElements.push(elements.map((candidate) => structuredClone(candidate)));
          callback(elements);
        };
      },
      now: () => 1,
    }, { group: parentGroup });

    cameraService.hooks.change.call();
    const div = firstPortalDiv(widgetPortal);
    expect(div.style.transform).toBe(`matrix(1,0,0,1,110,${70 + WIDGET_HOST_HEADER_HEIGHT})`);

    parentGroup.position({ x: 130, y: 80 });
    parentGroup.fire("dragmove");

    expect(div.style.transform).toBe(`matrix(1,0,0,1,140,${100 + WIDGET_HOST_HEADER_HEIGHT})`);
    expect(patchedElements.at(-1)?.map((candidate) => candidate.id)).toEqual(["grouped-widget-1"]);

    removeListener?.();
    stage.destroy();
    widgetPortal.remove();
  });

  test("serializes a grouped widget with parent transform baked into world geometry", () => {
    ensureDom();

    const element = createWidgetElement();
    const container = createTestContainer();
    const stage = new Konva.Stage({ container, width: 800, height: 600 });
    const layer = new Konva.Layer();
    const parentGroup = new Konva.Group({ id: "group-1", x: 100, y: 50, scaleX: 2, scaleY: 2 });
    parentGroup.setAttr(VC_NODE_KIND_ATTR, "group");
    const widgetNode = fnCreateWidgetNode(Konva, fnGetHostThemeColors(new ThemeService()), element);

    expect(widgetNode).toBeInstanceOf(Konva.Group);

    stage.add(layer);
    layer.add(parentGroup);
    parentGroup.add(widgetNode as Konva.Group);

    const serialized = fnToWidgetElement(widgetNode);

    expect(serialized).toMatchObject({
      id: "grouped-widget-1",
      x: 120,
      y: 90,
      parentGroupId: "group-1",
      data: {
        type: "widget",
        w: 320,
        h: 240,
      },
    });

    stage.destroy();
  });

  test("replays grouped widget geometry and syncs its mounted body div", () => {
    ensureDom();

    const element = createWidgetElement();
    const container = createTestContainer();
    const stage = new Konva.Stage({ container, width: 800, height: 600 });
    const layer = new Konva.Layer();
    const parentGroup = new Konva.Group({ id: "group-1", x: 100, y: 50 });
    parentGroup.setAttr(VC_NODE_KIND_ATTR, "group");
    const widgetPortal = document.createElement("div");
    const cameraService = createCameraService();
    const selectionService = new SelectionService();
    const widgetNode = fnCreateWidgetNode(Konva, fnGetHostThemeColors(new ThemeService()), element);

    expect(widgetNode).toBeInstanceOf(Konva.Group);
    const widgetGroup = widgetNode as Konva.Group;
    if (element.data.type !== "widget") {
      throw new Error("expected widget test element");
    }

    stage.add(layer);
    layer.add(parentGroup);
    parentGroup.add(widgetGroup);
    container.appendChild(widgetPortal);

    const removeListener = txAttachDomPortal({
      node: widgetGroup,
      document,
      widgetServie: {} as WidgetManagerService,
      widgetPortal,
      cameraService,
      selectionService,
    }, { element });
    if (removeListener) {
      widgetGroup.setAttr(WIDGET_DOM_PORTAL_SYNC_ATTR, removeListener.syncDiv);
    }

    expect(txUpdateWidgetNodeFromElement({
      Group: Konva.Group,
      Rect: Konva.Rect,
    }, {
      node: widgetGroup,
      element: {
        ...element,
        x: 140,
        y: 100,
        data: {
          ...element.data,
          w: 240,
          h: 180,
        },
      },
    })).toBe(true);

    const div = firstPortalDiv(widgetPortal);
    expect(widgetGroup.position()).toEqual({ x: 40, y: 50 });
    expect(widgetGroup.width()).toBe(240);
    expect(widgetGroup.height()).toBe(180);
    expect(div.style.width).toBe("240px");
    expect(div.style.height).toBe(`${180 - WIDGET_HOST_HEADER_HEIGHT}px`);
    expect(div.style.transform).toBe(`matrix(1,0,0,1,140,${100 + WIDGET_HOST_HEADER_HEIGHT})`);

    removeListener?.();
    stage.destroy();
    widgetPortal.remove();
  });
});
