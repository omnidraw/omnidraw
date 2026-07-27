import { describe, expect, test } from "vitest";
import {
  fnCanvasModifierState,
  fnCanvasTargetKey,
  fnCanvasTargetsEqual,
  fnElementTransformPatch,
  fnIsCanvasTarget,
  fnRadiansToPersistedDegrees,
  fnUniqueCanvasTargets,
} from "../../src/semantic";
import { createElement } from "../services/crdt/helpers";

describe("renderer-neutral canvas contracts", () => {
  test("target identity includes the product kind", () => {
    const element = { kind: "element", id: "shared/id" } as const;
    const group = { kind: "group", id: "shared/id" } as const;

    expect(fnCanvasTargetKey(element)).toBe("element:shared/id");
    expect(fnCanvasTargetKey(group)).toBe("group:shared/id");
    expect(fnCanvasTargetsEqual(element, group)).toBe(false);
    expect(fnUniqueCanvasTargets([
      element,
      element,
      group,
      { ...group },
    ])).toEqual([element, group]);
  });

  test("target guard rejects empty and renderer-shaped values", () => {
    expect(fnIsCanvasTarget({ kind: "element", id: "e1" })).toBe(true);
    expect(fnIsCanvasTarget({ kind: "group", id: "g1" })).toBe(true);
    expect(fnIsCanvasTarget({ kind: "element", id: "" })).toBe(false);
    expect(fnIsCanvasTarget({ id: "e1", node: {} })).toBe(false);
    expect(fnIsCanvasTarget(null)).toBe(false);
  });

  test("normalizes DOM modifier naming without retaining an event", () => {
    expect(fnCanvasModifierState({
      altKey: true,
      ctrlKey: false,
      metaKey: true,
      shiftKey: false,
    })).toEqual({
      alt: true,
      control: false,
      meta: true,
      shift: false,
    });
  });

  test.each([
    [0, 0],
    [Math.PI / 2, 90],
    [Math.PI, 180],
    [Math.PI * 2, 0],
    [-Math.PI / 2, 270],
    [Math.PI * 5, 180],
  ])("maps engine radians %s to persisted degrees %s", (radians, degrees) => {
    expect(fnRadiansToPersistedDegrees(radians)).toBeCloseTo(degrees);
  });

  test("converts a proposal using product data as the default authority", () => {
    const element = createElement("e1", {
      x: 10,
      y: 20,
      rotation: 15,
      scaleX: 2,
      scaleY: 3,
    });

    expect(fnElementTransformPatch(element, {
      target: { kind: "element", id: "e1" },
      position: { x: 30, y: 40 },
      rotationRadians: Math.PI / 2,
      size: { width: 200, height: 100 },
    })).toEqual({
      x: 30,
      y: 40,
      rotation: 90,
      scaleX: 2,
      scaleY: 3,
      width: 200,
      height: 100,
    });
  });

  test("rejects proposals for a different target", () => {
    expect(fnElementTransformPatch(createElement("e1"), {
      target: { kind: "group", id: "e1" },
      position: { x: 1, y: 2 },
    })).toBeNull();
  });
});
