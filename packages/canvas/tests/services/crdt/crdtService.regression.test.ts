import { describe, expect, test } from "vitest";
import { CrdtService } from "../../../src/services/crdt/CrdtService";
import { createElement, createGroup, createRealDocHandle } from "./helpers";

function createStartedService(overrides?: Parameters<typeof createRealDocHandle>[0]) {
  const { docHandle } = createRealDocHandle(overrides);
  const service = new CrdtService({ docHandle });
  const localFlags: boolean[] = [];

  service.hooks.change.tap(() => {
    localFlags.push(service.consumePendingLocalChangeEvent());
  });
  service.start();

  return {
    docHandle,
    service,
    localFlags,
  };
}

describe("CrdtService regressions", () => {
  test("builder commit with full element replacement does not throw clone errors", () => {
    const { service, docHandle } = createStartedService({
      elements: {
        e1: createElement("e1"),
      },
    });

    expect(() => {
      const builder = service.build();
      builder.patchElement("e1", createElement("e1", { x: 300, data: { ...createElement("e1").data, text: "next" } }));
      builder.commit();
    }).not.toThrow();

    expect(docHandle.doc().elements.e1.x).toBe(300);
    expect(docHandle.doc().elements.e1.data.text).toBe("next");
  });

  test("builder commit with full group replacement does not throw clone errors", () => {
    const { service, docHandle } = createStartedService({
      groups: {
        g1: createGroup("g1"),
      },
    });

    expect(() => {
      const builder = service.build();
      builder.patchGroup("g1", createGroup("g1", { zIndex: "g-new", locked: true }));
      builder.commit();
    }).not.toThrow();

    expect(docHandle.doc().groups.g1.zIndex).toBe("g-new");
    expect(docHandle.doc().groups.g1.locked).toBe(true);
  });

  test("builder commit can replace nested element data object on a real automerge handle", () => {
    const { service, docHandle } = createStartedService({
      elements: {
        e1: createElement("e1"),
      },
    });

    const builder = service.build();
    builder.patchElement("e1", "data", {
      ...createElement("e1").data,
      text: "nested-replace",
      originalText: "nested-replace",
    });
    builder.commit();

    expect(docHandle.doc().elements.e1.data.text).toBe("nested-replace");
    expect(docHandle.doc().elements.e1.data.originalText).toBe("nested-replace");
  });

  test("builder commit marks its change as local for hydrator-style consumers", () => {
    const { service, localFlags } = createStartedService();

    const builder = service.build();
    builder.patchElement("e1", createElement("e1"));
    builder.commit();

    expect(localFlags).toEqual([true]);
  });

  test("builder rollback marks its change as local", () => {
    const { service, localFlags, docHandle } = createStartedService();

    const result = service.build()
      .patchElement("e1", createElement("e1"))
      .commit();

    localFlags.length = 0;
    result.rollback();

    expect(localFlags).toEqual([true]);
    expect(docHandle.doc().elements.e1).toBeUndefined();
  });

  test("applyOps marks replayed changes as local", () => {
    const { service, localFlags, docHandle } = createStartedService();

    const commitResult = service.build()
      .patchElement("e1", createElement("e1", { x: 88 }))
      .commit();

    commitResult.rollback();
    localFlags.length = 0;

    service.applyOps({ ops: commitResult.redoOps });

    expect(localFlags).toEqual([true]);
    expect(docHandle.doc().elements.e1.x).toBe(88);
  });

  test("remote docHandle changes are not marked local", () => {
    const { service, localFlags, docHandle } = createStartedService();

    docHandle.change((doc) => {
      doc.elements.e1 = createElement("e1");
    });

    expect(localFlags).toEqual([false]);
    expect(service.consumePendingLocalChangeEvent()).toBe(false);
  });

  test("two builder commits produce two independent local change marks", () => {
    const { service, localFlags } = createStartedService();

    service.build()
      .patchElement("e1", createElement("e1"))
      .commit();

    service.build()
      .patchElement("e2", createElement("e2"))
      .commit();

    expect(localFlags).toEqual([true, true]);
  });
});
