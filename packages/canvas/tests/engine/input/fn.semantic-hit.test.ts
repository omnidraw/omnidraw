import type { THitResult } from "@vibecanvas/canvas-engine";
import type {
  TCanvasDoc,
  TElement,
  TGroup,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { describe, expect, it } from "vitest";
import {
  fnResolveCanvasSemanticHit,
  fnResolveUniqueCanvasSemanticHits,
} from "../../../src/engine/input/fn.semantic-hit";
import { CanvasTransientTargetRegistry } from "../../../src/engine/input/CanvasTransientTargetRegistry";
import type { TCanvasProjectionIndex } from "../../../src/engine/typed";

function element(
  id: string,
  parentGroupId: string | null,
  locked = false,
): TElement {
  return {
    id,
    x: 0,
    y: 0,
    rotation: 0,
    zIndex: "z00000001",
    parentGroupId,
    bindings: [],
    locked,
    createdAt: 1,
    updatedAt: 1,
    data: {
      type: "rect",
      w: 100,
      h: 80,
    },
    style: {},
  };
}

function group(
  id: string,
  parentGroupId: string | null,
  locked = false,
): TGroup {
  return {
    id,
    parentGroupId,
    zIndex: "z00000001",
    locked,
    createdAt: 1,
  };
}

function document(): TCanvasDoc {
  return {
    id: "canvas",
    name: "Canvas",
    elements: {
      first: element("first", "child"),
      second: element("second", null),
      lockedElement: element("lockedElement", null, true),
      underLocked: element("underLocked", "lockedParent"),
    },
    groups: {
      root: group("root", null),
      child: group("child", "root"),
      lockedParent: group("lockedParent", null, true),
    },
  };
}

function index(): TCanvasProjectionIndex {
  return {
    elementNodeIds: {
      first: ["element:first", "element:first:render", "element:first:inline-text"],
      second: ["element:second"],
      lockedElement: ["element:locked"],
      underLocked: ["element:under-locked"],
    },
    groupNodeIds: {
      root: "group:root",
      child: "group:child",
      lockedParent: "group:locked-parent",
    },
    nodeTargets: {
      "element:first": { kind: "element", id: "first" },
      "element:first:render": { kind: "element", id: "first" },
      "element:first:inline-text": { kind: "element", id: "first" },
      "element:second": { kind: "element", id: "second" },
      "element:locked": { kind: "element", id: "lockedElement" },
      "element:under-locked": { kind: "element", id: "underLocked" },
      "group:root": { kind: "group", id: "root" },
      "group:child": { kind: "group", id: "child" },
      "group:locked-parent": { kind: "group", id: "lockedParent" },
    },
    elementResourceIds: {},
    elementPortalIds: {},
    elementSignatures: {},
    groupSignatures: {},
    activeProjectionSignature: "projection",
    lastAppliedRevision: 1,
  };
}

function hit(
  nodeId: string,
  overrides: Partial<THitResult> = {},
): THitResult {
  return {
    nodeId,
    path: [nodeId],
    worldPoint: { x: 12, y: 18 },
    localPoint: { x: 2, y: 3 },
    zOrder: 1,
    ...overrides,
  };
}

describe("fnResolveCanvasSemanticHit", () => {
  it("maps element roots, derived children, groups, and ancestor paths", () => {
    const root = fnResolveCanvasSemanticHit({
      hit: hit("element:first"),
      viewport: { x: 24, y: 36 },
      index: index(),
      document: document(),
    });
    expect(root).toMatchObject({
      target: { kind: "element", id: "first" },
      part: "body",
      groupAncestry: ["root", "child"],
      world: { x: 12, y: 18 },
      viewport: { x: 24, y: 36 },
    });

    const child = fnResolveCanvasSemanticHit({
      hit: hit("element:first:inline-text"),
      viewport: { x: 24, y: 36 },
      index: index(),
      document: document(),
    });
    expect(child?.part).toBe("inline-text");

    const groupHit = fnResolveCanvasSemanticHit({
      hit: hit("group:child"),
      viewport: { x: 24, y: 36 },
      index: index(),
      document: document(),
    });
    expect(groupHit).toMatchObject({
      target: { kind: "group", id: "child" },
      part: "frame",
      groupAncestry: ["root"],
    });

    const pathHit = fnResolveCanvasSemanticHit({
      hit: hit("unindexed:path", {
        path: [
          "layer:content",
          "group:root",
          "group:child",
          "element:first",
          "unindexed:path",
        ],
        part: "segment:2",
      }),
      viewport: { x: 24, y: 36 },
      index: index(),
      document: document(),
    });
    expect(pathHit).toMatchObject({
      target: { kind: "element", id: "first" },
      part: "connector-segment",
    });

    expect(fnResolveCanvasSemanticHit({
      hit: hit("element:first", { part: "start-marker" }),
      viewport: { x: 0, y: 0 },
      index: index(),
      document: document(),
    })?.part).toBe("connector-start");
    expect(fnResolveCanvasSemanticHit({
      hit: hit("element:first", { part: "resize:se" }),
      viewport: { x: 0, y: 0 },
      index: index(),
      document: document(),
    })?.part).toBe("resize-handle");
  });

  it("maps transient owners and semantic handles without inventing a target", () => {
    const transient = fnResolveCanvasSemanticHit({
      hit: hit("transient:vertex:1", {
        path: ["element:first", "transient:vertex:1"],
        transientOwnerId: "vc:transient:line-edit:session",
        part: "vertex:1",
      }),
      viewport: { x: 24, y: 36 },
      index: index(),
      document: document(),
    });
    expect(transient).toMatchObject({
      target: { kind: "element", id: "first" },
      part: { kind: "custom", value: "vertex:1" },
      transient: {
        ownerId: "vc:transient:line-edit:session",
        handleId: "vertex:1",
      },
    });

    expect(fnResolveCanvasSemanticHit({
      hit: hit("unknown", {
        path: ["layer:overlay", "unknown"],
        transientOwnerId: "owner",
      }),
      viewport: { x: 0, y: 0 },
      index: index(),
      document: document(),
    })).toBeNull();
    expect(fnResolveCanvasSemanticHit({
      hit: null,
      viewport: { x: 0, y: 0 },
      index: index(),
      document: document(),
    })).toBeNull();
  });

  it("resolves transient-only hits solely through an injected owner registry", () => {
    const registry = new CanvasTransientTargetRegistry();
    const release = registry.register(
      "vc:transient:line-edit:session",
      (query) => query.handleId === "vertex:1"
        ? { kind: "element", id: "first" }
        : null,
    );
    const transientOnly = hit("transient:vertex:1", {
      path: ["transient:root", "transient:vertex:1"],
      transientOwnerId: "vc:transient:line-edit:session",
      part: "vertex:1",
    });

    expect(fnResolveCanvasSemanticHit({
      hit: transientOnly,
      viewport: { x: 24, y: 36 },
      index: index(),
      document: document(),
      resolveTransientTarget: registry.resolve,
    })).toMatchObject({
      target: { kind: "element", id: "first" },
      groupAncestry: ["root", "child"],
      transient: {
        ownerId: "vc:transient:line-edit:session",
        handleId: "vertex:1",
      },
    });

    release();
    release();
    expect(fnResolveCanvasSemanticHit({
      hit: transientOnly,
      viewport: { x: 24, y: 36 },
      index: index(),
      document: document(),
      resolveTransientTarget: registry.resolve,
    })).toBeNull();
  });

  it("returns a miss for transient-only hits without an explicit resolver", () => {
    expect(fnResolveCanvasSemanticHit({
      hit: hit("transient:vertex:1", {
        path: ["transient:root", "transient:vertex:1"],
        transientOwnerId: "unregistered-owner",
        part: "vertex:1",
      }),
      viewport: { x: 0, y: 0 },
      index: index(),
      document: document(),
    })).toBeNull();
  });

  it("applies locked ancestry filtering to registry-resolved targets", () => {
    const registry = new CanvasTransientTargetRegistry();
    registry.register("owner", { kind: "element", id: "underLocked" });
    const transientOnly = hit("transient:handle", {
      path: ["transient:handle"],
      transientOwnerId: "owner",
      part: "resize:se",
    });
    expect(fnResolveCanvasSemanticHit({
      hit: transientOnly,
      viewport: { x: 0, y: 0 },
      index: index(),
      document: document(),
      resolveTransientTarget: registry.resolve,
    })).toBeNull();
    expect(fnResolveCanvasSemanticHit({
      hit: transientOnly,
      viewport: { x: 0, y: 0 },
      index: index(),
      document: document(),
      policy: { lockedTargets: "include" },
      resolveTransientTarget: registry.resolve,
    })?.target).toEqual({ kind: "element", id: "underLocked" });
  });

  it("excludes locked targets and locked ancestry by default", () => {
    for (const nodeId of ["element:locked", "element:under-locked"]) {
      expect(fnResolveCanvasSemanticHit({
        hit: hit(nodeId),
        viewport: { x: 0, y: 0 },
        index: index(),
        document: document(),
      })).toBeNull();
      expect(fnResolveCanvasSemanticHit({
        hit: hit(nodeId),
        viewport: { x: 0, y: 0 },
        index: index(),
        document: document(),
        policy: { lockedTargets: "include" },
      })?.target.kind).toBe("element");
    }
  });

  it("deduplicates semantic targets while preserving front-to-back order", () => {
    const hits = fnResolveUniqueCanvasSemanticHits({
      hits: [
        hit("element:first:render", { zOrder: 4 }),
        hit("element:first", { zOrder: 3 }),
        hit("element:second", { zOrder: 2 }),
        hit("unknown", { zOrder: 1 }),
      ],
      index: index(),
      document: document(),
      worldToViewport: (point) => ({
        x: point.x * 2,
        y: point.y * 2,
      }),
    });
    expect(hits.map((entry) => entry.target)).toEqual([
      { kind: "element", id: "first" },
      { kind: "element", id: "second" },
    ]);
    expect(hits[0]?.viewport).toEqual({ x: 24, y: 36 });
  });
});

describe("CanvasTransientTargetRegistry", () => {
  it("keeps replacement cleanup ownership-safe and clears mappings on destroy", () => {
    const registry = new CanvasTransientTargetRegistry();
    const query = {
      ownerId: "owner",
      nodeId: "transient:node",
      handleId: "handle",
      path: ["transient:node"],
    };
    const releaseFirst = registry.register("owner", {
      kind: "element",
      id: "first",
    });
    const releaseSecond = registry.register("owner", {
      kind: "element",
      id: "second",
    });
    releaseFirst();
    expect(registry.resolve(query)).toEqual({
      kind: "element",
      id: "second",
    });
    releaseSecond();
    expect(registry.resolve(query)).toBeNull();

    registry.register("owner", { kind: "element", id: "first" });
    registry.destroy();
    registry.destroy();
    expect(registry.resolve(query)).toBeNull();
    expect(() => registry.register("owner", {
      kind: "element",
      id: "first",
    })).toThrow("destroyed");
  });
});
