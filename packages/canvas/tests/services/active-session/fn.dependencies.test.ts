import { describe, expect, it } from "vitest";
import { fnCanvasActiveSessionDependencies } from "../../../src/services/active-session/fn.dependencies";
import {
  createCanvasDoc,
  createElement,
  createGroup,
} from "../crdt/helpers";

describe("fnCanvasActiveSessionDependencies", () => {
  it("collects selected group subtrees and their ancestors with exact fields", () => {
    const document = createCanvasDoc({
      groups: {
        outer: createGroup("outer"),
        selected: createGroup("selected", { parentGroupId: "outer" }),
        nested: createGroup("nested", { parentGroupId: "selected" }),
        unrelated: createGroup("unrelated"),
      },
      elements: {
        direct: createElement("direct", { parentGroupId: "selected" }),
        nested: createElement("nested", { parentGroupId: "nested" }),
        unrelated: createElement("unrelated", {
          parentGroupId: "unrelated",
        }),
      },
    });

    expect(fnCanvasActiveSessionDependencies({
      document,
      targets: [
        { kind: "group", id: "nested" },
        { kind: "group", id: "selected" },
      ],
      elementFields: ["x", "y", "parentGroupId", "data"],
      groupFields: ["parentGroupId", "locked"],
      includeGroupDescendants: true,
    })).toEqual({
      elements: {
        direct: ["x", "y", "parentGroupId", "data"],
        nested: ["x", "y", "parentGroupId", "data"],
      },
      groups: {
        nested: ["parentGroupId", "locked"],
        outer: ["parentGroupId", "locked"],
        selected: ["parentGroupId", "locked"],
      },
    });
  });

  it("tracks an element and ancestor chain without unrelated style or order", () => {
    const document = createCanvasDoc({
      groups: {
        outer: createGroup("outer"),
        inner: createGroup("inner", { parentGroupId: "outer" }),
      },
      elements: {
        target: createElement("target", { parentGroupId: "inner" }),
      },
    });

    const dependencies = fnCanvasActiveSessionDependencies({
      document,
      targets: [{ kind: "element", id: "target" }],
      elementFields: ["x", "rotation", "data"],
      groupFields: ["parentGroupId"],
    });

    expect(dependencies).toEqual({
      elements: {
        target: ["x", "rotation", "data"],
      },
      groups: {
        inner: ["parentGroupId"],
        outer: ["parentGroupId"],
      },
    });
    expect(dependencies.elements.target).not.toContain("style");
    expect(dependencies.elements.target).not.toContain("zIndex");
  });
});
