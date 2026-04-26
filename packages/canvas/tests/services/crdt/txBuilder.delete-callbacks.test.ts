import { describe, expect, test } from "vitest";
import { CrdtService } from "../../../src/services/crdt/CrdtService";
import { createBuilder, createElement, createGroup, createRealDocHandle } from "./helpers";

describe("txBuilder delete callbacks", () => {
  test("runs element delete callbacks synchronously without recording them in redo ops", () => {
    const deletedElement = createElement("e1", { x: 42 });
    const { docHandle } = createRealDocHandle({
      elements: {
        e1: deletedElement,
      },
    });
    const calls: string[] = [];

    const result = createBuilder(docHandle)
      .deleteElement("e1", {
        onCommit: ({ id, target, entity }) => {
          calls.push(`commit:${target}:${id}:${entity.x}`);
          entity.x = 999;
        },
        onRollback: ({ id, target, entity }) => {
          calls.push(`rollback:${target}:${id}:${entity.x}`);
          entity.x = 111;
        },
      })
      .commit();

    expect(calls).toEqual(["commit:element:e1:42"]);
    expect(docHandle.doc().elements.e1).toBeUndefined();
    expect(result.redoOps).toEqual([
      {
        kind: "delete-entity",
        target: "element",
        id: "e1",
      },
    ]);
    expect(JSON.stringify(result.redoOps)).not.toContain("onCommit");

    result.rollback();

    expect(calls).toEqual([
      "commit:element:e1:42",
      "rollback:element:e1:42",
    ]);
    expect(docHandle.doc().elements.e1).toEqual(deletedElement);
  });

  test("runs rollback delete callbacks in reverse commit order", () => {
    const { docHandle } = createRealDocHandle({
      elements: {
        e1: createElement("e1"),
        e2: createElement("e2"),
      },
    });
    const calls: string[] = [];

    const result = createBuilder(docHandle)
      .deleteElement("e1", {
        onCommit: ({ id }) => calls.push(`commit:${id}`),
        onRollback: ({ id }) => calls.push(`rollback:${id}`),
      })
      .deleteElement("e2", {
        onCommit: ({ id }) => calls.push(`commit:${id}`),
        onRollback: ({ id }) => calls.push(`rollback:${id}`),
      })
      .commit();

    expect(calls).toEqual(["commit:e1", "commit:e2"]);

    result.rollback();

    expect(calls).toEqual([
      "commit:e1",
      "commit:e2",
      "rollback:e2",
      "rollback:e1",
    ]);
  });

  test("does not run delete callbacks for missing elements", () => {
    const { docHandle } = createRealDocHandle();
    const calls: string[] = [];

    const result = createBuilder(docHandle)
      .deleteElement("missing", {
        onCommit: ({ id }) => calls.push(`commit:${id}`),
        onRollback: ({ id }) => calls.push(`rollback:${id}`),
      })
      .commit();

    result.rollback();

    expect(calls).toEqual([]);
    expect(result.undoOps).toEqual([]);
    expect(result.redoOps).toEqual([
      {
        kind: "delete-entity",
        target: "element",
        id: "missing",
      },
    ]);
  });

  test("runs group delete callbacks", () => {
    const deletedGroup = createGroup("g1", { zIndex: "group-z" });
    const { docHandle } = createRealDocHandle({
      groups: {
        g1: deletedGroup,
      },
    });
    const calls: string[] = [];

    const result = createBuilder(docHandle)
      .deleteGroup("g1", {
        onCommit: ({ id, target, entity }) => calls.push(`commit:${target}:${id}:${entity.zIndex}`),
        onRollback: ({ id, target, entity }) => calls.push(`rollback:${target}:${id}:${entity.zIndex}`),
      })
      .commit();

    expect(calls).toEqual(["commit:group:g1:group-z"]);
    expect(docHandle.doc().groups.g1).toBeUndefined();

    result.rollback();

    expect(calls).toEqual([
      "commit:group:g1:group-z",
      "rollback:group:g1:group-z",
    ]);
    expect(docHandle.doc().groups.g1).toEqual(deletedGroup);
  });

  test("CrdtService rollback preserves builder delete rollback callbacks", () => {
    const { docHandle } = createRealDocHandle({
      elements: {
        e1: createElement("e1"),
      },
    });
    const service = new CrdtService({ docHandle });
    const calls: string[] = [];

    const result = service.build()
      .deleteElement("e1", {
        onCommit: ({ id }) => calls.push(`commit:${id}`),
        onRollback: ({ id }) => calls.push(`rollback:${id}`),
      })
      .commit();

    result.rollback();

    expect(calls).toEqual(["commit:e1", "rollback:e1"]);
    expect(docHandle.doc().elements.e1).toEqual(createElement("e1"));
  });
});
