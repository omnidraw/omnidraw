import Konva from "konva";
import { describe, expect, test, vi } from "vitest";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { txSyncTransformer } from "../../../src/plugins/transform/tx.sync-transformer";
import { ElementService } from "../../../src/services/element/ElementService";
import { SelectionService } from "../../../src/services/selection/SelectionService";
import { SessionService } from "../../../src/services/session/SessionService";

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

function attachToStage<TNode extends Konva.Node>(node: TNode) {
  Object.defineProperty(node, "getStage", {
    configurable: true,
    value: () => ({}) as Konva.Stage,
  });
  return node;
}

function createTransformerMock() {
  let nodes: Konva.Node[] = [];
  let borderEnabled = true;
  let borderDash: number[] = [];
  let keepRatio = false;
  let flipEnabled = true;
  let enabledAnchors: string[] = [];

  return {
    setNodes: vi.fn((nextNodes: Konva.Node[]) => {
      nodes = nextNodes;
    }),
    update: vi.fn(),
    borderEnabled: vi.fn((next?: boolean) => {
      if (typeof next === "boolean") borderEnabled = next;
      return borderEnabled;
    }),
    borderDash: vi.fn((next?: number[]) => {
      if (next) borderDash = next;
      return borderDash;
    }),
    keepRatio: vi.fn((next?: boolean) => {
      if (typeof next === "boolean") keepRatio = next;
      return keepRatio;
    }),
    flipEnabled: vi.fn((next?: boolean) => {
      if (typeof next === "boolean") flipEnabled = next;
      return flipEnabled;
    }),
    enabledAnchors: vi.fn((next?: string[]) => {
      if (next) enabledAnchors = next;
      return enabledAnchors;
    }),
    nodes: () => nodes,
  };
}

describe("txSyncTransformer", () => {
  test("clears transformer nodes while editing is active", () => {
    const batchDrawSpy = vi.fn();
    const transformer = createTransformerMock();
    const session = new SessionService();
    session.editingId = "text-1";

    txSyncTransformer({
      element: new ElementService(),
      session,
      Konva,
      scene: {
        dynamicLayer: { batchDraw: batchDrawSpy },
      } as never,
      selection: new SelectionService(),
      transformer: transformer as never,
    }, {});

    expect(transformer.setNodes).toHaveBeenCalledWith([]);
    expect(transformer.update).toHaveBeenCalled();
    expect(batchDrawSpy).toHaveBeenCalled();
  });

  test("syncs filtered nodes and transform options onto transformer", () => {
    const element = new ElementService();
    const selection = new SelectionService();
    const session = new SessionService();
    const transformer = createTransformerMock();
    const batchDrawSpy = vi.fn();
    const nodeA = attachToStage(new Konva.Rect({ id: "a" }));
    const nodeB = attachToStage(new Konva.Rect({ id: "b" }));

    element.registerElement({
      id: "rect",
      matchesNode: (candidate) => candidate.id() === nodeA.id() || candidate.id() === nodeB.id(),
      toElement: (candidate) => createTextElement(candidate.id()),
    });

    selection.setSelection([nodeA, nodeB]);

    txSyncTransformer({
      element,
      session,
      Konva,
      scene: {
        dynamicLayer: { batchDraw: batchDrawSpy },
      } as never,
      selection,
      transformer: transformer as never,
    }, {});

    expect(transformer.nodes()).toEqual([nodeA, nodeB]);
    expect(transformer.borderDash()).toEqual([2, 2]);
    expect(transformer.keepRatio()).toBe(true);
    expect(transformer.enabledAnchors()).toEqual(["top-left", "top-right", "bottom-left", "bottom-right"]);
    expect(batchDrawSpy).toHaveBeenCalled();
  });
});
