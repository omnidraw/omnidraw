import { describe, expect, test } from "bun:test";
import { ZToolGroup, ZToolGroupUpdateInput } from "./CONSTANTS";

describe("tool group API schema", () => {
  test("accepts null and the existing structured tool icon JSON", () => {
    expect(ZToolGroup.parse({ name: " Plain ", json: null })).toEqual({
      name: "Plain",
      json: null,
    });
    expect(ZToolGroup.parse({
      name: "Productivity",
      json: { lucidIcon: "LayoutGrid" },
    })).toEqual({
      name: "Productivity",
      json: { lucidIcon: "LayoutGrid" },
    });
    expect(ZToolGroup.parse({
      name: "Custom",
      json: { svgIcon: "<svg></svg>" },
    })).toEqual({
      name: "Custom",
      json: { svgIcon: "<svg></svg>" },
    });
  });

  test("accepts rename updates with the current group name", () => {
    expect(ZToolGroupUpdateInput.parse({
      currentName: "Productivity",
      group: { name: "Work", json: null },
    })).toEqual({ currentName: "Productivity", group: { name: "Work", json: null } });
  });

  test("rejects malformed tool icon JSON", () => {
    expect(ZToolGroup.safeParse({ name: "Missing icon", json: {} }).success).toBe(false);
    expect(ZToolGroup.safeParse({ name: "Unknown icon", json: { lucidIcon: "NotALucideIcon" } }).success).toBe(false);
    expect(ZToolGroup.safeParse({ name: "Wrong shape", json: { icon: "LayoutGrid" } }).success).toBe(false);
    expect(ZToolGroup.safeParse({ name: " ", json: null }).success).toBe(false);
  });
});
