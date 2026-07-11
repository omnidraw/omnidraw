import { describe, expect, it } from "vitest";
import type { TTool } from "../../../src/services/tool/types";
import {
  fnBuildToolbarColumns,
  fnBuildToolbarSlots,
  type TToolbarSlot,
} from "../../../src/components/FloatingCanvasToolbar/fn.runtime-toolbar";

function tool(id: string, args: Partial<TTool> = {}): TTool {
  return {
    id,
    label: id.toUpperCase(),
    behavior: { type: "mode", mode: "draw-create" },
    ...args,
  };
}

function slots(tools: TTool[], activeToolId = "select") {
  return fnBuildToolbarSlots({
    tools,
    activeToolId,
    definitions: {
      media: { icon: "media-icon", label: "Media tools" },
    },
    toolHeight: 28,
    wideToolHeight: 36,
  });
}

describe("fnBuildToolbarSlots", () => {
  it("groups repeated trimmed names at their first member while preserving order", () => {
    const result = slots([
      tool("select"),
      tool("image", { group: " media " }),
      tool("text"),
      tool("video", { group: "media" }),
      tool("blank", { group: "   " }),
    ], "video");

    expect(result.map((slot) => slot.key)).toEqual([
      "tool:select",
      "group:media",
      "tool:text",
      "tool:blank",
    ]);
    expect(result[1]).toMatchObject({
      type: "group",
      group: "media",
      label: "Media tools",
      icon: "media-icon",
      active: true,
    });
    expect(result[1]?.type === "group" ? result[1].tools.map((member) => member.id) : []).toEqual(["image", "video"]);
  });

  it("keeps singleton and case-distinct groups as direct tools", () => {
    const result = slots([
      tool("one", { group: "Solo" }),
      tool("two", { group: "solo" }),
      tool("three", { group: "other", shortcuts: ["ctrl+k"] }),
    ]);

    expect(result.map((slot) => slot.type)).toEqual(["tool", "tool", "tool"]);
    expect(result[2]?.estimatedHeight).toBe(36);
  });

  it("keeps repeated groups without a persisted definition as direct tools", () => {
    const result = slots([
      tool("one", { group: "documents" }),
      tool("two", { group: "documents" }),
    ]);

    expect(result.map((slot) => slot.key)).toEqual(["tool:one", "tool:two"]);
  });
});

describe("fnBuildToolbarColumns", () => {
  const toolbarSlots = Array.from({ length: 6 }, (_, index) => ({
    type: "tool" as const,
    key: `tool:${index}`,
    tool: tool(String(index)),
    estimatedHeight: 28,
  })) satisfies TToolbarSlot[];

  it.each([
    { availableHeight: 200, expectedColumns: 1, needsScroll: false },
    { availableHeight: 100, expectedColumns: 2, needsScroll: false },
    { availableHeight: 60, expectedColumns: 3, needsScroll: false },
    { availableHeight: 40, expectedColumns: 3, needsScroll: true },
  ])("uses the minimum capped column count for height $availableHeight", ({ availableHeight, expectedColumns, needsScroll }) => {
    const result = fnBuildToolbarColumns({
      slots: toolbarSlots,
      availableHeight,
      maxColumns: 3,
    });

    expect(result.columns).toHaveLength(expectedColumns);
    expect(result.columns.flat().map((slot) => slot.key)).toEqual(toolbarSlots.map((slot) => slot.key));
    expect(result.needsScroll).toBe(needsScroll);
  });

  it("returns one empty column for an empty toolbar", () => {
    expect(fnBuildToolbarColumns({ slots: [], availableHeight: 100, maxColumns: 3 })).toEqual({
      columns: [[]],
      needsScroll: false,
    });
  });
});
