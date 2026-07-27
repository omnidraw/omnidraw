import { describe, expect, it } from "vitest";
import { fnCreatePenDataFromStrokePoints } from "../../../src/plugins/pen/fn.math";

describe("pen product samples", () => {
  it("keeps raw local points and pressure samples in the persisted schema", () => {
    expect(fnCreatePenDataFromStrokePoints({
      points: [
        { x: 12, y: 20, pressure: 0.25 },
        { x: 17, y: 29, pressure: 0.8 },
      ],
    })).toEqual({
      type: "pen",
      x: 12,
      y: 20,
      points: [[0, 0], [5, 9]],
      pressures: [0.25, 0.8],
      simulatePressure: true,
    });
  });
});
