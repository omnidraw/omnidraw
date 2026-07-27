import {
  describe,
  expect,
  test,
} from "vitest";
import { fnCreateOrderedZIndex } from "../../src/core/fn.create-ordered-z-index";
import { ContextMenuService } from "../../src/services/context-menu/ContextMenuService";
import { CrdtService } from "../../src/services/crdt/CrdtService";
import { HistoryService } from "../../src/services/history/HistoryService";
import { RenderOrderService } from "../../src/services/render-order/RenderOrderService";
import {
  createElement,
  createGroup,
  createRealDocHandle,
} from "./crdt/helpers";

const elementTarget = (id: string) => ({ kind: "element", id }) as const;
const groupTarget = (id: string) => ({ kind: "group", id }) as const;

function setup(args?: {
  elements?: ReturnType<typeof createElement>[];
  groups?: ReturnType<typeof createGroup>[];
}) {
  const { docHandle } = createRealDocHandle({
    elements: Object.fromEntries(
      (args?.elements ?? []).map((element) => [element.id, element]),
    ),
    groups: Object.fromEntries(
      (args?.groups ?? []).map((group) => [group.id, group]),
    ),
  });
  const crdt = new CrdtService({ docHandle });
  crdt.start();
  const history = new HistoryService();
  const contextMenu = new ContextMenuService();
  const service = new RenderOrderService({ crdt, history, contextMenu });
  return { crdt, history, service };
}

function orderedKeys(
  service: RenderOrderService,
  parentGroupId: string | null = null,
) {
  return service.getOrderedSiblings(parentGroupId).map((item) => {
    return `${item.target.kind}:${item.target.id}`;
  });
}

describe("RenderOrderService", () => {
  test("orders product siblings by exact persisted zIndex and semantic key", () => {
    const { service } = setup({
      elements: [
        createElement("b", { zIndex: "same" }),
        createElement("a", { zIndex: "same" }),
      ],
      groups: [
        createGroup("a", { zIndex: "same" }),
        createGroup("first", { zIndex: "!first" }),
      ],
    });

    expect(orderedKeys(service)).toEqual([
      "group:first",
      "element:a",
      "element:b",
      "group:a",
    ]);
  });

  test("assigns product order on insert with one CRDT write batch", () => {
    const { crdt, service } = setup({
      elements: [
        createElement("a", { zIndex: "legacy-A" }),
        createElement("b", { zIndex: "legacy-B" }),
      ],
    });
    const writes: unknown[] = [];
    crdt.hooks.write.tap((ops) => writes.push(ops));

    const patches = service.assignOrderOnInsert({
      parentGroupId: null,
      targets: [elementTarget("b")],
      position: "back",
    });

    expect(patches).toEqual([
      { target: elementTarget("b"), zIndex: fnCreateOrderedZIndex(0) },
      { target: elementTarget("a"), zIndex: fnCreateOrderedZIndex(1) },
    ]);
    expect(orderedKeys(service)).toEqual(["element:b", "element:a"]);
    expect(writes).toHaveLength(1);
  });

  test("moves semantic bundles and undo/redo restores exact string keys", () => {
    const { crdt, history, service } = setup({
      elements: [
        createElement("a", { zIndex: "α" }),
        createElement("b", { zIndex: "β" }),
        createElement("c", { zIndex: "γ" }),
        createElement("d", { zIndex: "δ" }),
      ],
    });
    service.registerBundleResolver("bc", (target) => {
      return target.kind === "element"
        && (target.id === "b" || target.id === "c")
        ? [elementTarget("b"), elementTarget("c")]
        : null;
    });

    expect(service.moveSelectionUp([elementTarget("b")])).toBe(true);
    expect(orderedKeys(service)).toEqual([
      "element:b",
      "element:c",
      "element:a",
      "element:d",
    ]);

    expect(history.undo()).toBe(true);
    expect(crdt.doc().elements.a.zIndex).toBe("α");
    expect(crdt.doc().elements.b.zIndex).toBe("β");
    expect(crdt.doc().elements.c.zIndex).toBe("γ");
    expect(crdt.doc().elements.d.zIndex).toBe("δ");
    expect(orderedKeys(service)).toEqual([
      "element:a",
      "element:b",
      "element:c",
      "element:d",
    ]);

    expect(history.redo()).toBe(true);
    expect(orderedKeys(service)).toEqual([
      "element:b",
      "element:c",
      "element:a",
      "element:d",
    ]);
  });

  test("moves to extremes, deduplicates targets, and rejects mixed parents", () => {
    const { history, service } = setup({
      elements: [
        createElement("a", { zIndex: "A" }),
        createElement("b", { zIndex: "B" }),
        createElement("nested", {
          parentGroupId: "host",
          zIndex: "A",
        }),
      ],
      groups: [createGroup("host", { zIndex: "C" })],
    });

    expect(service.bringSelectionToFront([
      elementTarget("a"),
      elementTarget("a"),
    ])).toBe(true);
    expect(orderedKeys(service)).toEqual([
      "element:b",
      "group:host",
      "element:a",
    ]);
    expect(service.sendSelectionToBack([
      elementTarget("a"),
      elementTarget("nested"),
    ])).toBe(false);
    expect(history.getUndoStackSize()).toBe(1);
  });

  test("snapshots and restores root/group order using product parent IDs", () => {
    const { crdt, service } = setup({
      elements: [
        createElement("one", {
          parentGroupId: "host",
          zIndex: "custom-one",
        }),
        createElement("two", {
          parentGroupId: "host",
          zIndex: "custom-two",
        }),
      ],
      groups: [
        createGroup("host", { zIndex: "root-host" }),
        createGroup("nested", {
          parentGroupId: "host",
          zIndex: "custom-three",
        }),
      ],
    });
    const snapshot = service.snapshotParentOrder("host");
    service.sendSelectionToBack([groupTarget("nested")]);
    expect(orderedKeys(service, "host")[0]).toBe("group:nested");

    expect(service.restoreParentOrder(snapshot)).toBe(true);
    expect(crdt.doc().elements.one.zIndex).toBe("custom-one");
    expect(crdt.doc().elements.two.zIndex).toBe("custom-two");
    expect(crdt.doc().groups.nested.zIndex).toBe("custom-three");
  });

  test("keeps element and group targets with the same ID distinct", () => {
    const { service } = setup({
      elements: [createElement("same", { zIndex: "A" })],
      groups: [createGroup("same", { zIndex: "B" })],
    });

    service.sendSelectionToBack([groupTarget("same")]);

    expect(orderedKeys(service)).toEqual([
      "group:same",
      "element:same",
    ]);
  });
});
