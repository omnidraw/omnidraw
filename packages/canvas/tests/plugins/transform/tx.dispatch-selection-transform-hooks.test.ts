import Konva from "konva";
import { describe, expect, test, vi } from "vitest";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ElementService } from "../../../src/services/element/ElementService";
import { txDispatchSelectionTransformHooks } from "../../../src/plugins/transform/tx.dispatch-selection-transform-hooks";

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

describe("txDispatchSelectionTransformHooks", () => {
  test("merges hook results across matching definitions and tracks handled nodes", () => {
    const element = new ElementService();
    const node = new Konva.Rect({ id: "shape-1" });
    const calls: string[] = [];

    element.registerElement({
      id: "base",
      priority: 10,
      matchesNode: (candidate) => candidate.id() === node.id(),
      toElement: (candidate) => createTextElement(candidate.id()),
      onResize: (args) => {
        calls.push(`base:${args.node.id()}:${args.element.id}`);
        return { cancel: false, crdt: true };
      },
    });
    element.registerElement({
      id: "override",
      priority: 20,
      matchesNode: (candidate) => candidate.id() === node.id(),
      onResize: (args) => {
        calls.push(`override:${args.node.id()}:${args.element.id}`);
        return { cancel: true, crdt: false };
      },
    });

    const result = txDispatchSelectionTransformHooks({
      element,
    }, {
      selection: [node],
      createArgs: (selectedNode, currentElement) => ({
        node: selectedNode,
        element: currentElement,
        selection: [selectedNode],
      }),
      getHook: (definition) => definition.onResize,
    });

    expect(calls).toEqual(["base:shape-1:shape-1", "override:shape-1:shape-1"]);
    expect(result.cancel).toBe(true);
    expect(result.crdt).toBe(true);
    expect(result.handledNodeIds.has(node.id())).toBe(true);
  });

  test("skips nodes that cannot serialize to elements", () => {
    const element = new ElementService();
    const node = new Konva.Rect({ id: "missing" });
    const hookSpy = vi.fn();

    element.registerElement({
      id: "noop",
      matchesNode: () => false,
      onResize: hookSpy,
    });

    const result = txDispatchSelectionTransformHooks({
      element,
    }, {
      selection: [node],
      createArgs: (selectedNode, currentElement) => ({
        node: selectedNode,
        element: currentElement,
        selection: [selectedNode],
      }),
      getHook: (definition) => definition.onResize,
    });

    expect(hookSpy).not.toHaveBeenCalled();
    expect(result).toEqual({
      cancel: false,
      crdt: false,
      handledNodeIds: new Set(),
    });
  });
});
