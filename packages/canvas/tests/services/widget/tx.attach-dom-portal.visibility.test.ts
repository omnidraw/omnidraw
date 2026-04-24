import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ThemeService } from "@vibecanvas/service-theme";
import { SyncHook } from "@vibecanvas/tapable";
import Konva from "konva";
import { describe, expect, test } from "vitest";
import type { CameraService, WidgetManagerService } from "../../../src/services";
import { ELEMENT_DATA_ATTR } from "../../../src/core/CONSTANTS";
import { fnCreateWidgetNode } from "../../../src/services/widget/fn.create-widget-node";
import { fnGetHostThemeColors } from "../../../src/services/widget/fn.get-host-theme-colors";
import { txAttachDomPortal } from "../../../src/services/widget/tx.attach-dom-portal";
import { createTestContainer, ensureDom } from "../../test-setup";

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
      type: "widget",
      kind: "example",
      w: 160,
      h: 120,
      expanded,
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
