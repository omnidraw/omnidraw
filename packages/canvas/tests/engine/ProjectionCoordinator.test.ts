import { assertValidSceneSnapshot } from "@omnidraw/cangine/testing";
import type {
  TCanvasDoc,
  TElement,
  TGroup,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { getStroke } from "perfect-freehand";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  ProjectionCoordinator,
  type ICanvasProjectionRuntimePort,
  type TCanvasProjectionOwnershipArgs,
  type TCanvasProjectionPruneArgs,
  type TCanvasProjectionSceneApplyArgs,
} from "../../src/engine/ProjectionCoordinator";
import type {
  TCanvasProjectionTheme,
} from "../../src/engine/typed";
import type { ICanvasEngineOwnershipStage } from "../../src/engine/interface";
import {
  createBuiltInProjectionRegistry,
  createProjectionRegistry,
} from "../../src/engine/projection/ProjectionRegistry";
import { CanvasPortalOwnershipError } from "../../src/engine/portals/PortalOwnership";

const THEME: TCanvasProjectionTheme = {
  id: "coordinator-test",
  colors: {
    accent: "#dbeafe",
    accentForeground: "#1e3a8a",
    border: "#d6d3d1",
    canvasBackground: "rgba(168, 162, 158, 0.10)",
    canvasGridMajor: "rgba(71, 85, 105, 0.28)",
    canvasGridMinor: "rgba(71, 85, 105, 0.16)",
    canvasSelectionStroke: "#3b82f6",
    canvasText: "#000000",
    card: "#ffffff",
    destructive: "#dc2626",
    muted: "#e7e5e4",
    mutedForeground: "#57534e",
    ring: "#f59e0b",
    success: "#16a34a",
    warning: "#d97706",
  },
  colorTokens: {
    "@transparent": "transparent",
  },
};

function rect(id: string, parentGroupId: string | null = null): TElement {
  return {
    id,
    x: 10,
    y: 20,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    zIndex: "A",
    parentGroupId,
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    data: {
      type: "rect",
      w: 100,
      h: 80,
      radius: 4,
      text: null,
    },
    style: {
      backgroundColor: "#ffffff",
    },
  };
}

function group(id: string, parentGroupId: string | null = null): TGroup {
  return {
    id,
    parentGroupId,
    zIndex: "A",
    locked: false,
    createdAt: 1,
  };
}

function image(id: string): TElement {
  return {
    ...rect(id),
    data: {
      type: "image",
      url: "https://example.invalid/image.png",
      base64: null,
      w: 100,
      h: 80,
      crop: {
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        naturalWidth: 100,
        naturalHeight: 80,
      },
    },
  };
}

function widget(id: string): TElement {
  return {
    ...rect(id),
    data: {
      type: "ui-widget",
      kind: "test-widget",
      w: 320,
      h: 240,
      expanded: true,
    },
  };
}

function document(
  elements: readonly TElement[] = [],
  groups: readonly TGroup[] = [],
): TCanvasDoc {
  return {
    id: "coordinator-document",
    name: "Coordinator document",
    elements: Object.fromEntries(elements.map((element) => [element.id, element])),
    groups: Object.fromEntries(groups.map((group) => [group.id, group])),
  };
}

type TDeferred = {
  promise: Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
};

