import type {
  TElement,
  TGroup,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { describe, expect, it, vi } from "vitest";
import { CanvasActiveSessionService } from "../../../src/services/active-session/CanvasActiveSessionService";
import type {
  TCanvasActiveSession,
  TCanvasActiveSessionDependencies,
} from "../../../src/services/active-session/typed";
import type {
  TCrdtChangeSummary,
  TCrdtEntityChangeSet,
} from "../../../src/services/crdt/CrdtService";
import { createElement, createGroup } from "../crdt/helpers";

function emptyChanges<TEntity>(): TCrdtEntityChangeSet<TEntity> {
  return {
    added: [],
    updated: [],
    deleted: [],
    changes: {},
  };
}

function summary(overrides: Partial<TCrdtChangeSummary> = {}): TCrdtChangeSummary {
  return {
    revision: 1,
    origin: "remote",
    fullReload: false,
    elements: emptyChanges<TElement>(),
    groups: emptyChanges<TGroup>(),
    ...overrides,
  };
}

function updated<TEntity extends TElement | TGroup>(
  id: string,
  before: TEntity,
  after: TEntity,
  changedFields: string[],
): TCrdtEntityChangeSet<TEntity> {
  return {
    added: [],
    updated: [id],
    deleted: [],
    changes: {
      [id]: {
        kind: "updated",
        before,
        after,
        changedFields,
      },
    },
  };
}

function deleted<TEntity extends TElement | TGroup>(
  id: string,
  before: TEntity,
): TCrdtEntityChangeSet<TEntity> {
  return {
    added: [],
    updated: [],
    deleted: [id],
    changes: {
      [id]: {
        kind: "deleted",
        before,
        after: null,
        changedFields: Object.keys(before),
      },
    },
  };
}

function session(args: {
  dependencies?: Partial<TCanvasActiveSessionDependencies>;
  rebase?: TCanvasActiveSession["rebase"];
}) {
  const cancel = vi.fn();
  const value: TCanvasActiveSession = {
    id: "session-1",
    kind: "transform",
    startedAtRevision: 0,
    dependencies: {
      elements: args.dependencies?.elements ?? {
        e1: ["x", "y", "rotation", "scaleX", "scaleY", "parentGroupId"],
      },
      groups: args.dependencies?.groups ?? {},
    },
    cancel,
    ...(args.rebase ? { rebase: args.rebase } : {}),
  };
  return { cancel, value };
}

describe("CanvasActiveSessionService", () => {
  it("continues for unrelated entities and non-dependent fields", () => {
    const service = new CanvasActiveSessionService();
    const active = session({});
    service.register(active.value);

    const before = createElement("e1", { style: { opacity: 1 } });
    const after = createElement("e1", { style: { opacity: 0.5 } });
    expect(service.handleChange(summary({
      elements: updated("e1", before, after, ["style"]),
    }))).toMatchObject({ action: "continue" });
    expect(active.cancel).not.toHaveBeenCalled();

    const otherBefore = createElement("e2", { x: 10 });
    const otherAfter = createElement("e2", { x: 20 });
    expect(service.handleChange(summary({
      revision: 2,
      elements: updated("e2", otherBefore, otherAfter, ["x"]),
    }))).toMatchObject({ action: "continue" });
  });

  it("cancels transform dependencies on geometry changes and deletion", () => {
    const service = new CanvasActiveSessionService();
    const active = session({});
    service.register(active.value);

    const before = createElement("e1", { x: 10 });
    const after = createElement("e1", { x: 20 });
    expect(service.handleChange(summary({
      elements: updated("e1", before, after, ["x"]),
    }))).toMatchObject({
      action: "cancel",
      reason: "remote-element-fields-changed",
    });
    expect(active.cancel).toHaveBeenCalledTimes(1);

    const next = session({});
    service.register(next.value);
    expect(service.handleChange(summary({
      revision: 2,
      elements: deleted("e1", after),
    }))).toMatchObject({
      action: "cancel",
      reason: "remote-element-deleted",
    });
    expect(next.cancel).toHaveBeenCalledTimes(1);
  });

  it("cancels on reparenting but permits order-only updates by default", () => {
    const service = new CanvasActiveSessionService();
    const active = session({});
    service.register(active.value);
    const before = createElement("e1", {
      parentGroupId: null,
      zIndex: "z1",
    });
    const reordered = createElement("e1", {
      parentGroupId: null,
      zIndex: "z2",
    });

    expect(service.handleChange(summary({
      elements: updated("e1", before, reordered, ["zIndex"]),
    }))).toMatchObject({ action: "continue" });

    const reparented = createElement("e1", {
      parentGroupId: "g1",
      zIndex: "z2",
    });
    expect(service.handleChange(summary({
      revision: 2,
      elements: updated("e1", reordered, reparented, ["parentGroupId"]),
    }))).toMatchObject({
      action: "cancel",
      reason: "remote-element-reparented",
    });
  });

  it("cancels text sessions when their data changes", () => {
    const service = new CanvasActiveSessionService();
    const textSession = session({
      dependencies: { elements: { text: ["data"] } },
    });
    service.register({
      ...textSession.value,
      kind: "text-edit",
    });
    const textBefore = createElement("text");
    const textAfter = createElement("text", {
      data: {
        ...createElement("text").data,
        text: "remote",
      },
    });
    expect(service.handleChange(summary({
      elements: updated("text", textBefore, textAfter, ["data"]),
    }))).toMatchObject({ action: "cancel" });
  });

  it("cancels dependent sessions for ancestor group deletion or reparenting", () => {
    const service = new CanvasActiveSessionService();
    const active = session({
      dependencies: {
        groups: { g1: ["parentGroupId"] },
      },
    });
    service.register(active.value);
    const before = createGroup("g1", { parentGroupId: null });
    const after = createGroup("g1", { parentGroupId: "g2" });

    expect(service.handleChange(summary({
      groups: updated("g1", before, after, ["parentGroupId"]),
    }))).toMatchObject({
      action: "cancel",
      reason: "remote-group-reparented",
    });

    const next = session({
      dependencies: { groups: { g1: ["*"] } },
    });
    service.register(next.value);
    expect(service.handleChange(summary({
      revision: 2,
      groups: deleted("g1", after),
    }))).toMatchObject({
      action: "cancel",
      reason: "remote-group-deleted",
    });
  });

  it("uses only explicit successful rebase handlers", () => {
    const service = new CanvasActiveSessionService();
    const rebase = vi.fn(() => true);
    const active = session({ rebase });
    service.register(active.value);
    const before = createElement("e1", { x: 10 });
    const after = createElement("e1", { x: 20 });

    expect(service.handleChange(summary({
      elements: updated("e1", before, after, ["x"]),
    }))).toMatchObject({
      action: "rebase",
      reason: "remote-element-fields-changed",
    });
    expect(service.active).toBe(active.value);
    expect(rebase).toHaveBeenCalledTimes(1);
    expect(active.cancel).not.toHaveBeenCalled();
  });

  it("ignores local projection acknowledgements and cancels idempotently", () => {
    const service = new CanvasActiveSessionService();
    const active = session({});
    const dispose = service.register(active.value);
    const before = createElement("e1", { x: 10 });
    const after = createElement("e1", { x: 20 });

    expect(service.handleChange(summary({
      origin: "local",
      elements: updated("e1", before, after, ["x"]),
    }))).toMatchObject({ action: "continue" });

    dispose();
    dispose();
    service.stop();
    expect(active.cancel).toHaveBeenCalledTimes(1);
  });

  it("cancels the previous session when replaced and supports clean completion", () => {
    const service = new CanvasActiveSessionService();
    const first = session({});
    const second = session({});
    second.value.id = "session-2";

    service.register(first.value);
    service.register(second.value);
    expect(first.cancel).toHaveBeenCalledWith(expect.objectContaining({
      reason: "replaced",
    }));
    expect(service.complete("session-2")).toBe(true);
    expect(second.cancel).not.toHaveBeenCalled();
    expect(service.active).toBeNull();
  });
});
