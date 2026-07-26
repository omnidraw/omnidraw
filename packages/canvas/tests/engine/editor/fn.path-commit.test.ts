import type { TConnectorNode } from "@omnidraw/cangine";
import {
  composeTransform2D,
  mat3TransformPoint,
} from "@omnidraw/cangine/geometry";
import { describe, expect, it } from "vitest";
import {
  fnCanvasElementFromPathCommit,
  fnCanvasPathReconciliationNode,
} from "../../../src/engine/editor/fn.path-commit";
import { createElement } from "../../services/crdt/helpers";

function connector(
  overrides: Partial<TConnectorNode> = {},
): TConnectorNode {
  return {
    id: "vc:element:u-line:render",
    parentId: "vc:element:u-line",
    orderKey: "A",
    kind: "connector",
    transform: {
      position: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
      skew: { x: 0, y: 0 },
      origin: { x: 0, y: 0 },
    },
    from: { type: "point", point: { x: 0, y: 0 } },
    to: { type: "point", point: { x: 100, y: 20 } },
    routing: { type: "straight" },
    stroke: {
      width: 2,
      paint: {
        type: "solid",
        color: { space: "srgb", r: 0, g: 0, b: 0, a: 1 },
      },
    },
    ...overrides,
  };
}

function line() {
  return createElement("line", {
    x: 10,
    y: 20,
    rotation: 90,
    scaleX: 2,
    scaleY: 3,
    data: {
      type: "line",
      lineType: "straight",
      points: [[0, 0], [100, 20]],
      startBinding: {
        targetId: "start",
        anchor: { x: 0.5, y: 0.5 },
      },
      endBinding: {
        targetId: "end",
        anchor: { x: 0.5, y: 0.5 },
      },
    },
  });
}

describe("path controller durable mapping", () => {
  it("round-trips endpoints and inserted waypoints without dropping bindings", () => {
    const next = fnCanvasElementFromPathCommit({
      element: line(),
      node: connector({
        from: { type: "point", point: { x: 5, y: 6 } },
        waypoints: [{ x: 40, y: 50 }, { x: 60, y: 55 }],
        to: { type: "point", point: { x: 90, y: 70 } },
        routing: { type: "bezier" },
      }),
      source: "cangine-editor:path-geometry",
      updatedAt: 10,
    });

    expect(next?.data).toMatchObject({
      lineType: "curved",
      points: [[5, 6], [40, 50], [60, 55], [90, 70]],
      startBinding: { targetId: "start" },
      endBinding: { targetId: "end" },
    });
  });

  it("bakes the full child affine into points without corrupting root scale", () => {
    const element = line();
    const childTransform = {
      position: { x: 4, y: 5 },
      rotation: Math.PI / 4,
      scale: { x: 1.25, y: 0.75 },
      skew: { x: 0.1, y: -0.2 },
      origin: { x: 20, y: 10 },
    };
    const next = fnCanvasElementFromPathCommit({
      element,
      node: connector({
        transform: childTransform,
      }),
      source: "cangine-editor:path-transform",
      updatedAt: 11,
    });

    expect(next).toMatchObject({
      x: 10,
      y: 20,
      rotation: 90,
      scaleX: 2,
      scaleY: 3,
      updatedAt: 11,
    });
    if (
      next === null
      || (next.data.type !== "line" && next.data.type !== "arrow")
    ) {
      throw new Error("Expected a transformed connector element.");
    }

    const childMatrix = composeTransform2D(childTransform);
    const expectedLocalEnd = mat3TransformPoint(
      childMatrix,
      { x: 100, y: 20 },
    );
    expect(next.data.points[1]?.[0]).toBeCloseTo(expectedLocalEnd.x);
    expect(next.data.points[1]?.[1]).toBeCloseTo(expectedLocalEnd.y);

    const rootMatrix = composeTransform2D({
      position: { x: element.x, y: element.y },
      rotation: element.rotation * Math.PI / 180,
      scale: {
        x: element.scaleX ?? 1,
        y: element.scaleY ?? 1,
      },
      skew: { x: 0, y: 0 },
      origin: { x: 0, y: 0 },
    });
    const previewWorldEnd = mat3TransformPoint(rootMatrix, expectedLocalEnd);
    const persistedWorldEnd = mat3TransformPoint(rootMatrix, {
      x: next.data.points[1]?.[0] ?? 0,
      y: next.data.points[1]?.[1] ?? 0,
    });
    expect(persistedWorldEnd.x).toBeCloseTo(previewWorldEnd.x);
    expect(persistedWorldEnd.y).toBeCloseTo(previewWorldEnd.y);
  });

  it("normalizes the controller child after a durable transform commit", () => {
    const node = connector({
      transform: {
        position: { x: 40, y: 25 },
        rotation: Math.PI / 4,
        scale: { x: 1, y: 1 },
        skew: { x: 0, y: 0 },
        origin: { x: 0, y: 0 },
      },
    });

    expect(fnCanvasPathReconciliationNode({
      node,
      source: "cangine-editor:path-transform",
    })?.transform).toEqual({
      position: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
      skew: { x: 0, y: 0 },
      origin: { x: 0, y: 0 },
    });
    expect(node.transform.position).toEqual({ x: 40, y: 25 });
    expect(fnCanvasPathReconciliationNode({
      node,
      source: "cangine-editor:path-geometry",
    })).toBeNull();
  });

  it("applies endpoint snap and rebinding overrides from the product adapter", () => {
    const next = fnCanvasElementFromPathCommit({
      element: line(),
      node: connector(),
      source: "cangine-editor:path-geometry",
      updatedAt: 12,
      startPoint: [8, 9],
      startBinding: null,
      endPoint: [70, 80],
      endBinding: {
        targetId: "next-target",
        anchor: { x: 0.25, y: 0.75 },
      },
    });

    expect(next?.data).toMatchObject({
      points: [[8, 9], [70, 80]],
      startBinding: null,
      endBinding: { targetId: "next-target" },
    });
  });
});
