import { describe, expect, test } from "vitest";
import {
  CrdtService,
  type TCrdtChangeSummary,
} from "../../../src/services/crdt/CrdtService";
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

  test("remote origin does not depend on consuming the legacy local marker", () => {
    const { docHandle } = createRealDocHandle();
    const service = new CrdtService({ docHandle });
    const summaries: TCrdtChangeSummary[] = [];
    service.hooks.change.tap((summary) => summaries.push(summary));
    service.start();

    service.build()
      .patchElement("e1", createElement("e1"))
      .commit();
    docHandle.change((doc) => {
      doc.elements.e2 = createElement("e2");
    });

    expect(summaries.map((summary) => summary.origin)).toEqual([
      "local",
      "remote",
    ]);
  });

  test("a failed local write leaves no stale origin or compatibility marker", () => {
    const { service, docHandle } = createStartedService();
    const summaries: TCrdtChangeSummary[] = [];
    service.hooks.change.tap((summary) => summaries.push(summary));

    expect(() => {
      service.build()
        .patchElement("missing", "x", 10)
        .commit();
    }).toThrow();

    docHandle.change((doc) => {
      doc.elements.e1 = createElement("e1");
    });

    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.origin).toBe("remote");
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

  test("emits monotonic bounded entity snapshots and changed fields", () => {
    const { service, docHandle } = createStartedService({
      elements: {
        e1: createElement("e1", { x: 10 }),
      },
      groups: {
        g1: createGroup("g1", { parentGroupId: null }),
      },
    });
    const summaries: TCrdtChangeSummary[] = [];
    service.hooks.change.tap((summary) => summaries.push(summary));

    service.build()
      .patchElement("e1", "x", 25)
      .commit();
    docHandle.change((doc) => {
      doc.groups.g1.parentGroupId = "g2";
    });
    docHandle.change((doc) => {
      delete doc.elements.e1;
    });

    expect(summaries.map(({ revision, origin }) => ({
      revision,
      origin,
    }))).toEqual([
      { revision: 1, origin: "local" },
      { revision: 2, origin: "remote" },
      { revision: 3, origin: "remote" },
    ]);
    expect(summaries[0]?.elements.changes.e1).toEqual({
      kind: "updated",
      before: expect.objectContaining({ id: "e1", x: 10 }),
      after: expect.objectContaining({ id: "e1", x: 25 }),
      changedFields: ["x"],
    });
    expect(summaries[1]?.groups.changes.g1).toEqual({
      kind: "updated",
      before: expect.objectContaining({
        id: "g1",
        parentGroupId: null,
      }),
      after: expect.objectContaining({
        id: "g1",
        parentGroupId: "g2",
      }),
      changedFields: ["parentGroupId"],
    });
    expect(summaries[2]?.elements.changes.e1).toEqual({
      kind: "deleted",
      before: expect.objectContaining({ id: "e1", x: 25 }),
      after: null,
      changedFields: expect.arrayContaining([
        "data",
        "id",
        "style",
        "x",
      ]),
    });
    expect(service.revision).toBe(3);
  });
});
