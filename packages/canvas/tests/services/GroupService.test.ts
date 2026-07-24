import {
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { ContextMenuService } from "../../src/services/context-menu/ContextMenuService";
import { CrdtService } from "../../src/services/crdt/CrdtService";
import { GroupService } from "../../src/services/group/GroupService";
import { HistoryService } from "../../src/services/history/HistoryService";
import { SelectionService } from "../../src/services/selection/SelectionService";
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
  createId?: () => string;
  now?: () => number;
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
  const selection = new SelectionService();
  const contextMenu = new ContextMenuService();
  const service = new GroupService({
    contextMenu,
    crdt,
    history,
    selection,
    createId: args?.createId ?? (() => "new-group"),
    now: args?.now ?? (() => 100),
  });
  return { contextMenu, crdt, history, selection, service };
}

describe("GroupService", () => {
  test("groups same-parent product targets in one CRDT/history action", () => {
    const { crdt, history, selection, service } = setup({
      elements: [
        createElement("one", { zIndex: "exact-one" }),
        createElement("two", { zIndex: "exact-two" }),
      ],
    });
    const writes = vi.fn();
    crdt.hooks.write.tap(writes);

    const group = service.groupSelection([
      elementTarget("one"),
      elementTarget("two"),
    ]);

    expect(group).toEqual({
      id: "new-group",
      parentGroupId: null,
      zIndex: "exact-two",
      locked: false,
      createdAt: 100,
    });
    expect(crdt.doc().elements.one.parentGroupId).toBe("new-group");
    expect(crdt.doc().elements.two.parentGroupId).toBe("new-group");
    expect(selection.selection).toEqual([groupTarget("new-group")]);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(history.getUndoStackSize()).toBe(1);

    history.undo();
    expect(crdt.doc().groups["new-group"]).toBeUndefined();
    expect(crdt.doc().elements.one.parentGroupId).toBeNull();
    expect(crdt.doc().elements.two.parentGroupId).toBeNull();
    expect(selection.selection).toEqual([
      elementTarget("one"),
      elementTarget("two"),
    ]);

    history.redo();
    expect(crdt.doc().groups["new-group"]).toEqual(group);
    expect(selection.selection).toEqual([groupTarget("new-group")]);
  });

  test("rejects singleton, missing, duplicate, and mixed-parent grouping", () => {
    const { history, service } = setup({
      elements: [
        createElement("root"),
        createElement("nested", { parentGroupId: "host" }),
      ],
      groups: [createGroup("host")],
    });

    expect(service.groupSelection([elementTarget("root")])).toBeNull();
    expect(service.groupSelection([
      elementTarget("root"),
      elementTarget("root"),
    ])).toBeNull();
    expect(service.groupSelection([
      elementTarget("root"),
      elementTarget("missing"),
    ])).toBeNull();
    expect(service.groupSelection([
      elementTarget("root"),
      elementTarget("nested"),
    ])).toBeNull();
    expect(history.getUndoStackSize()).toBe(0);
  });

  test("ungroups product children in place and restores exact snapshots on undo", () => {
    const { crdt, history, selection, service } = setup({
      elements: [
        createElement("before", { zIndex: "root-A" }),
        createElement("child-one", {
          parentGroupId: "group",
          zIndex: "child-custom-one",
        }),
        createElement("child-two", {
          parentGroupId: "group",
          zIndex: "child-custom-two",
        }),
        createElement("after", { zIndex: "root-Z" }),
      ],
      groups: [createGroup("group", { zIndex: "root-M" })],
    });
    const writes = vi.fn();
    crdt.hooks.write.tap(writes);

    const selected = service.ungroupSelection([groupTarget("group")]);

    expect(selected).toEqual([
      elementTarget("child-one"),
      elementTarget("child-two"),
    ]);
    expect(crdt.doc().groups.group).toBeUndefined();
    expect(crdt.doc().elements["child-one"].parentGroupId).toBeNull();
    expect(crdt.doc().elements["child-two"].parentGroupId).toBeNull();
    expect(Object.values(crdt.doc().elements)
      .sort((left, right) => left.zIndex.localeCompare(right.zIndex))
      .map((element) => element.id)).toEqual([
      "before",
      "child-one",
      "child-two",
      "after",
    ]);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(selection.selection).toEqual(selected);

    history.undo();
    expect(crdt.doc().groups.group.zIndex).toBe("root-M");
    expect(crdt.doc().elements["child-one"].parentGroupId).toBe("group");
    expect(crdt.doc().elements["child-one"].zIndex).toBe("child-custom-one");
    expect(selection.selection).toEqual([groupTarget("group")]);

    history.redo();
    expect(crdt.doc().groups.group).toBeUndefined();
    expect(selection.selection).toEqual(selected);
  });

  test("flattens nested selected groups without leaving orphan parents", () => {
    const { crdt, service } = setup({
      elements: [
        createElement("deep", {
          parentGroupId: "child-group",
          zIndex: "A",
        }),
      ],
      groups: [
        createGroup("parent-group", { zIndex: "A" }),
        createGroup("child-group", {
          parentGroupId: "parent-group",
          zIndex: "A",
        }),
      ],
    });

    service.ungroupSelection([
      groupTarget("parent-group"),
      groupTarget("child-group"),
    ]);

    expect(crdt.doc().groups["parent-group"]).toBeUndefined();
    expect(crdt.doc().groups["child-group"]).toBeUndefined();
    expect(crdt.doc().elements.deep.parentGroupId).toBeNull();
  });

  test("moves every descendant element once with one CRDT/history action", () => {
    const { crdt, history, service } = setup({
      elements: [
        createElement("direct", {
          parentGroupId: "parent",
          x: 1,
          y: 2,
          updatedAt: 3,
        }),
        createElement("nested", {
          parentGroupId: "child",
          x: 10,
          y: 20,
          updatedAt: 4,
        }),
      ],
      groups: [
        createGroup("parent"),
        createGroup("child", { parentGroupId: "parent" }),
      ],
      now: () => 500,
    });
    const writes = vi.fn();
    crdt.hooks.write.tap(writes);

    expect(service.moveGroups({
      groupIds: ["parent", "child"],
      delta: { x: 5, y: -3 },
    })).toEqual(["direct", "nested"]);
    expect(crdt.doc().elements.direct).toMatchObject({
      x: 6,
      y: -1,
      updatedAt: 500,
    });
    expect(crdt.doc().elements.nested).toMatchObject({
      x: 15,
      y: 17,
      updatedAt: 500,
    });
    expect(writes).toHaveBeenCalledTimes(1);

    history.undo();
    expect(crdt.doc().elements.direct).toMatchObject({ x: 1, y: 2 });
    expect(crdt.doc().elements.nested).toMatchObject({ x: 10, y: 20 });
    history.redo();
    expect(crdt.doc().elements.nested).toMatchObject({ x: 15, y: 17 });
  });

  test("does not record empty or zero-delta group moves", () => {
    const { history, service } = setup({
      groups: [createGroup("empty")],
    });

    expect(service.moveGroup({
      groupId: "empty",
      delta: { x: 0, y: 0 },
    })).toEqual([]);
    expect(service.moveGroup({
      groupId: "missing",
      delta: { x: 1, y: 1 },
    })).toEqual([]);
    expect(history.getUndoStackSize()).toBe(0);
  });
});
