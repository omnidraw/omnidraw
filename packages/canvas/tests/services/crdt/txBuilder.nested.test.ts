import { describe, expect, test } from "vitest";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { createBuilder, createElement, createRealDocHandle, createTextData } from "./helpers";

function createLineElement(id: string): TElement {
  return createElement(id, {
    data: {
      type: "line",
      lineType: "straight",
      points: [[0, 0], [10, 10]],
      startBinding: null,
      endBinding: null,
      w: 10,
      h: 10,
    },
  });
}

describe("txBuilder nested", () => {
  test("patches nested text data fields", () => {
    const { docHandle } = createRealDocHandle({
      elements: { e1: createElement("e1") },
    });

    createBuilder(docHandle)
      .patchElement("e1", "data", "text", "next")
      .commit();

    expect(docHandle.doc().elements.e1.data.text).toBe("next");
  });

  test("patches nested style fields", () => {
    const { docHandle } = createRealDocHandle({
      elements: { e1: createElement("e1") },
    });

    createBuilder(docHandle)
      .patchElement("e1", "style", "opacity", 0.4)
      .commit();

    expect(docHandle.doc().elements.e1.style.opacity).toBe(0.4);
    expect(docHandle.doc().elements.e1.style.strokeColor).toBe("#000000");
  });

  test("supports updater functions on nested text data", () => {
    const { docHandle } = createRealDocHandle({
      elements: { e1: createElement("e1") },
    });

    createBuilder(docHandle)
      .patchElement("e1", "data", "text", (current) => `${current} world`)
      .commit();

    expect(docHandle.doc().elements.e1.data.text).toBe("hello world");
  });

  test("supports updater functions on nested style data", () => {
    const { docHandle } = createRealDocHandle({
      elements: { e1: createElement("e1", { style: { opacity: 0.1, strokeColor: "#123456" } }) },
    });

    createBuilder(docHandle)
      .patchElement("e1", "style", "opacity", (current) => current + 0.2)
      .commit();

    expect(docHandle.doc().elements.e1.style.opacity).toBeCloseTo(0.3);
  });

  test("replaces an entire nested object when patching data directly", () => {
    const { docHandle } = createRealDocHandle({
      elements: { e1: createElement("e1") },
    });

    const nextData = createTextData({
      text: "fresh",
      originalText: "fresh",
    });

    createBuilder(docHandle)
      .patchElement("e1", "data", nextData)
      .commit();

    expect(docHandle.doc().elements.e1.data).toEqual(nextData);
  });

  test("can replace nested array values through object replacement", () => {
    const { docHandle } = createRealDocHandle({
      elements: { e1: createLineElement("e1") },
    });

    createBuilder(docHandle)
      .patchElement("e1", "data", {
        type: "line",
        lineType: "curved",
        points: [[1, 1], [2, 2], [3, 3]],
        startBinding: null,
        endBinding: null,
        w: 20,
        h: 20,
      })
      .commit();

    expect(docHandle.doc().elements.e1.data.points).toEqual([[1, 1], [2, 2], [3, 3]]);
    expect(docHandle.doc().elements.e1.data.lineType).toBe("curved");
  });

  test("deletes an existing nested style field", () => {
    const { docHandle } = createRealDocHandle({
      elements: {
        e1: createElement("e1", {
          style: {
            opacity: 1,
            strokeColor: "#000000",
            backgroundColor: "#ffffff",
          },
        }),
      },
    });

    createBuilder(docHandle)
      .deleteElement("e1", "style", "backgroundColor")
      .commit();

    expect("backgroundColor" in docHandle.doc().elements.e1.style).toBe(false);
    expect(docHandle.doc().elements.e1.style.strokeColor).toBe("#000000");
  });

  test("treats deleting a missing nested field as a no-op", () => {
    const { docHandle } = createRealDocHandle({
      elements: { e1: createElement("e1", { style: { opacity: 1 } }) },
    });

    const result = createBuilder(docHandle)
      .deleteElement("e1", "style", "backgroundColor")
      .commit();

    expect(docHandle.doc().elements.e1.style.opacity).toBe(1);
    expect(result.undoOps).toHaveLength(0);
  });

  test("creates a new nested optional style key through patching", () => {
    const { docHandle } = createRealDocHandle({
      elements: { e1: createElement("e1", { style: { opacity: 1 } }) },
    });

    createBuilder(docHandle)
      .patchElement("e1", "style", "strokeColor", "#ff0000")
      .commit();

    expect(docHandle.doc().elements.e1.style.strokeColor).toBe("#ff0000");
  });

  test("applies nested operations in order within one commit", () => {
    const { docHandle } = createRealDocHandle({
      elements: { e1: createElement("e1") },
    });

    createBuilder(docHandle)
      .patchElement("e1", "data", "text", "first")
      .deleteElement("e1", "data", "text")
      .patchElement("e1", "data", "text", "final")
      .commit();

    expect(docHandle.doc().elements.e1.data.text).toBe("final");
  });
});
