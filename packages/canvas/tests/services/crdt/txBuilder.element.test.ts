import { describe, expect, test } from "vitest";
import { createBuilder, createElement, createRealDocHandle } from "./helpers";

describe("txBuilder element", () => {
  test("creates a single element from a full entity patch", () => {
    const { docHandle } = createRealDocHandle();

    createBuilder(docHandle)
      .patchElement("e1", createElement("e1"))
      .commit();

    expect(docHandle.doc().elements.e1).toEqual(createElement("e1"));
  });

  test("creates multiple elements in one commit", () => {
    const { docHandle } = createRealDocHandle();

    createBuilder(docHandle)
      .patchElement("e1", createElement("e1", { x: 1 }))
      .patchElement("e2", createElement("e2", { x: 2 }))
      .patchElement("e3", createElement("e3", { x: 3 }))
      .commit();

    expect(Object.keys(docHandle.doc().elements)).toEqual(["e1", "e2", "e3"]);
    expect(docHandle.doc().elements.e2.x).toBe(2);
  });

  test("patches top level scalar fields without touching unrelated fields", () => {
    const { docHandle } = createRealDocHandle({
      elements: {
        e1: createElement("e1"),
      },
    });

    createBuilder(docHandle)
      .patchElement("e1", "x", 99)
      .patchElement("e1", "locked", true)
      .commit();

    expect(docHandle.doc().elements.e1.x).toBe(99);
    expect(docHandle.doc().elements.e1.locked).toBe(true);
    expect(docHandle.doc().elements.e1.y).toBe(20);
    expect(docHandle.doc().elements.e1.data.text).toBe("hello");
  });

  test("supports updater functions for top level fields", () => {
    const { docHandle } = createRealDocHandle({
      elements: {
        e1: createElement("e1", { x: 10 }),
      },
    });

    createBuilder(docHandle)
      .patchElement("e1", "x", (current) => current + 15)
      .commit();

    expect(docHandle.doc().elements.e1.x).toBe(25);
  });

  test("replaces an existing element when given a full entity", () => {
    const { docHandle } = createRealDocHandle({
      elements: {
        e1: createElement("e1", {
          x: 10,
          style: { opacity: 1, strokeColor: "#111111", backgroundColor: "#eeeeee" },
        }),
      },
    });

    const replacement = createElement("e1", {
      x: 400,
      y: 500,
      style: { opacity: 0.25 },
      data: {
        ...createElement("e1").data,
        text: "replaced",
      },
    });

    createBuilder(docHandle)
      .patchElement("e1", replacement)
      .commit();

    expect(docHandle.doc().elements.e1).toEqual(replacement);
  });

  test("uses the last write when the same field is patched multiple times in one commit", () => {
    const { docHandle } = createRealDocHandle({
      elements: {
        e1: createElement("e1", { x: 10 }),
      },
    });

    createBuilder(docHandle)
      .patchElement("e1", "x", 20)
      .patchElement("e1", "x", (current) => current + 5)
      .patchElement("e1", "x", 99)
      .commit();

    expect(docHandle.doc().elements.e1.x).toBe(99);
  });

  test("deletes one element without touching siblings", () => {
    const { docHandle } = createRealDocHandle({
      elements: {
        e1: createElement("e1"),
        e2: createElement("e2"),
      },
    });

    createBuilder(docHandle)
      .deleteElement("e1")
      .commit();

    expect(docHandle.doc().elements.e1).toBeUndefined();
    expect(docHandle.doc().elements.e2).toBeDefined();
  });

  test("treats deleting a missing element as a no-op", () => {
    const { docHandle } = createRealDocHandle({
      elements: {
        e1: createElement("e1"),
      },
    });

    const result = createBuilder(docHandle)
      .deleteElement("missing")
      .commit();

    expect(docHandle.doc().elements.e1).toBeDefined();
    expect(result.undoOps).toHaveLength(0);
    expect(result.redoOps).toHaveLength(1);
  });

  test("can delete and recreate the same element id in a single commit", () => {
    const { docHandle } = createRealDocHandle({
      elements: {
        e1: createElement("e1", { x: 10, updatedAt: 2 }),
      },
    });

    createBuilder(docHandle)
      .deleteElement("e1")
      .patchElement("e1", createElement("e1", { x: 700, updatedAt: 99 }))
      .commit();

    expect(docHandle.doc().elements.e1.x).toBe(700);
    expect(docHandle.doc().elements.e1.updatedAt).toBe(99);
  });

  test("can create then patch the same element in one commit", () => {
    const { docHandle } = createRealDocHandle();

    createBuilder(docHandle)
      .patchElement("e1", createElement("e1", { x: 5, y: 6 }))
      .patchElement("e1", "x", (current) => current + 10)
      .patchElement("e1", "y", 42)
      .commit();

    expect(docHandle.doc().elements.e1.x).toBe(15);
    expect(docHandle.doc().elements.e1.y).toBe(42);
  });
});