function deferred(): TDeferred {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class TestRuntime implements ICanvasProjectionRuntimePort {
  readonly ownershipArgs: TCanvasProjectionOwnershipArgs[] = [];
  readonly sceneArgs: TCanvasProjectionSceneApplyArgs[] = [];
  readonly events: string[] = [];
  readonly stages: ICanvasEngineOwnershipStage[] = [];
  applyGate: TDeferred | null = null;
  failRevision: number | null = null;

  stageOwnership(
    args: TCanvasProjectionOwnershipArgs,
  ): ICanvasEngineOwnershipStage {
    this.ownershipArgs.push(args);
    let state = "staged" as const;
    const stage: ICanvasEngineOwnershipStage = {
      label: `test:${args.revision}`,
      get state() {
        return state;
      },
      prepare: async () => {
        this.events.push(`prepare:${args.revision}`);
        state = "prepared";
      },
      commit: async () => {
        this.events.push(`commit:${args.revision}`);
        state = "committed";
      },
      rollback: async () => {
        this.events.push(`rollback:${args.revision}`);
        state = "rolled-back";
      },
    };
    this.stages.push(stage);
    return stage;
  }

  async applyScene(args: TCanvasProjectionSceneApplyArgs): Promise<void> {
    this.events.push(`apply:${args.revision}`);
    this.sceneArgs.push(args);
    if (this.applyGate !== null) {
      const gate = this.applyGate;
      this.applyGate = null;
      await gate.promise;
    }
    if (this.failRevision === args.revision) {
      throw new Error(`apply failed at ${args.revision}`);
    }
  }
}

class RecoverableOwnershipFailureRuntime extends TestRuntime {
  failPortalOnce = false;

  override async applyScene(args: TCanvasProjectionSceneApplyArgs): Promise<void> {
    const portalId = args.next.portals[0]?.portalId;
    if (this.failPortalOnce && portalId !== undefined) {
      this.failPortalOnce = false;
      throw new CanvasPortalOwnershipError(
        "PORTAL_REGISTRATION_FAILED",
        "synthetic portal failure",
        { portalId },
      );
    }
    await super.applyScene(args);
  }
}

function coordinator(
  runtime: ICanvasProjectionRuntimePort,
  onPruneSelectionAndFocus?: (args: TCanvasProjectionPruneArgs) => void,
): ProjectionCoordinator {
  return new ProjectionCoordinator({
    registry: createBuiltInProjectionRegistry(),
    theme: THEME,
    dependencies: { getStroke },
    runtime,
    ...(onPruneSelectionAndFocus === undefined
      ? {}
      : { onPruneSelectionAndFocus }),
  });
}

describe("ProjectionCoordinator", () => {
  it("hydrates the initial authoritative document with ownership before scene commit", async () => {
    const runtime = new TestRuntime();
    const subject = coordinator(runtime);

    const result = await subject.hydrateInitial(document([rect("one")]), 4);

    expect(result).toMatchObject({
      status: "applied",
      revision: 4,
      origin: "initial",
      mode: "replace",
    });
    expect(runtime.events).toEqual(["prepare:4", "apply:4", "commit:4"]);
    expect(runtime.sceneArgs[0]?.mode).toEqual({
      kind: "replace",
      reason: "initial",
    });
    expect(subject.lastAppliedRevision).toBe(4);
    expect(subject.projectionIndex?.elementNodeIds.one).toHaveLength(2);
  });

  it.each(["local", "remote"] as const)(
    "uses the same queued projection path for a %s update",
    async (origin) => {
      const runtime = new TestRuntime();
      const subject = coordinator(runtime);
      await subject.hydrateInitial(document([rect("one")]), 1);

      const changed = document([{ ...rect("one"), x: 80, updatedAt: 2 }]);
      const result = await subject.enqueue({
        document: changed,
        revision: 2,
        origin,
      });

      expect(result).toMatchObject({
        status: "applied",
        revision: 2,
        origin,
        mode: "diff",
      });
      const apply = runtime.sceneArgs[1];
      expect(apply?.mode.kind).toBe("diff");
      if (apply?.mode.kind === "diff") {
        expect(apply.mode.diff.elements.updated).toEqual(["one"]);
        expect(apply.mode.diff.nodes.updated.length).toBeGreaterThan(0);
      }
    },
  );

  it("reprojects only changed elements when a CRDT summary is available", async () => {
    const runtime = new TestRuntime();
    const projectedElementIds: string[] = [];
    const builtIns = createBuiltInProjectionRegistry();
    const registry = createProjectionRegistry(builtIns.definitions.map((definition) => ({
      ...definition,
      project: (args) => {
        projectedElementIds.push(args.element.id);
        return definition.project(args);
      },
    })));
    const subject = new ProjectionCoordinator({
      registry,
      theme: THEME,
      dependencies: { getStroke },
      runtime,
    });
    await subject.hydrateInitial(
      document([rect("one"), rect("two"), rect("three")]),
      1,
    );
    projectedElementIds.length = 0;

    const result = await subject.enqueue({
      document: document([
        rect("one"),
        { ...rect("two"), x: 90, updatedAt: 2 },
        rect("three"),
      ]),
      revision: 2,
      origin: "remote",
      changes: {
        elements: {
          added: [],
          updated: ["two"],
          deleted: [],
        },
        groups: {
          added: [],
          updated: [],
          deleted: [],
        },
      },
    });

    expect(result.status).toBe("applied");
    expect(projectedElementIds).toEqual(["two"]);
    expect(runtime.sceneArgs[1]?.mode.kind).toBe("diff");
  });

  it("bounds ordinary element and structural group updates with deterministic work counters", async () => {
    const runtime = new TestRuntime();
    const subject = coordinator(runtime);
    await subject.hydrateInitial(
      document(
        [rect("one", "child"), rect("unrelated")],
        [group("left"), group("right"), group("child", "left")],
      ),
      1,
    );

    const elementResult = await subject.enqueue({
      document: document(
        [{ ...rect("one", "child"), x: 33, updatedAt: 2 }, rect("unrelated")],
        [group("left"), group("right"), group("child", "left")],
      ),
      revision: 2,
      origin: "local",
      changes: {
        elements: { added: [], updated: ["one"], deleted: [] },
        groups: { added: [], updated: [], deleted: [] },
      },
    });
    const groupResult = await subject.enqueue({
      document: document(
        [{ ...rect("one", "child"), x: 33, updatedAt: 2 }, rect("unrelated")],
        [group("left"), group("right"), group("child", "right")],
      ),
      revision: 3,
      origin: "remote",
      changes: {
        elements: { added: [], updated: [], deleted: [] },
        groups: { added: [], updated: ["child"], deleted: [] },
      },
    });
    const groupAddResult = await subject.enqueue({
      document: document(
        [
          { ...rect("one", "grandchild"), x: 33, updatedAt: 3 },
          rect("unrelated"),
        ],
        [
          group("left"),
          group("right"),
          group("child", "right"),
          group("grandchild", "child"),
        ],
      ),
      revision: 4,
      origin: "local",
      changes: {
        elements: { added: [], updated: ["one"], deleted: [] },
        groups: { added: ["grandchild"], updated: [], deleted: [] },
      },
    });
    const groupDeleteResult = await subject.enqueue({
      document: document(
        [{ ...rect("one", "child"), x: 33, updatedAt: 4 }, rect("unrelated")],
        [group("left"), group("right"), group("child", "right")],
      ),
      revision: 5,
      origin: "remote",
      changes: {
        elements: { added: [], updated: ["one"], deleted: [] },
        groups: { added: [], updated: [], deleted: ["grandchild"] },
      },
    });

    expect(elementResult).toMatchObject({
      status: "applied",
      work: {
        collectionCopies: 0,
        collectionScans: 0,
        projectedRoots: 1,
        projectedNodes: 2,
        recoveryPasses: 0,
        invariantFallbacks: 0,
      },
    });
    expect(groupResult).toMatchObject({
      status: "applied",
      work: {
        collectionCopies: 0,
        collectionScans: 0,
        projectedRoots: 1,
        projectedNodes: 1,
        recoveryPasses: 0,
        invariantFallbacks: 0,
      },
    });
    expect(groupAddResult).toMatchObject({
      status: "applied",
      work: {
        collectionCopies: 0,
        collectionScans: 0,
        projectedRoots: 2,
        projectedNodes: 3,
        recoveryPasses: 0,
        invariantFallbacks: 0,
      },
    });
    expect(groupDeleteResult).toMatchObject({
      status: "applied",
      work: {
        collectionCopies: 0,
        collectionScans: 0,
        projectedRoots: 1,
        projectedNodes: 2,
        recoveryPasses: 0,
        invariantFallbacks: 0,
      },
    });
    expect(runtime.sceneArgs[2]?.mode).toMatchObject({
      kind: "diff",
      diff: {
        groups: { added: [], updated: ["child"], removed: [] },
      },
    });
    expect(runtime.sceneArgs[3]?.mode).toMatchObject({
      kind: "diff",
      diff: {
        groups: { added: ["grandchild"], updated: [], removed: [] },
      },
    });
    expect(() => assertValidSceneSnapshot(
      runtime.sceneArgs[3]!.next.snapshot,
    )).not.toThrow();
    expect(runtime.sceneArgs[4]?.mode).toMatchObject({
      kind: "diff",
      diff: {
        groups: { added: [], updated: [], removed: ["grandchild"] },
      },
    });
    const published = subject.lastGoodProjection!;
    const firstNode = published.snapshot.nodes[0];
    expect(Array.isArray(published.snapshot.nodes)).toBe(true);
    expect(() => assertValidSceneSnapshot(published.snapshot)).not.toThrow();
    expect(JSON.parse(JSON.stringify(published))).toEqual(published);
    expect(Reflect.set(
      published.snapshot.nodes,
      "0",
      published.snapshot.nodes[1],
    )).toBe(false);
    expect(published.snapshot.nodes[0]).toBe(firstNode);
  });

  it("applies incremental add, update, delete, and reparent diffs without scene replacement", async () => {
    const runtime = new TestRuntime();
    const subject = coordinator(runtime);
    await subject.hydrateInitial(
      document([rect("one")], [group("left"), group("right")]),
      1,
    );

    await subject.enqueue({
      document: document(
        [rect("one", "left"), rect("two", "right")],
        [group("left"), group("right")],
      ),
      revision: 2,
      origin: "remote",
    });
    await subject.enqueue({
      document: document(
        [{ ...rect("one", "right"), x: 55, updatedAt: 2 }],
        [group("left"), group("right")],
      ),
      revision: 3,
      origin: "local",
    });

    const add = runtime.sceneArgs[1];
    const updateDeleteReparent = runtime.sceneArgs[2];
    expect(add?.mode.kind).toBe("diff");
    expect(updateDeleteReparent?.mode.kind).toBe("diff");
    if (add?.mode.kind === "diff") {
      expect(add.mode.diff.elements.added).toEqual(["two"]);
      expect(add.mode.diff.elements.updated).toEqual(["one"]);
    }
    if (updateDeleteReparent?.mode.kind === "diff") {
      expect(updateDeleteReparent.mode.diff.elements.removed).toEqual(["two"]);
      expect(updateDeleteReparent.mode.diff.elements.updated).toEqual(["one"]);
      expect(updateDeleteReparent.mode.diff.nodes.removed.length).toBeGreaterThan(0);
      expect(updateDeleteReparent.mode.diff.nodes.updated.length).toBeGreaterThan(0);
    }
    expect(runtime.sceneArgs.filter((args) => args.mode.kind === "replace")).toHaveLength(1);
  });

  it("advances a no-op revision without creating ownership or scene work", async () => {
    const runtime = new TestRuntime();
    const subject = coordinator(runtime);
    const snapshot = document([rect("one")]);
    await subject.hydrateInitial(snapshot, 1);

    const result = await subject.enqueue({
      document: snapshot,
      revision: 2,
      origin: "remote",
    });

    expect(result.status).toBe("noop");
    expect(runtime.sceneArgs).toHaveLength(1);
    expect(runtime.ownershipArgs).toHaveLength(1);
    expect(subject.lastAppliedRevision).toBe(2);
  });

  it("carries incremental resource and portal changes through the ownership diff", async () => {
    const runtime = new TestRuntime();
    const subject = coordinator(runtime);
    await subject.hydrateInitial(document(), 1);

    await subject.enqueue({
      document: document([image("image"), widget("widget")]),
      revision: 2,
      origin: "remote",
    });
    await subject.enqueue({
      document: document(),
      revision: 3,
      origin: "local",
    });

    expect(runtime.ownershipArgs[1]?.diff?.resources.added).toHaveLength(1);
    expect(runtime.ownershipArgs[1]?.diff?.portals.added).toHaveLength(1);
    expect(runtime.ownershipArgs[2]?.diff?.resources.removed).toHaveLength(1);
    expect(runtime.ownershipArgs[2]?.diff?.portals.removed).toHaveLength(1);
  });

  it("commits the existing visible placeholder projection when a projector fails", async () => {
    const runtime = new TestRuntime();
    const subject = new ProjectionCoordinator({
      registry: createProjectionRegistry([{
        id: "test.throwing",
        priority: 1,
        matchesElement: () => true,
        project: () => {
          throw new Error("projector exploded");
        },
      }]),
      theme: THEME,
      dependencies: { getStroke },
      runtime,
    });

    const result = await subject.hydrateInitial(document([rect("one")]), 1);

    expect(result.status).toBe("applied");
    expect(subject.lastGoodProjection?.diagnostics).toEqual([
      expect.objectContaining({
        code: "PROJECTOR_EXCEPTION",
        projectorId: "test.throwing",
        target: { kind: "element", id: "one" },
      }),
    ]);
    expect(subject.lastGoodProjection?.index.elementNodeIds.one.length).toBeGreaterThan(1);
    expect(subject.lastGoodProjection?.snapshot.nodes.some((node) => {
      return node.id.includes("placeholder");
    })).toBe(true);
  });

  it(
    "retries a portal registration failure as a visible per-element placeholder",
    async () => {
      const runtime = new RecoverableOwnershipFailureRuntime();
      runtime.failPortalOnce = true;
      const subject = coordinator(runtime);
      const element = widget("widget");

      const result = await subject.hydrateInitial(document([element]), 1);

      expect(result.status).toBe("applied");
      if (result.status === "applied") {
        expect(result.work.recoveryPasses).toBe(1);
      }
      expect(runtime.ownershipArgs).toHaveLength(2);
      expect(subject.lastGoodProjection?.diagnostics).toEqual([
        expect.objectContaining({
          code: "PORTAL_REGISTRATION_FAILED",
          target: { kind: "element", id: element.id },
        }),
      ]);
      expect(subject.lastGoodProjection?.snapshot.nodes.some((node) => {
        return node.id.includes("placeholder");
      })).toBe(true);
      expect(subject.lastGoodProjection?.resources).toEqual([]);
      expect(subject.lastGoodProjection?.portals).toEqual([]);
      expect(subject.lastGoodProjection?.index.elementNodeIds[element.id])
        .toHaveLength(3);
    },
  );

  it("rolls back ownership, retains last-good projection, and continues newer queued revisions", async () => {
    const runtime = new TestRuntime();
    const subject = coordinator(runtime);
    await subject.hydrateInitial(document([rect("one")]), 1);
    const firstSignature = subject.lastGoodProjection?.signature;
    runtime.failRevision = 2;

    const failed = subject.enqueue({
      document: document([{ ...rect("one"), x: 22, updatedAt: 2 }]),
      revision: 2,
      origin: "remote",
    });
    const queued = subject.enqueue({
      document: document([{ ...rect("one"), x: 33, updatedAt: 3 }]),
      revision: 3,
      origin: "local",
    });

    await expect(failed).resolves.toMatchObject({ status: "failed", revision: 2 });
    runtime.failRevision = null;
    await expect(queued).resolves.toMatchObject({ status: "applied", revision: 3 });
    expect(runtime.events).toContain("rollback:2");
    expect(subject.lastAppliedRevision).toBe(3);
    expect(subject.lastGoodProjection?.signature).not.toBe(firstSignature);
    const revisionThree = runtime.sceneArgs.find((args) => args.revision === 3);
    expect(revisionThree?.previous?.index.lastAppliedRevision).toBe(1);
  });

  it("serializes queued revisions and rejects stale or reordered input", async () => {
    const runtime = new TestRuntime();
    const gate = deferred();
    runtime.applyGate = gate;
    const subject = coordinator(runtime);
    const initial = subject.hydrateInitial(document([rect("one")]), 1);
    const second = subject.enqueue({
      document: document([{ ...rect("one"), x: 2 }]),
      revision: 2,
      origin: "local",
    });
    const stale = subject.enqueue({
      document: document([{ ...rect("one"), x: 99 }]),
      revision: 1,
      origin: "remote",
    });

    await expect(stale).resolves.toMatchObject({
      status: "rejected",
      reason: "stale-revision",
    });
    expect(runtime.sceneArgs.map((args) => args.revision)).toEqual([1]);
    gate.resolve();
    await initial;
    await second;
    expect(runtime.sceneArgs.map((args) => args.revision)).toEqual([1, 2]);
  });

  it("bounds an explicit full reload to one queued replacement and resumes incremental diffs", async () => {
    const runtime = new TestRuntime();
    const subject = coordinator(runtime);
    await subject.hydrateInitial(document([rect("one")]), 1);

    await subject.enqueue({
      document: document([rect("one"), rect("two")]),
      revision: 2,
      origin: "remote",
      fullReload: true,
    });
    await subject.enqueue({
      document: document([rect("one"), { ...rect("two"), x: 40 }]),
      revision: 3,
      origin: "remote",
    });

    expect(runtime.sceneArgs[1]?.mode).toEqual({
      kind: "replace",
      reason: "full-reload",
    });
    expect(runtime.sceneArgs[2]?.mode.kind).toBe("diff");
    expect(runtime.sceneArgs.filter((args) => {
      return args.mode.kind === "replace" && args.mode.reason === "full-reload";
    })).toHaveLength(1);
  });

  it("prunes selection and focus after every successful projected revision", async () => {
    const runtime = new TestRuntime();
    const prune = vi.fn<(args: TCanvasProjectionPruneArgs) => void>();
    const subject = coordinator(runtime, prune);
    await subject.hydrateInitial(
      document([rect("one")], [group("container")]),
      1,
    );
    await subject.enqueue({
      document: document(),
      revision: 2,
      origin: "remote",
    });

    expect(prune).toHaveBeenCalledTimes(2);
    expect([...prune.mock.calls[0]![0].elementIds]).toEqual(["one"]);
    expect([...prune.mock.calls[0]![0].groupIds]).toEqual(["container"]);
    expect([...prune.mock.calls[1]![0].elementIds]).toEqual([]);
    expect(runtime.events.slice(-3)).toEqual(["prepare:2", "apply:2", "commit:2"]);
  });

  it("stops idempotently, drains queued work, and ignores stale async completion", async () => {
    const runtime = new TestRuntime();
    const gate = deferred();
    runtime.applyGate = gate;
    const prune = vi.fn<(args: TCanvasProjectionPruneArgs) => void>();
    const subject = coordinator(runtime, prune);
    const initial = subject.hydrateInitial(document([rect("one")]), 1);
    const queued = subject.enqueue({
      document: document([rect("one"), rect("two")]),
      revision: 2,
      origin: "remote",
    });

    subject.stop();
    subject.dispose();
    await expect(queued).resolves.toMatchObject({
      status: "rejected",
      reason: "disposed",
    });
    gate.resolve();
    await expect(initial).resolves.toMatchObject({
      status: "rejected",
      reason: "disposed",
    });
    expect(subject.lastGoodProjection).toBeNull();
    expect(prune).not.toHaveBeenCalled();
    expect(runtime.events).toContain("rollback:1");
    await expect(subject.enqueue({
      document: document(),
      revision: 3,
      origin: "local",
    })).resolves.toMatchObject({
      status: "rejected",
      reason: "disposed",
    });
  });
});
