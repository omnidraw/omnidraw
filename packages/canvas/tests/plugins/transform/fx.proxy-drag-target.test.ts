import Konva from "konva";
import { describe, expect, test } from "vitest";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ElementService } from "../../../src/services/element/ElementService";
import { SelectionService } from "../../../src/services/selection/SelectionService";
import { fxGetProxyDragTarget } from "../../../src/plugins/transform/fx.proxy-drag-target";

function createPenElement(id: string): TElement {
  return {
    id,
    x: 10,
    y: 20,
    rotation: 0,
    zIndex: "z00000000",
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    data: {
      type: "pen",
      points: [[0, 0], [40, 20]],
      pressures: [0.5, 0.5],
      simulatePressure: false,
    },
    style: {},
  };
}

function attachToStage<TNode extends Konva.Node>(node: TNode) {
  const drawHost = {
    batchDraw() {},
  };

  Object.defineProperty(node, "getStage", {
    configurable: true,
    value: () => drawHost as unknown as Konva.Stage,
  });
  Object.defineProperty(node, "getLayer", {
    configurable: true,
    value: () => drawHost as unknown as Konva.Layer,
  });

  return node;
}

describe("fxGetProxyDragTarget", () => {
  test("returns a selected shape1d node in select mode", () => {
    const element = new ElementService();
    const selection = new SelectionService();
    const node = attachToStage(new Konva.Line({ id: "line-1", points: [0, 0, 100, 0] }));
    node.setAttr("vcElementData", { type: "line", points: [[0, 0], [100, 0]], startBinding: null, endBinding: null, lineType: "straight" });

    selection.setSelection([node]);

    const result = fxGetProxyDragTarget({
      element,
      Konva,
    }, {
      selection,
    });

    expect(result).toBe(node);
  });

  test("returns a selected pen path when registry serializes it as pen", () => {
    const element = new ElementService();
    const selection = new SelectionService();
    const node = attachToStage(new Konva.Path({ id: "pen-1", data: "M0 0 L10 10" }));

    element.registerElement({
      id: "pen",
      matchesNode: (candidate) => candidate.id() === node.id(),
      toElement: (candidate) => createPenElement(candidate.id()),
    });

    selection.setSelection([node]);

    const result = fxGetProxyDragTarget({
      element,
      Konva,
    }, {
      selection,
    });

    expect(result).toBe(node);
  });

  test("returns null for non-select mode or filtered multi-selection", () => {
    const element = new ElementService();
    const selection = new SelectionService();
    const nodeA = attachToStage(new Konva.Rect({ id: "a" }));
    const nodeB = attachToStage(new Konva.Rect({ id: "b" }));

    selection.mode = "draw_create" as typeof selection.mode;
    selection.setSelection([nodeA]);
    expect(fxGetProxyDragTarget({ element, Konva }, { selection })).toBeNull();

    selection.mode = "select" as typeof selection.mode;
    selection.setSelection([nodeA, nodeB]);
    expect(fxGetProxyDragTarget({ element, Konva }, { selection })).toBeNull();
  });
});
