import { describe, expect, test } from "vitest";
import { createBuilder, createGroup, createRealDocHandle } from "./helpers";

describe("txBuilder group", () => {
  test("creates a single group from a full entity patch", () => {
    const { docHandle } = createRealDocHandle();

    createBuilder(docHandle)
      .patchGroup("g1", createGroup("g1"))
      .commit();

    expect(docHandle.doc().groups.g1).toEqual(createGroup("g1"));
  });

  test("creates multiple groups in one commit", () => {
    const { docHandle } = createRealDocHandle();

    createBuilder(docHandle)
      .patchGroup("g1", createGroup("g1", { zIndex: "g-1" }))
      .patchGroup("g2", createGroup("g2", { zIndex: "g-2" }))
      .patchGroup("g3", createGroup("g3", { zIndex: "g-3" }))
      .commit();

    expect(Object.keys(docHandle.doc().groups)).toEqual(["g1", "g2", "g3"]);
    expect(docHandle.doc().groups.g3.zIndex).toBe("g-3");
  });

  test("patches top level group fields", () => {
    const { docHandle } = createRealDocHandle({
      groups: {
        g1: createGroup("g1"),
      },
    });

    createBuilder(docHandle)
      .patchGroup("g1", "parentGroupId", "root")
      .patchGroup("g1", "locked", true)
      .commit();

    expect(docHandle.doc().groups.g1.parentGroupId).toBe("root");
    expect(docHandle.doc().groups.g1.locked).toBe(true);
    expect(docHandle.doc().groups.g1.zIndex).toBe("g-g1");
  });

  test("supports updater functions for top level group fields", () => {
    const { docHandle } = createRealDocHandle({
      groups: {
        g1: createGroup("g1", { locked: false }),
      },
    });

    createBuilder(docHandle)
      .patchGroup("g1", "locked", (current) => !current)
      .commit();

    expect(docHandle.doc().groups.g1.locked).toBe(true);
  });

  test("replaces an existing group when given a full entity", () => {
    const { docHandle } = createRealDocHandle({
      groups: {
        g1: createGroup("g1", { parentGroupId: null, zIndex: "old", locked: false }),
      },
    });

    const replacement = createGroup("g1", {
      parentGroupId: "parent-2",
      zIndex: "new-z",
      locked: true,
      createdAt: 99,
    });

    createBuilder(docHandle)
      .patchGroup("g1", replacement)
      .commit();

    expect(docHandle.doc().groups.g1).toEqual(replacement);
  });

  test("uses the last write when the same group field is patched multiple times", () => {
    const { docHandle } = createRealDocHandle({
      groups: {
        g1: createGroup("g1", { zIndex: "base" }),
      },
    });

    createBuilder(docHandle)
      .patchGroup("g1", "zIndex", "mid")
      .patchGroup("g1", "zIndex", (current) => `${current}-next`)
      .patchGroup("g1", "zIndex", "final")
      .commit();

    expect(docHandle.doc().groups.g1.zIndex).toBe("final");
  });

  test("deletes one group without touching siblings", () => {
    const { docHandle } = createRealDocHandle({
      groups: {
        g1: createGroup("g1"),
        g2: createGroup("g2"),
      },
    });

    createBuilder(docHandle)
      .deleteGroup("g1")
      .commit();

    expect(docHandle.doc().groups.g1).toBeUndefined();
    expect(docHandle.doc().groups.g2).toBeDefined();
  });

  test("treats deleting a missing group as a no-op", () => {
    const { docHandle } = createRealDocHandle({
      groups: {
        g1: createGroup("g1"),
      },
    });

    const result = createBuilder(docHandle)
      .deleteGroup("missing")
      .commit();

    expect(docHandle.doc().groups.g1).toBeDefined();
    expect(result.undoOps).toHaveLength(0);
    expect(result.redoOps).toHaveLength(1);
  });

  test("can delete and recreate the same group id in a single commit", () => {
    const { docHandle } = createRealDocHandle({
      groups: {
        g1: createGroup("g1", { zIndex: "old" }),
      },
    });

    createBuilder(docHandle)
      .deleteGroup("g1")
      .patchGroup("g1", createGroup("g1", { zIndex: "fresh", parentGroupId: "root" }))
      .commit();

    expect(docHandle.doc().groups.g1.zIndex).toBe("fresh");
    expect(docHandle.doc().groups.g1.parentGroupId).toBe("root");
  });

  test("can create then patch the same group in one commit", () => {
    const { docHandle } = createRealDocHandle();

    createBuilder(docHandle)
      .patchGroup("g1", createGroup("g1", { zIndex: "start", locked: false }))
      .patchGroup("g1", "locked", true)
      .patchGroup("g1", "zIndex", "end")
      .commit();

    expect(docHandle.doc().groups.g1.locked).toBe(true);
    expect(docHandle.doc().groups.g1.zIndex).toBe("end");
  });
});
