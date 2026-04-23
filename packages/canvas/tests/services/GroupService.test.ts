import Konva from "konva";
import { describe, expect, test, vi } from "vitest";
import type { TGroup } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { GroupService } from "../../src/services/group/GroupService";

function createGroup(id = "group-1"): TGroup {
  return {
    id,
    parentGroupId: null,
    zIndex: "z00000000",
    locked: false,
    createdAt: 1,
  };
}

function createService() {
  return new GroupService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe("GroupService", () => {
  test("registers and sorts group definitions and emits hooks on change", () => {
    const service = createService();
    const changeSpy = vi.fn();
    const node = new Konva.Group({ id: "group-1" });
    const group = createGroup(node.id());
    const calls: string[] = [];

    service.hooks.groupsChange.tap(changeSpy);

    const unregisterB = service.registerGroup({
      id: "b",
      priority: 20,
      matchesNode: (candidate) => candidate.id() === node.id(),
      toGroup: () => group,
      createNode: () => node,
      attachListeners: (candidate) => {
        calls.push(`listen-b:${candidate.id()}`);
        return true;
      },
    });
    service.registerGroup({
      id: "a",
      priority: 20,
      matchesNode: () => false,
      toGroup: () => null,
      createNode: () => null,
    });
    service.registerGroup({
      id: "c",
      priority: 5,
      matchesNode: () => false,
      toGroup: () => null,
      createNode: () => null,
    });

    expect(service.getGroups().map((definition) => definition.id)).toEqual(["c", "a", "b"]);
    expect(changeSpy).toHaveBeenCalledTimes(3);
    expect(service.toGroup(node)).toEqual(group);
    expect(service.createNodeFromGroup(group)).toBe(node);
    expect(calls).toEqual(["listen-b:group-1"]);

    calls.length = 0;
    expect(service.attachListeners(node)).toBe(true);
    expect(calls).toEqual(["listen-b:group-1"]);

    unregisterB();
    expect(service.getGroups().map((definition) => definition.id)).toEqual(["c", "a"]);
    expect(changeSpy).toHaveBeenCalledTimes(4);

    service.unregisterGroup("missing");
    expect(changeSpy).toHaveBeenCalledTimes(4);
  });

  test("returns null or false when no matching group definition exists", () => {
    const service = createService();
    const node = new Konva.Group({ id: "missing" });
    const group = createGroup("missing");

    expect(service.getGroupDefinitionByNode(node)).toBeNull();
    expect(service.toGroup(node)).toBeNull();
    expect(service.attachListeners(node)).toBe(false);
    expect(service.createNodeFromGroup(group)).toBeNull();
  });
});
