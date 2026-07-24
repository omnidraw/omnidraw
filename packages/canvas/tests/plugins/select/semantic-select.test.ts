import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { fnCollectDeleteTargets } from "../../../src/plugins/select/fn.delete-targets";
import {
  fnGetMarqueeTargets,
  fnGetSelectionPath,
  fnIsSelectionPathPrefix,
} from "../../../src/plugins/select/fn.get-selection-path";
import { txDeleteSelection } from "../../../src/plugins/select/tx.delete-selection";

function document(): TCanvasDoc {
  return {
    id: "doc",
    name: "doc",
    groups: {
      outer: {
        id: "outer",
        parentGroupId: null,
        zIndex: "A",
        locked: false,
        createdAt: 1,
      },
      inner: {
        id: "inner",
        parentGroupId: "outer",
        zIndex: "A",
        locked: false,
        createdAt: 1,
      },
    },
    elements: {
      nested: {
        id: "nested",
        x: 0,
        y: 0,
        rotation: 0,
        zIndex: "A",
        parentGroupId: "inner",
        bindings: [],
        locked: false,
        createdAt: 1,
        updatedAt: 1,
        data: { type: "rect", w: 10, h: 10 },
        style: {},
      },
      root: {
        id: "root",
        x: 0,
        y: 0,
        rotation: 0,
        zIndex: "B",
        parentGroupId: null,
        bindings: [],
        locked: false,
        createdAt: 1,
        updatedAt: 1,
        data: { type: "rect", w: 10, h: 10 },
        style: {},
      },
    },
  };
}

describe("semantic select helpers", () => {
  it("builds deterministic drill-down paths and top-level marquee targets", () => {
    const hit = {
      target: { kind: "element", id: "nested" } as const,
      part: "body" as const,
      groupAncestry: ["outer", "inner"],
      world: { x: 1, y: 2 },
      viewport: { x: 3, y: 4 },
    };
    const path = fnGetSelectionPath({ hit });

    expect(path).toEqual([
      { kind: "group", id: "outer" },
      { kind: "group", id: "inner" },
      { kind: "element", id: "nested" },
    ]);
    expect(fnIsSelectionPathPrefix({
      selection: path.slice(0, 2),
      path,
    })).toBe(true);
    expect(fnGetMarqueeTargets({
      hits: [
        hit,
        {
          ...hit,
          target: { kind: "group", id: "inner" },
        },
        {
          ...hit,
          target: { kind: "element", id: "root" },
          groupAncestry: [],
        },
      ],
    })).toEqual([
      { kind: "element", id: "root" },
      { kind: "group", id: "outer" },
    ]);
  });

  it("expands groups and collapses selected descendants for product deletion", () => {
    expect(fnCollectDeleteTargets({
      document: document(),
      targets: [
        { kind: "group", id: "outer" },
        { kind: "element", id: "nested" },
      ],
    })).toEqual([
      { kind: "element", id: "nested" },
      { kind: "group", id: "inner" },
      { kind: "group", id: "outer" },
    ]);
  });

  it("deletes through CRDT and records product undo/redo only", () => {
    const deleteElement = vi.fn();
    const deleteGroup = vi.fn();
    const rollback = vi.fn();
    const clear = vi.fn();
    const setSelection = vi.fn();
    const setFocusedTarget = vi.fn();
    const record = vi.fn();
    const builder = {
      deleteElement,
      deleteGroup,
      commit: () => ({
        rollback,
        undoOps: [],
        redoOps: [{ kind: "delete-entity" }],
      }),
    };

    expect(txDeleteSelection({
      crdt: {
        doc: document,
        build: () => builder,
      },
      element: {
        deleteElement: (entity: { id: string }) => {
          deleteElement(entity.id);
        },
      },
      history: { record },
      renderOrder: {
        getOrderBundle: (target: unknown) => [target],
      },
      selection: {
        selection: [{ kind: "group", id: "outer" }],
        clear,
        setSelection,
        setFocusedTarget,
      },
    } as never, {})).toBe(true);

    expect(deleteElement).toHaveBeenCalledWith("nested");
    expect(deleteGroup.mock.calls.map((call) => call[0]))
      .toEqual(["inner", "outer"]);
    expect(clear).toHaveBeenCalledOnce();

    const entry = record.mock.calls[0]?.[0] as {
      undo(): void;
      redo(): void;
    };
    entry.undo();
    expect(rollback).toHaveBeenCalledOnce();
    expect(setSelection).toHaveBeenCalledWith([
      { kind: "group", id: "outer" },
    ]);
    entry.redo();
    expect(deleteElement).toHaveBeenCalledTimes(2);
    expect(deleteGroup).toHaveBeenCalledTimes(4);
  });
});
