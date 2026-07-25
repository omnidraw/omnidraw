import type { TCanvasDoc, TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { describe, expect, it } from "vitest";
import { fnCreateShape2dElement } from "../../../src/core/fn.shape2d";
import { fnPlanProductSubtreeClone } from "../../../src/plugins/transform/fn.clone-plan";

function element(id: string, parentGroupId: string, targetId?: string) {
  const value = fnCreateShape2dElement({
    id,
    type: "rect",
    x: 0,
    y: 0,
    rotation: 0,
    width: 10,
    height: 10,
    createdAt: 1,
    updatedAt: 1,
    parentGroupId,
    zIndex: id,
  });
  value.bindings = targetId === undefined ? [] : [{
    targetId,
    anchor: { x: 0.5, y: 0.5 },
  }];
  return value;
}

describe("product subtree clone planning", () => {
  it("remaps nested parents, bindings, and selected roots without renderer state", () => {
    const source = {
      id: "canvas",
      name: "Canvas",
      groups: {
        root: {
          id: "root",
          parentGroupId: null,
          zIndex: "a",
          locked: false,
          createdAt: 1,
        },
        nested: {
          id: "nested",
          parentGroupId: "root",
          zIndex: "b",
          locked: false,
          createdAt: 1,
        },
      },
      elements: {
        first: element("first", "root", "second"),
        second: element("second", "nested"),
      },
    } satisfies TCanvasDoc;
    let id = 0;
    const plan = fnPlanProductSubtreeClone({
      document: source,
      targets: [
        { kind: "group", id: "root" },
        { kind: "element", id: "second" },
      ],
      createId: () => `clone-${++id}`,
      now: 9,
    });

    expect(plan.selection).toEqual([{ kind: "group", id: "clone-1" }]);
    expect(plan.groups.map(({ clone }) => ({
      id: clone.id,
      parentGroupId: clone.parentGroupId,
    }))).toEqual([
      { id: "clone-1", parentGroupId: null },
      { id: "clone-2", parentGroupId: "clone-1" },
    ]);
    const clonedSecond = plan.elements.find(({ sourceId }) => {
      return sourceId === "second";
    })!.clone;
    const clonedFirst = plan.elements.find(({ sourceId }) => {
      return sourceId === "first";
    })!.clone;
    expect(clonedSecond.parentGroupId).toBe("clone-2");
    expect(clonedFirst.parentGroupId).toBe("clone-1");
    expect(clonedFirst.bindings[0]?.targetId).toBe(clonedSecond.id);
    expect(source.elements.first.bindings[0]?.targetId).toBe("second");
  });

  it("leaves widget runtime identity changes to registered clone policy", () => {
    const widget = {
      ...element("widget", "root"),
      data: {
        type: "widget-instance",
        w: 100,
        h: 80,
        definitionId: "11111111-1111-4111-8111-111111111111",
        revisionId: "22222222-2222-4222-8222-222222222222",
        instanceId: "instance-old",
        stateDocumentId: "state-old",
        expanded: true,
      },
    } as TElement;
    const document = {
      id: "canvas",
      name: "Canvas",
      groups: {
        root: {
          id: "root",
          parentGroupId: null,
          zIndex: "a",
          locked: false,
          createdAt: 1,
        },
      },
      elements: { widget },
    } satisfies TCanvasDoc;
    let id = 0;
    const clone = fnPlanProductSubtreeClone({
      document,
      targets: [{ kind: "element", id: "widget" }],
      createId: () => `new-${++id}`,
      now: 2,
    }).elements[0]!.clone;

    expect(clone.data).toMatchObject({
      type: "widget-instance",
      instanceId: "instance-old",
      stateDocumentId: "state-old",
    });
  });
});
