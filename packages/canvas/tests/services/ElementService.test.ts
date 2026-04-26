import Konva from "konva";
import { describe, expect, test, vi } from "vitest";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ElementService } from "../../src/services/element/ElementService";

function createElement(args?: { id?: string; type?: "text" }) : TElement {
  return {
    id: args?.id ?? "element-1",
    x: 10,
    y: 20,
    rotation: 0,
    zIndex: "z00000000",
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 2,
    data: {
      type: args?.type ?? "text",
      w: 100,
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

describe("ElementService", () => {
  test("serializes nodes with base and modifier definitions in priority order", () => {
    const service = new ElementService();
    const node = new Konva.Rect({ id: "shape-1" });
    const calls: string[] = [];

    service.registerElement({
      id: "modifier",
      priority: 20,
      matchesNode: () => true,
      afterToElement: ({ element }) => {
        calls.push(`after:${element.id}`);
        return {
          ...element,
          updatedAt: 99,
        };
      },
    });
    service.registerElement({
      id: "base",
      priority: 10,
      matchesNode: () => true,
      toElement: (candidate) => {
        calls.push(`base:${candidate.id()}`);
        return createElement({ id: candidate.id(), type: "text" });
      },
    });
    service.registerElement({
      id: "base-after",
      priority: 15,
      matchesNode: () => true,
      afterToElement: ({ element }) => {
        calls.push(`base-after:${element.id}`);
      },
    });

    const element = service.toElement(node);

    expect(element).toMatchObject({
      id: "shape-1",
      updatedAt: 99,
      data: { type: "text" },
    });
    expect(calls).toEqual(["base:shape-1", "base-after:shape-1", "after:shape-1"]);
  });

  test("creates nodes, runs modifiers and listeners, and aggregates update results", () => {
    const service = new ElementService();
    const element = createElement({ id: "shape-2", type: "text" });
    const node = new Konva.Rect({ id: "shape-2" });
    const calls: string[] = [];

    service.registerElement({
      id: "modifier-a",
      priority: 15,
      matchesElement: () => true,
      matchesNode: (candidate) => candidate.id() === node.id(),
      afterCreateNode: ({ node: createdNode }) => {
        calls.push(`after-a:${createdNode.id()}`);
      },
      attachListeners: (candidate) => {
        calls.push(`listen-a:${candidate.id()}`);
        return false;
      },
      updateElement: () => {
        calls.push("update-a");
      },
    });
    service.registerElement({
      id: "base",
      priority: 10,
      matchesElement: () => true,
      matchesNode: (candidate) => candidate.id() === node.id(),
      createNode: (candidate) => {
        calls.push(`create:${candidate.id}`);
        return node;
      },
      attachListeners: (candidate) => {
        calls.push(`listen-base:${candidate.id()}`);
        return true;
      },
      updateElement: () => {
        calls.push("update-base");
        return true;
      },
    });
    service.registerElement({
      id: "base-after",
      priority: 12,
      matchesElement: () => true,
      afterCreateNode: ({ node: createdNode }) => {
        calls.push(`after-base:${createdNode.id()}`);
      },
    });

    expect(service.createNodeFromElement(element)).toBe(node);
    expect(calls).toEqual([
      "create:shape-2",
      "after-base:shape-2",
      "after-a:shape-2",
      "listen-base:shape-2",
      "listen-a:shape-2",
    ]);

    calls.length = 0;
    expect(service.attachListeners(node)).toBe(true);
    expect(calls).toEqual(["listen-base:shape-2", "listen-a:shape-2"]);

    calls.length = 0;
    expect(service.updateElement(element)).toBe(true);
    expect(calls).toEqual(["update-base", "update-a"]);
  });

  test("merges transform options across matching definitions", () => {
    const service = new ElementService();
    const node = new Konva.Rect({ id: "shape-3" });
    const element = createElement({ id: "shape-3", type: "text" });
    const selection = [node] as Array<Konva.Group | Konva.Shape>;
    const calls: string[] = [];

    service.registerElement({
      id: "base",
      priority: 10,
      matchesNode: (candidate) => candidate.id() === node.id(),
      toElement: () => element,
      getTransformOptions: ({ node: candidateNode, element: candidateElement, selection: candidateSelection }) => {
        calls.push(`options-base:${candidateNode.id()}:${candidateElement.id}:${candidateSelection.length}`);
        return {
          enabledAnchors: ["top-left", "bottom-right"],
          keepRatio: true,
        };
      },
    });

    service.registerElement({
      id: "modifier",
      priority: 20,
      matchesNode: (candidate) => candidate.id() === node.id(),
      getTransformOptions: ({ node: candidateNode }) => {
        calls.push(`options-modifier:${candidateNode.id()}`);
        return {
          flipEnabled: true,
          keepRatio: false,
        };
      },
    });

    expect(service.getTransformOptions({ node, selection })).toEqual({
      enabledAnchors: ["top-left", "bottom-right"],
      keepRatio: false,
      flipEnabled: true,
    });
    expect(calls).toEqual([
      "options-base:shape-3:shape-3:1",
      "options-modifier:shape-3",
    ]);
  });

  test("returns default transform results when node does not resolve to an element", () => {
    const service = new ElementService();
    const node = new Konva.Rect({ id: "unknown" });
    const selection = [node] as Array<Konva.Group | Konva.Shape>;

    expect(service.getTransformOptions({ node, selection })).toEqual({});
    expect(service.getMatchingElementDefinitionsByNode(node)).toEqual([]);
  });
});
