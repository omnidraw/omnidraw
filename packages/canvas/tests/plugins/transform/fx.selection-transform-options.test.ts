import Konva from "konva";
import { describe, expect, test } from "vitest";
import type { TElement, TGroup } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ElementService } from "../../../src/services/element/ElementService";
import { fxGetSelectionTransformOptions } from "../../../src/plugins/transform/fx.selection-transform-options";

function createTextElement(id: string): TElement {
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
      type: "text",
      w: 120,
      h: 40,
      text: "hello",
      originalText: "hello",
      fontFamily: "Arial",
      link: null,
      containerId: null,
      autoResize: false,
    },
    style: {},
  };
}

function createGroup(id: string): TGroup {
  return {
    id,
    parentGroupId: null,
    zIndex: "z00000000",
    locked: false,
    createdAt: 1,
  };
}

describe("fxGetSelectionTransformOptions", () => {
  test("uses corner-only anchors for multi-selection", () => {
    const element = new ElementService();
    const nodeA = new Konva.Rect({ id: "a" });
    const nodeB = new Konva.Rect({ id: "b" });

    element.registerElement({
      id: "rect",
      matchesNode: (candidate) => candidate.id() === nodeA.id() || candidate.id() === nodeB.id(),
      toElement: (candidate) => createTextElement(candidate.id()),
    });

    const result = fxGetSelectionTransformOptions({
      Konva,
      element,
    }, {
      selection: [nodeA, nodeB],
    });

    expect(result).toEqual({
      borderEnabled: true,
      borderDash: [2, 2],
      enabledAnchors: ["top-left", "top-right", "bottom-left", "bottom-right"],
      keepRatio: true,
      flipEnabled: true,
    });
  });

  test("applies single-selection registry overrides", () => {
    const element = new ElementService();
    const node = new Konva.Rect({ id: "shape-1" });

    element.registerElement({
      id: "rect",
      matchesNode: (candidate) => candidate.id() === node.id(),
      toElement: (candidate) => createTextElement(candidate.id()),
      getTransformOptions: () => ({
        enabledAnchors: ["middle-left", "middle-right"],
        keepRatio: false,
        flipEnabled: false,
      }),
    });

    const result = fxGetSelectionTransformOptions({
      Konva,
      element,
    }, {
      selection: [node],
    });

    expect(result).toEqual({
      borderEnabled: true,
      borderDash: [0, 0],
      enabledAnchors: ["middle-left", "middle-right"],
      keepRatio: false,
      flipEnabled: false,
    });
  });

});
