import type {
  TCanvasDoc,
  TElement,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { describe, expect, it } from "vitest";
import {
  fnPersistElementThroughGroupTransform,
  fnRootProductTransformProposals,
  fnRootProductTransformTargets,
} from "../../../src/plugins/transform/fn.group-transform";
import type { TCanvasProductTransformProposal } from "../../../src/engine/product-runtime/typed";

const IDENTITY = {
  position: { x: 0, y: 0 },
  rotationRadians: 0,
  scale: { x: 1, y: 1 },
  skew: { x: 0, y: 0 },
  origin: { x: 0, y: 0 },
};

function element(id: string, parentGroupId: string | null): TElement {
  return {
    id,
    x: 20,
    y: 10,
    rotation: 15,
    scaleX: 2,
    scaleY: 3,
    parentGroupId,
    zIndex: id,
    locked: false,
    bindings: [],
    createdAt: 1,
    updatedAt: 1,
    style: {},
    data: { type: "rect", w: 40, h: 20 },
  };
}

function groupProposal(
  id = "root",
): TCanvasProductTransformProposal {
  return {
    target: { kind: "group", id },
    previousTransform: {
      ...IDENTITY,
      position: { x: 10, y: 10 },
      origin: { x: 10, y: 0 },
    },
    nextTransform: {
      ...IDENTITY,
      position: { x: 30, y: 40 },
      rotationRadians: Math.PI / 2,
      scale: { x: 2, y: 2 },
      origin: { x: 10, y: 0 },
    },
  };
}

describe("group transform persistence", () => {
  it("distributes group translation, uniform resize, and rotation to children", () => {
    const result = fnPersistElementThroughGroupTransform({
      element: element("child", "root"),
      proposal: groupProposal(),
      updatedAt: 9,
    });

    expect(result?.x).toBeCloseTo(40);
    expect(result?.y).toBeCloseTo(40);
    expect(result).toMatchObject({
      rotation: 105,
      scaleX: 4,
      scaleY: 6,
      updatedAt: 9,
      data: { type: "rect", w: 40, h: 20 },
    });
  });

  it("preserves optional default scale fields for group move and rotation", () => {
    const { scaleX: _scaleX, scaleY: _scaleY, ...unscaled } = element(
      "child",
      "root",
    );
    const result = fnPersistElementThroughGroupTransform({
      element: unscaled,
      proposal: {
        target: { kind: "group", id: "root" },
        previousTransform: IDENTITY,
        nextTransform: {
          ...IDENTITY,
          position: { x: 5, y: 7 },
          rotationRadians: Math.PI / 4,
        },
      },
      updatedAt: 3,
    });

    expect(result).not.toHaveProperty("scaleX");
    expect(result).not.toHaveProperty("scaleY");
    expect(result?.rotation).toBeCloseTo(60);
  });

  it("drops descendant proposals when an ancestor group is selected", () => {
    const child = element("child", "nested");
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
        nested: {
          id: "nested",
          parentGroupId: "root",
          zIndex: "b",
          locked: false,
          createdAt: 1,
        },
      },
      elements: { child },
    } satisfies TCanvasDoc;
    const proposals = fnRootProductTransformProposals({
      document,
      proposals: [
        groupProposal("root"),
        groupProposal("nested"),
        {
          ...groupProposal(),
          target: { kind: "element", id: "child" },
        },
      ],
    });

    expect(proposals.map((proposal) => proposal.target)).toEqual([
      { kind: "group", id: "root" },
    ]);
    expect(fnRootProductTransformTargets({
      document,
      targets: [
        { kind: "group", id: "root" },
        { kind: "element", id: "child" },
        { kind: "group", id: "root" },
      ],
    })).toEqual([{ kind: "group", id: "root" }]);
  });
});
