import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ThemeService } from "@vibecanvas/service-theme";
import Konva from "konva";
import { describe, expect, test } from "vitest";
import { ELEMENT_DATA_ATTR } from "../../../src/core/CONSTANTS";
import {
  WIDGET_HOST_BODY_ID,
  WIDGET_HOST_MIN_BODY_HEIGHT,
  WIDGET_HOST_MIN_HEIGHT,
  WIDGET_HOST_MIN_WIDTH,
} from "../../../src/services/widget/CONSTANTS";
import { fnCreateWidgetNode } from "../../../src/services/widget/fn.create-widget-node";
import { fnGetHostThemeColors } from "../../../src/services/widget/fn.get-host-theme-colors";
import { txResizeWidgetHost } from "../../../src/services/widget/tx.resize-widget-host";
import { ensureDom } from "../../test-setup";

function createWidgetElement(args?: {
  w?: number;
  h?: number;
}): TElement {
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
      w: args?.w ?? 160,
      h: args?.h ?? 120,
      expanded: true,
      window: "contained",
      payload: {},
    },
  };
}

describe("txResizeWidgetHost", () => {
  test("bakes Konva transform scale into widget dimensions and resets scale", () => {
    ensureDom();

    const node = fnCreateWidgetNode(Konva, fnGetHostThemeColors(new ThemeService()), createWidgetElement());
    expect(node).toBeInstanceOf(Konva.Group);
    const group = node as Konva.Group;
    group.scale({ x: 2, y: 1.5 });

    expect(txResizeWidgetHost({
      Group: Konva.Group,
      Rect: Konva.Rect,
    }, {
      node: group,
    })).toBe(true);

    const data = group.getAttr(ELEMENT_DATA_ATTR);
    expect(group.width()).toBe(320);
    expect(group.height()).toBe(180);
    expect(group.scaleX()).toBe(1);
    expect(group.scaleY()).toBe(1);
    expect(data).toMatchObject({
      w: 320,
      h: 180,
      expanded: true,
    });
  });

  test("keeps the opposite edge fixed when top-left resize crosses the minimum width", () => {
    ensureDom();

    const initialX = -2171.33453673711;
    const initialY = -1003.3797483203443;
    const initialWidth = 1504.400526341555;
    const initialHeight = 998.7729413663093;
    const initialRight = initialX + initialWidth;
    const initialBottom = initialY + initialHeight;

    const node = fnCreateWidgetNode(Konva, fnGetHostThemeColors(new ThemeService()), createWidgetElement({
      w: initialWidth,
      h: initialHeight,
    }));
    expect(node).toBeInstanceOf(Konva.Group);
    const group = node as Konva.Group;
    group.position({ x: initialX, y: initialY });
    group.setAttr("vcTransformBeforeElement", {
      ...createWidgetElement({
        w: initialWidth,
        h: initialHeight,
      }),
      x: initialX,
      y: initialY,
    });

    group.position({ x: -342.2084183215952, y: -987.84576773782 });
    group.scale({
      x: 0.01,
      y: 983.2467791430098 / initialHeight,
    });

    expect(txResizeWidgetHost({
      Group: Konva.Group,
      Rect: Konva.Rect,
    }, {
      node: group,
      anchors: ["top-left"],
    })).toBe(true);

    expect(group.width()).toBe(WIDGET_HOST_MIN_WIDTH);
    expect(group.x()).toBeCloseTo(initialRight - WIDGET_HOST_MIN_WIDTH);
    expect(group.y() + group.height()).toBeCloseTo(initialBottom);
  });

  test("clamps resized widget height so the body remains visible", () => {
    ensureDom();

    const node = fnCreateWidgetNode(Konva, fnGetHostThemeColors(new ThemeService()), createWidgetElement({
      w: 160,
      h: 120,
    }));
    expect(node).toBeInstanceOf(Konva.Group);
    const group = node as Konva.Group;
    group.scale({ x: 0.25, y: 0.2 });

    expect(txResizeWidgetHost({
      Group: Konva.Group,
      Rect: Konva.Rect,
    }, {
      node: group,
    })).toBe(true);

    const data = group.getAttr(ELEMENT_DATA_ATTR);
    const body = group.findOne(`#${WIDGET_HOST_BODY_ID}`) as Konva.Rect | undefined;
    expect(group.width()).toBe(WIDGET_HOST_MIN_WIDTH);
    expect(group.height()).toBe(WIDGET_HOST_MIN_HEIGHT);
    expect(data).toMatchObject({
      w: WIDGET_HOST_MIN_WIDTH,
      h: WIDGET_HOST_MIN_HEIGHT,
      expanded: true,
    });
    expect(body?.visible()).toBe(true);
    expect(body?.listening()).toBe(true);
    expect(body?.height()).toBe(WIDGET_HOST_MIN_BODY_HEIGHT);
  });
});
