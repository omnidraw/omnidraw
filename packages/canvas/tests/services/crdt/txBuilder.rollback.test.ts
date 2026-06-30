import { describe, expect, test } from "vitest";
import { txApplyCrdtOps } from "../../../src/services/crdt/tx.apply-ops";
import { cloneForTest, createBuilder, createElement, createGroup, createRealDocHandle } from "./helpers";

describe("txBuilder rollback", () => {
  test("rollback removes a newly created element", () => {
    const { docHandle } = createRealDocHandle();

    const result = createBuilder(docHandle)
      .patchElement("e1", createElement("e1"))
      .commit();

    result.rollback();

    expect(docHandle.doc().elements.e1).toBeUndefined();
  });

  test("rollback restores a patched top level element field", () => {
    const { docHandle } = createRealDocHandle({
      elements: { e1: createElement("e1", { x: 10 }) },
    });

    const result = createBuilder(docHandle)
      .patchElement("e1", "x", 50)
      .commit();

    result.rollback();

    expect(docHandle.doc().elements.e1.x).toBe(10);
  });

  test("rollback restores a deleted element", () => {
    const { docHandle } = createRealDocHandle({
      elements: { e1: createElement("e1") },
    });

    const result = createBuilder(docHandle)
      .deleteElement("e1")
      .commit();

    result.rollback();

    expect(docHandle.doc().elements.e1).toEqual(createElement("e1"));
  });

  test("rollback restores a nested patch", () => {
    const { docHandle } = createRealDocHandle({
      elements: { e1: createElement("e1") },
    });

    const result = createBuilder(docHandle)
      .patchElement("e1", "data", "text", "changed")
      .commit();

    result.rollback();

    expect(docHandle.doc().elements.e1.data.text).toBe("hello");
  });

  test("rollback restores a deleted nested field", () => {
    const { docHandle } = createRealDocHandle({
      elements: {
        e1: createElement("e1", {
          style: { opacity: 1, strokeColor: "#000000", backgroundColor: "#ffffff" },
        }),
      },
    });

    const result = createBuilder(docHandle)
      .deleteElement("e1", "style", "backgroundColor")
      .commit();

    result.rollback();

    expect(docHandle.doc().elements.e1.style.backgroundColor).toBe("#ffffff");
  });

  test("rollback restores multiple elements changed in one commit", () => {
    const { docHandle } = createRealDocHandle({
      elements: {
        e1: createElement("e1", { x: 1 }),
        e2: createElement("e2", { x: 2 }),
      },
    });

    const result = createBuilder(docHandle)
      .patchElement("e1", "x", 100)
      .patchElement("e2", "x", 200)
      .commit();

    result.rollback();

    expect(docHandle.doc().elements.e1.x).toBe(1);
    expect(docHandle.doc().elements.e2.x).toBe(2);
  });

  test("rollback removes an entity that was created and then patched in the same commit", () => {
    const { docHandle } = createRealDocHandle();

    const result = createBuilder(docHandle)
      .patchElement("e1", createElement("e1", { x: 10 }))
      .patchElement("e1", "x", 20)
      .commit();

    result.rollback();

    expect(docHandle.doc().elements.e1).toBeUndefined();
  });

  test("rollback restores the original entity when delete and recreate happen in one commit", () => {
    const { docHandle } = createRealDocHandle({
      elements: {
        e1: createElement("e1", { x: 5, updatedAt: 2 }),
      },
    });

    const result = createBuilder(docHandle)
      .deleteElement("e1")
      .patchElement("e1", createElement("e1", { x: 999, updatedAt: 77 }))
      .commit();

    result.rollback();

    expect(docHandle.doc().elements.e1.x).toBe(5);
    expect(docHandle.doc().elements.e1.updatedAt).toBe(2);
  });

  test("rollback works for group mutations too", () => {
    const { docHandle } = createRealDocHandle({
      groups: { g1: createGroup("g1", { locked: false, zIndex: "base" }) },
    });

    const result = createBuilder(docHandle)
      .patchGroup("g1", "locked", true)
      .patchGroup("g1", "zIndex", "moved")
      .commit();

    result.rollback();

    expect(docHandle.doc().groups.g1.locked).toBe(false);
    expect(docHandle.doc().groups.g1.zIndex).toBe("base");
  });

  test("redo ops restore the committed state after rollback", () => {
    const { docHandle } = createRealDocHandle({
      elements: { e1: createElement("e1", { x: 10 }) },
    });

    const result = createBuilder(docHandle)
      .patchElement("e1", "x", 88)
      .patchElement("e1", "data", "text", "redo-me")
      .commit();

    result.rollback();
    txApplyCrdtOps({
      docHandle,
      clone: cloneForTest,
    }, {
      ops: result.redoOps,
    });

    expect(docHandle.doc().elements.e1.x).toBe(88);
    expect(docHandle.doc().elements.e1.data.text).toBe("redo-me");
  });
});
