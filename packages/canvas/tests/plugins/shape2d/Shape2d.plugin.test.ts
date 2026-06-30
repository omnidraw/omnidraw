import Konva from "konva";
import { JSDOM } from "jsdom";
import { describe, expect, test, vi } from "vitest";
import { fxToShape2dElement } from "../../../src/plugins/shape2d/fx.to-element";
import { txUpdateShape2dNodeFromElement } from "../../../src/plugins/shape2d/tx.update-node-from-element";

function ensureDom() {
  if (typeof document !== "undefined") {
    return;
  }

  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  vi.stubGlobal?.("window", dom.window);
  vi.stubGlobal?.("document", dom.window.document);
  if (typeof window === "undefined") {
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
    });
  }
}

function createRectElement() {
  return {
    id: "rect-1",
    x: 100,
    y: 150,
    rotation: 15,
    bindings: [],
    createdAt: 11,
    updatedAt: 22,
    locked: false,
    parentGroupId: null,
    zIndex: "z0001",
    style: {
      backgroundColor: "#112233",
      strokeColor: "#445566",
      strokeWidth: "@stroke-width/medium",
      opacity: 0.35,
    },
    data: {
      type: "rect" as const,
      w: 120,
      h: 80,
    },
  };
}

function createEllipseElement() {
  return {
    id: "ellipse-1",
    x: 40,
    y: 60,
    rotation: 25,
    bindings: [],
    createdAt: 7,
    updatedAt: 8,
    locked: false,
    parentGroupId: null,
    zIndex: "z0002",
    style: {
      backgroundColor: "#abcdef",
      strokeColor: "#123456",
      strokeWidth: "2",
      opacity: 0.8,
    },
    data: {
      type: "ellipse" as const,
      rx: 30,
      ry: 20,
    },
  };
}

