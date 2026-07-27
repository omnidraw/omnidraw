import { describe, expect, it } from "vitest";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { fnCreateShape2dElement } from "../../../src/core/fn.shape2d";
import { fnPersistProductTransformProposal } from "../../../src/plugins/transform/fn.persist-proposal";

describe("durable product transform proposal", () => {
  it("persists radians as degrees and normalizes resized shape dimensions", () => {
    const element = fnCreateShape2dElement({
      id: "rect-1",
      type: "rect",
      x: 10,
      y: 20,
      rotation: 0,
      width: 100,
      height: 60,
      createdAt: 1,
      updatedAt: 1,
      parentGroupId: null,
      zIndex: "z00000000",
    });
    const result = fnPersistProductTransformProposal(element, {
      target: { kind: "element", id: "rect-1" },
      previousTransform: {
        position: { x: 10, y: 20 },
        rotationRadians: 0,
        scale: { x: 1, y: 1 },
        skew: { x: 0, y: 0 },
        origin: { x: 0, y: 0 },
      },
      nextTransform: {
        position: { x: 30, y: 40 },
        rotationRadians: Math.PI / 2,
        scale: { x: 2, y: 3 },
        skew: { x: 0, y: 0 },
        origin: { x: 0, y: 0 },
      },
      previousSize: { width: 100, height: 60 },
      nextSize: { width: 200, height: 180 },
    }, 9);

    expect(result).toMatchObject({
      x: 30,
      y: 40,
      rotation: 90,
      scaleX: 1,
      scaleY: 1,
      updatedAt: 9,
      data: { type: "rect", w: 200, h: 180 },
    });
  });

  it("composes sized widget-frame proposals into the durable root transform", () => {
    const element = {
      id: "widget-1",
      x: 100,
      y: 200,
      rotation: 30,
      scaleX: 2,
      scaleY: 3,
      locked: false,
      parentGroupId: null,
      zIndex: "z00000000",
      createdAt: 1,
      updatedAt: 1,
      bindings: [],
      style: {},
      data: {
        type: "ui-widget",
        kind: "ai",
        payload: {},
        w: 480,
        h: 320,
        expanded: true,
      },
    } satisfies TElement;

    const result = fnPersistProductTransformProposal(element, {
      target: { kind: "element", id: element.id },
      previousTransform: {
        position: { x: 0, y: 0 },
        rotationRadians: 0,
        scale: { x: 1, y: 1 },
        skew: { x: 0, y: 0 },
        origin: { x: 0, y: 0 },
      },
      nextTransform: {
        position: { x: 10, y: 20 },
        rotationRadians: Math.PI / 2,
        scale: { x: 1, y: 1 },
        skew: { x: 0, y: 0 },
        origin: { x: 0, y: 0 },
      },
      previousSize: { width: 480, height: 320 },
      nextSize: { width: 600, height: 400 },
    }, 9);

    expect(result?.x).toBeCloseTo(87.3205, 3);
    expect(result?.y).toBeCloseTo(261.9615, 3);
    expect(result).toMatchObject({
      rotation: 120,
      scaleX: 2,
      scaleY: 3,
      updatedAt: 9,
      data: { type: "ui-widget", w: 600, h: 400 },
    });
  });
});
