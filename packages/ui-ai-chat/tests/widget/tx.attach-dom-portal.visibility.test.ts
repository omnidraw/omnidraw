import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ThemeService } from "@vibecanvas/service-theme";
import { SyncHook } from "@vibecanvas/tapable";
import Konva from "konva";
import { describe, expect, test } from "vitest";
import type { CameraService } from "@vibecanvas/canvas/services";
import { ELEMENT_DATA_ATTR } from "@vibecanvas/canvas/core/CONSTANTS";
import type { WidgetManagerService } from "../../src/widget/WidgetManagerService";
import { fnCreateWidgetNode } from "../../src/widget/fn.create-widget-node";
import { fnGetHostThemeColors } from "../../src/widget/fn.get-host-theme-colors";
import { txAttachDomPortal as txAttachDomPortalWithBrowser } from "../../src/widget/attach-dom-portal";
import { createTestContainer, createTestWidgetBrowser, ensureDom } from "../test-setup";

const txAttachDomPortal = (portal: Omit<Parameters<typeof txAttachDomPortalWithBrowser>[0], "browser">, args: Parameters<typeof txAttachDomPortalWithBrowser>[1]) => (
  txAttachDomPortalWithBrowser({ ...portal, browser: createTestWidgetBrowser() }, args)
);

function createWidgetElement(expanded: boolean): TElement {
  return {
    id: "widget-visibility-1",
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
      definitionId: "00000000-0000-4000-8000-000000000001",
      revisionId: "00000000-0000-4000-8000-000000000002",
      instanceId: "00000000-0000-4000-8000-000000000003",
      w: 160,
      h: 120,
      expanded,
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

describe("txAttachDomPortal visibility", () => {
  test("keeps collapsed widget body div mounted but hidden", () => {
    ensureDom();

    const element = createWidgetElement(false);
    const container = createTestContainer();
    const stage = new Konva.Stage({ container, width: 800, height: 600 });
    const layer = new Konva.Layer();
    const widgetPortal = document.createElement("div");
    const node = fnCreateWidgetNode(Konva, fnGetHostThemeColors(new ThemeService()), element);
    const cameraService = createCameraService();

    expect(node).toBeInstanceOf(Konva.Group);
    stage.add(layer);
    layer.add(node as Konva.Group);
    container.appendChild(widgetPortal);
    (node as Konva.Group).setAttr(ELEMENT_DATA_ATTR, element.data);

    const removeListener = txAttachDomPortal({
      node,
      document,
      widgetServie: {} as WidgetManagerService,
      widgetPortal,
      cameraService,
    }, { element });

    cameraService.hooks.change.call();

    const div = widgetPortal.querySelector<HTMLDivElement>("[data-widget-element-id='widget-visibility-1']");
    expect(div).not.toBeNull();
    expect(div?.style.display).toBe("none");

    removeListener?.();
    stage.destroy();
    widgetPortal.remove();
  });
});
