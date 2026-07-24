import { describe, expect, it } from "vitest";
import {
  fnBeginShape1dPointEdit,
  fnCanCommitShape1dPointEdit,
  fnMoveShape1dPoint,
  fnShape1dEditHandles,
  fnShape1dElementWithPoints,
} from "../../../src/plugins/shape1d/fn.point-edit";

describe("shape1d point edit drafts", () => {
  it("inserts a midpoint only in the portal-free draft", () => {
    const source = [[0, 0], [20, 10]] as const;
    const midpoint = fnShape1dEditHandles(source).find((handle) => {
      return handle.id === "mid:0";
    })!;
    const draft = fnBeginShape1dPointEdit({
      points: source,
      handle: midpoint,
    });

    expect(draft).toEqual({
      pointIndex: 1,
      points: [[0, 0], [10, 5], [20, 10]],
    });
    expect(source).toEqual([[0, 0], [20, 10]]);
  });

  it("moves only the captured point and leaves the rollback snapshot intact", () => {
    const source = [[0, 0], [10, 5], [20, 10]] as const;
    expect(fnMoveShape1dPoint({
      points: source,
      pointIndex: 1,
      point: { x: 12, y: 8 },
    })).toEqual([[0, 0], [12, 8], [20, 10]]);
    expect(source[1]).toEqual([10, 5]);
  });

  it("rejects a stale commit after a concurrent durable edit", () => {
    const snapshot = {
      id: "line",
      x: 0,
      y: 0,
      rotation: 0,
      zIndex: "",
      parentGroupId: null,
      bindings: [],
      locked: false,
      createdAt: 1,
      updatedAt: 4,
      style: {},
      data: {
        type: "line" as const,
        lineType: "straight" as const,
        points: [[0, 0], [10, 10]] as [number, number][],
        startBinding: null,
        endBinding: null,
      },
    };
    expect(fnCanCommitShape1dPointEdit(snapshot, {
      ...snapshot,
      updatedAt: 5,
    })).toBe(false);
    expect(fnCanCommitShape1dPointEdit(snapshot, snapshot)).toBe(true);
  });

  it("commits endpoint bindings with point edits", () => {
    const element = {
      id: "line",
      x: 0,
      y: 0,
      rotation: 0,
      zIndex: "",
      parentGroupId: null,
      bindings: [],
      locked: false,
      createdAt: 1,
      updatedAt: 4,
      style: {},
      data: {
        type: "line" as const,
        lineType: "straight" as const,
        points: [[0, 0], [10, 10]] as [number, number][],
        startBinding: null,
        endBinding: null,
      },
    };
    const endBinding = {
      targetId: "destination",
      anchor: { x: 0, y: 0.5 },
    };

    expect(fnShape1dElementWithPoints({
      element,
      points: [[0, 0], [20, 10]],
      startBinding: null,
      endBinding,
      updatedAt: 5,
    })?.data).toMatchObject({
      points: [[0, 0], [20, 10]],
      startBinding: null,
      endBinding,
    });
  });
});
