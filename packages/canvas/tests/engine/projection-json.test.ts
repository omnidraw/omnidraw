import { describe, expect, test } from "vitest";
import {
  fnCanonicalCanvasJson,
  fnIsCanvasJsonValue,
} from "../../src/engine/projection/fn.json";
import { fnFreezeCanvasProjectionValue } from "../../src/engine/projection/fn.freeze";

describe("projection JSON boundary", () => {
  test("accepts nested plain JSON records with null prototypes", () => {
    const record = Object.assign(Object.create(null), {
      nested: [{ ok: true }, null],
    });

    expect(fnIsCanvasJsonValue({ value: record })).toBe(true);
    expect(fnCanonicalCanvasJson({ value: record }))
      .toBe('{"nested":[{"ok":true},null]}');
  });

  test.each([
    new Date(0),
    new Map([["key", "value"]]),
    new Set(["value"]),
    /value/,
    document.createElement("div"),
    { callback: () => undefined },
    { missing: undefined },
    { invalid: Number.NaN },
  ])("rejects runtime or non-JSON projection value %#", (value) => {
    expect(fnIsCanvasJsonValue({ value })).toBe(false);
    expect(() => fnCanonicalCanvasJson({ value })).toThrow();
  });

  test("deep-freezes projection-owned arrays and records", () => {
    const value = fnFreezeCanvasProjectionValue({
      value: {
        nodes: [{ id: "node" }],
      },
    });

    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.nodes)).toBe(true);
    expect(Object.isFrozen(value.nodes[0])).toBe(true);
    expect(() => {
      value.nodes[0]!.id = "mutated";
    }).toThrow();
  });
});