describe("shape2d runtime helpers", () => {
  test("txUpdateShape2dNodeFromElement applies rect geometry and style metadata", () => {
    ensureDom();
    const node = new Konva.Rect({ id: "rect-1" });
    const element = createRectElement();

    const didUpdate = txUpdateShape2dNodeFromElement({
      Rect: Konva.Rect,
      Line: Konva.Line,
      Ellipse: Konva.Ellipse,
      render: {} as never,
      theme: {
        resolveThemeColor: (value: string | undefined) => value,
        resolveStrokeWidth: (value: string | undefined, fallback: number) => typeof value === "string" ? Number.parseFloat(value) || (value === "@stroke-width/medium" ? 4 : fallback) : fallback,
        resolveStrokeDash: () => [],
        resolveCornerRadius: (_value: string | undefined, fallback: number) => fallback,
      } as never,
      setNodeZIndex: (candidate, zIndex) => candidate.setAttr("vcZIndex", zIndex),
    }, {
      node,
      element,
    });

    expect(didUpdate).toBe(true);
    expect(node.x()).toBe(100);
    expect(node.y()).toBe(150);
    expect(node.rotation()).toBe(15);
    expect(node.width()).toBe(120);
    expect(node.height()).toBe(80);
    expect(node.fill()).toBe("#112233");
    expect(node.stroke()).toBe("#445566");
    expect(node.strokeWidth()).toBe(4);
    expect(node.opacity()).toBe(0.35);
    expect(node.getAttr("vcShape2dType")).toBe("rect");
    expect(node.getAttr("vcElementCreatedAt")).toBe(11);
    expect(node.getAttr("vcZIndex")).toBe("z0001");
  });

  test("fxToShape2dElement serializes ellipse runtime node back into persisted element", () => {
    ensureDom();
    const node = new Konva.Ellipse({
      id: "ellipse-1",
      x: 70,
      y: 80,
      rotation: 25,
      radiusX: 30,
      radiusY: 20,
      opacity: 0.8,
      fill: "#abcdef",
      stroke: "#123456",
      strokeWidth: "2",
    });
    node.setAttr("vcShape2dType", "ellipse");
    node.setAttr("vcElementCreatedAt", 7);
    node.setAttr("vcElementStyle", {
      backgroundColor: "#abcdef",
      strokeColor: "#123456",
      strokeWidth: 2,
      opacity: 0.8,
    });
    node.setAttr("vcZIndex", "z0002");

    const element = fxToShape2dElement({
      Rect: Konva.Rect,
      Line: Konva.Line,
      Ellipse: Konva.Ellipse,
      canvasRegistry: { toGroup: () => null },
      render: {} as never,
      now: () => 99,
    }, {
      node,
    });

    expect(element).toBeTruthy();
    expect(element?.id).toBe("ellipse-1");
    expect(element?.x).toBeCloseTo(40, 0);
    expect(element?.y).toBeCloseTo(60, 0);
    expect(element?.rotation).toBeCloseTo(25, 5);
    expect(element?.createdAt).toBe(7);
    expect(element?.updatedAt).toBe(99);
    expect(element?.style.backgroundColor).toBe("#abcdef");
    expect(element?.style.strokeColor).toBe("#123456");
    expect(element?.style.strokeWidth).toBe(2);
    expect(element?.style.opacity).toBe(0.8);
    if (element?.data.type === "ellipse") {
      expect(element.data.rx).toBeCloseTo(30, 0);
      expect(element.data.ry).toBeCloseTo(20, 0);
    }
  });

  test("fxToShape2dElement preserves rect style metadata instead of raw node colors when present", () => {
    ensureDom();
    const node = new Konva.Rect({
      id: "rect-2",
      x: 10,
      y: 20,
      width: 50,
      height: 40,
      fill: "#000000",
      stroke: "#ffffff",
      strokeWidth: 9,
      opacity: 0.5,
    });
    node.setAttr("vcShape2dType", "rect");
    node.setAttr("vcElementCreatedAt", 1);
    node.setAttr("vcElementStyle", {
      backgroundColor: "@red/500",
      strokeColor: "@blue/500",
      strokeWidth: 9,
      opacity: 0.5,
    });

    const element = fxToShape2dElement({
      Rect: Konva.Rect,
      Line: Konva.Line,
      Ellipse: Konva.Ellipse,
      canvasRegistry: { toGroup: () => null },
      render: {} as never,
      now: () => 2,
    }, {
      node,
    });

    expect(element?.style.backgroundColor).toBe("@red/500");
    expect(element?.style.strokeColor).toBe("@blue/500");
    expect(element?.style.strokeWidth).toBe(9);
    expect(element?.style.opacity).toBe(0.5);
  });

  test("fxToShape2dElement keeps inline text payload on the host element", () => {
    ensureDom();
    const node = new Konva.Rect({
      id: "rect-inline-1",
      x: 12,
      y: 18,
      width: 160,
      height: 90,
      opacity: 1,
    });
    node.setAttr("vcShape2dType", "rect");
    node.setAttr("vcElementCreatedAt", 5);
    node.setAttr("vcElementStyle", {
      strokeColor: "@base/900",
      fontSize: "@text/m",
      textAlign: "center",
      verticalAlign: "middle",
      opacity: 1,
    });
    node.setAttr("vcShapeTextData", {
      type: "text",
      w: 10,
      h: 10,
      text: "Inline",
      originalText: "Inline",
      fontFamily: "Arial",
      link: null,
      containerId: null,
      autoResize: false,
    });

    const element = fxToShape2dElement({
      Rect: Konva.Rect,
      Line: Konva.Line,
      Ellipse: Konva.Ellipse,
      canvasRegistry: { toGroup: () => null },
      render: {} as never,
      now: () => 6,
    }, {
      node,
    });

    expect(element?.data.type).toBe("rect");
    if (element?.data.type === "rect") {
      expect(element.data.text?.text).toBe("Inline");
      expect(element.data.text?.w).toBe(160);
      expect(element.data.text?.h).toBe(90);
    }
  });
});
