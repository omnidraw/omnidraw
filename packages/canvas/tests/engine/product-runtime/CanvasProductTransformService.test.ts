import type {
  ISceneStore,
  ITransformController,
  TNodeTransformProposal,
  TSceneNode,
  TTransformGestureEvent,
} from "@omnidraw/cangine";
import { describe, expect, it, vi } from "vitest";
import { CanvasProductTransformService } from "../../../src/engine/product-runtime/CanvasProductTransformService";
import type { TCanvasProductRuntimeEnginePorts } from "../../../src/engine/product-runtime/interface";
import type {
  TCanvasDurableHandoff,
  TCanvasProductSelection,
  TCanvasProductTransformEvent,
} from "../../../src/engine/product-runtime/typed";
import type { TCanvasProjectionIndex } from "../../../src/engine/typed";

const IDENTITY = {
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  skew: { x: 0, y: 0 },
  origin: { x: 0, y: 0 },
};

function projectionIndex(): TCanvasProjectionIndex {
  return {
    elementNodeIds: {
      first: ["node:first", "node:first:render"],
    },
    groupNodeIds: {},
    nodeTargets: {
      "node:first": { kind: "element", id: "first" },
      "node:first:render": { kind: "element", id: "first" },
    },
    elementResourceIds: {},
    elementPortalIds: {},
    elementSignatures: {},
    groupSignatures: {},
    activeProjectionSignature: "projection",
    lastAppliedRevision: 1,
  };
}

function sceneNodes(renderKind: "rect" | "widget-frame" = "rect"): TSceneNode[] {
  const nodes: TSceneNode[] = [
    {
      id: "node:first",
      parentId: "content",
      orderKey: "A",
      kind: "group",
      transform: IDENTITY,
      metadata: { product: "first" },
    },
    {
      id: "node:first:render",
      parentId: "node:first",
      orderKey: "A",
      kind: "rect",
      transform: IDENTITY,
      size: { width: 100, height: 80 },
      fill: {
        type: "solid",
        color: { space: "srgb", r: 1, g: 1, b: 1, a: 1 },
      },
    },
  ];
  if (renderKind === "widget-frame") {
    nodes[1] = {
      ...nodes[1]!,
      kind: "widget-frame",
      title: "Widget",
      style: {
        background: {
          type: "solid",
          color: { space: "srgb", r: 1, g: 1, b: 1, a: 1 },
        },
        titleBarBackground: {
          type: "solid",
          color: { space: "srgb", r: 0, g: 0, b: 0, a: 1 },
        },
        titleColor: { space: "srgb", r: 1, g: 1, b: 1, a: 1 },
        cornerRadius: 8,
        titleBarHeight: 28,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      },
    } as TSceneNode;
  }
  return nodes;
}

function proposal(): TNodeTransformProposal {
  return {
    nodeId: "node:first",
    previousTransform: IDENTITY,
    nextTransform: {
      ...IDENTITY,
      position: { x: 40, y: 20 },
    },
  };
}

function gesture(
  type: TTransformGestureEvent["type"],
): TTransformGestureEvent {
  return {
    type,
    gestureId: "gesture-1",
    handle: "move",
    pointerId: 3,
    proposals: [proposal()],
    worldPointer: { x: 40, y: 20 },
    modifiers: { alt: false, ctrl: true, meta: false, shift: true },
  };
}

function harness(renderKind: "rect" | "widget-frame" = "rect") {
  let listener: ((event: TTransformGestureEvent) => void) | null = null;
  const unsubscribe = vi.fn();
  const transforms = {
    subscribe: vi.fn((next: (event: TTransformGestureEvent) => void) => {
      listener = next;
      return unsubscribe;
    }),
    setSelection: vi.fn(),
    setPolicy: vi.fn(),
    applyPreview: vi.fn(),
    clearPreview: vi.fn(),
    cancelActiveGesture: vi.fn(),
  } as unknown as ITransformController;
  const nodes = sceneNodes(renderKind);
  const scene = {
    get: vi.fn((nodeId: string) => {
      return nodes.find((node) => node.id === nodeId) ?? null;
    }),
    childrenOf: vi.fn((parentId: string | null) => {
      return nodes.filter((node) => node.parentId === parentId);
    }),
  } as unknown as ISceneStore;
  const transients = {
    cloneFromScene: vi.fn((options: {
      sourceNodeIds: readonly string[];
      mapId(sourceNodeId: string): string;
      transform?: readonly number[];
      replaceOwnerId?: string;
    }) => {
      const included = nodes.filter((node) => {
        return options.sourceNodeIds.includes(node.id)
          || options.sourceNodeIds.includes(node.parentId ?? "");
      });
      const idMap = new Map(
        included.map((node) => [node.id, options.mapId(node.id)]),
      );
      return {
        projection: {
          band: "world-overlay" as const,
          hitTest: "none" as const,
          nodes: included.map((node) => {
            const {
              accessibility: _accessibility,
              extensions: _extensions,
              metadata: _metadata,
              ...projected
            } = node;
            return {
              ...projected,
              id: idMap.get(node.id)!,
              parentId: node.parentId === null
                ? null
                : idMap.get(node.parentId) ?? null,
              ...(options.sourceNodeIds.includes(node.id)
                && options.transform !== undefined
                ? {
                    transform: {
                      ...node.transform,
                      position: {
                        x: options.transform[6] ?? 0,
                        y: options.transform[7] ?? 0,
                      },
                    },
                  }
                : {}),
            };
          }),
        },
        rootIds: options.sourceNodeIds.map((id) => idMap.get(id)!),
        idMap,
      };
    }),
    sync: vi.fn(),
    release: vi.fn(),
  };
  const geometry = {
    worldTransform: vi.fn(() => [1, 0, 0, 0, 1, 0, 0, 0, 1]),
  };
  const diagnostics = vi.fn();
  const service = new CanvasProductTransformService({
    transforms,
    geometry,
    scene,
    transients,
    getProjectionIndex: projectionIndex,
    onDiagnostic: diagnostics,
  } as unknown as TCanvasProductRuntimeEnginePorts);
  return {
    service,
    transforms,
    transients,
    diagnostics,
    unsubscribe,
    emit(event: TTransformGestureEvent) {
      listener?.(event);
    },
  };
}

function selection(): TCanvasProductSelection {
  return {
    targets: [{ kind: "element", id: "first" }],
    focused: { kind: "element", id: "first" },
    appearance: {
      outline: {
        color: { r: 0, g: 0.5, b: 1, a: 1 },
        width: 2,
      },
      handleFill: { r: 1, g: 1, b: 1, a: 1 },
      handleStroke: {
        color: { r: 0, g: 0.5, b: 1, a: 1 },
        width: 1,
      },
      handleSize: 8,
      rotateHandleOffset: 20,
    },
    policy: {
      handles: ["move", "resize-se"],
    },
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("CanvasProductTransformService", () => {
  it("maps semantic selection and product previews without exposing node IDs", () => {
    const { service, transforms } = harness();
    service.setSelection(selection());
    expect(transforms.setSelection).toHaveBeenCalledWith(expect.objectContaining({
      nodeIds: ["node:first"],
      focusedNodeId: "node:first",
      policy: expect.objectContaining({
        handles: ["move", "resize-se"],
        previewMode: "ephemeral-engine-preview",
      }),
    }));

    service.applyPreview([{
      target: { kind: "element", id: "first" },
      previousTransform: {
        position: { x: 0, y: 0 },
        rotationRadians: 0,
        scale: { x: 1, y: 1 },
        skew: { x: 0, y: 0 },
        origin: { x: 0, y: 0 },
      },
      nextTransform: {
        position: { x: 10, y: 12 },
        rotationRadians: Math.PI / 2,
        scale: { x: 1, y: 1 },
        skew: { x: 0, y: 0 },
        origin: { x: 0, y: 0 },
      },
    }]);
    expect(transforms.applyPreview).toHaveBeenCalledWith([
      expect.objectContaining({
        nodeId: "node:first",
        nextTransform: expect.objectContaining({
          position: { x: 10, y: 12 },
          rotation: Math.PI / 2,
        }),
      }),
    ]);
    service.clearPreview();
    service.cancel();
    expect(transforms.clearPreview).toHaveBeenCalledTimes(1);
    expect(transforms.cancelActiveGesture).toHaveBeenCalledTimes(1);
  });

  it("selects the sized widget frame so resize proposals carry dimensions", () => {
    const { service, transforms } = harness("widget-frame");

    service.setSelection(selection());

    expect(transforms.setSelection).toHaveBeenCalledWith(expect.objectContaining({
      nodeIds: ["node:first:render"],
      focusedNodeId: "node:first:render",
    }));
  });

  it("renders Alt-move as a clone transient and restores the durable original", () => {
    const { emit, service, transforms, transients } = harness();
    const prepare = vi.fn(() => ({
      elements: [{ sourceId: "first", cloneId: "clone-first" }],
      groups: [],
      selection: [{ kind: "element" as const, id: "clone-first" }],
    }));
    const discard = vi.fn();
    service.setClonePlanProvider({ prepare, discard });
    service.setSelection(selection());
    const altModifiers = {
      alt: true,
      ctrl: false,
      meta: false,
      shift: false,
    };

    emit({
      ...gesture("transform-begin"),
      modifiers: altModifiers,
    });
    emit({
      ...gesture("transform-update"),
      modifiers: altModifiers,
    });

    expect(transforms.clearPreview).toHaveBeenCalledTimes(2);
    expect(transients.sync).toHaveBeenLastCalledWith(
      "vc:transient:alt-clone:gesture-1",
      expect.objectContaining({
        band: "world-overlay",
        hitTest: "none",
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: "vc:element:u-clone-first",
            transform: expect.objectContaining({
              position: { x: 40, y: 20 },
            }),
          }),
        ]),
      }),
    );
    expect(transients.cloneFromScene).toHaveBeenNthCalledWith(
      1,
      expect.not.objectContaining({
        replaceOwnerId: expect.anything(),
      }),
    );
    expect(transients.cloneFromScene).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        replaceOwnerId: "vc:transient:alt-clone:gesture-1",
      }),
    );
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(
      transients.sync.mock.invocationCallOrder[0]!,
    );

    emit({
      ...gesture("transform-cancel"),
      modifiers: altModifiers,
    });
    expect(transients.release).toHaveBeenCalledWith(
      "vc:transient:alt-clone:gesture-1",
    );
    expect(discard).toHaveBeenCalledWith({
      gestureId: "gesture-1",
      reason: "transform-cancel",
    });
  });

  it("preserves preallocated clone IDs from preview through durable handoff", () => {
    const { emit, service, transients } = harness();
    const identity = {
      elements: [{ sourceId: "first", cloneId: "clone-first" }],
      groups: [],
      selection: [{ kind: "element" as const, id: "clone-first" }],
    };
    const prepare = vi.fn(() => identity);
    const discard = vi.fn();
    service.setClonePlanProvider({ prepare, discard });
    const commits: Array<Extract<
      TCanvasProductTransformEvent,
      { type: "transform-commit" }
    >> = [];
    service.subscribe((event) => {
      if (event.type === "transform-commit") {
        commits.push(event);
      }
    });
    const modifiers = {
      alt: true,
      ctrl: false,
      meta: false,
      shift: false,
    };

    emit({ ...gesture("transform-begin"), modifiers });
    emit({ ...gesture("transform-update"), modifiers });
    emit({ ...gesture("transform-commit"), modifiers });

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(commits[0]?.clone).toEqual(identity);
    expect(transients.sync).toHaveBeenLastCalledWith(
      "vc:transient:transform-handoff:gesture-1",
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: "vc:element:u-clone-first",
          }),
          expect.objectContaining({
            id: "vc:element:u-clone-first:render",
            parentId: "vc:element:u-clone-first",
          }),
        ]),
      }),
    );
    expect(discard).toHaveBeenCalledWith({
      gestureId: "gesture-1",
      reason: "commit-dispatched",
    });
  });

  it("leaves the ordinary transform preview active when clone policy vetoes", () => {
    const { emit, service, transforms, transients } = harness();
    const prepare = vi.fn(() => null);
    service.setClonePlanProvider({
      prepare,
      discard: vi.fn(),
    });
    const modifiers = {
      alt: true,
      ctrl: false,
      meta: false,
      shift: false,
    };

    emit({ ...gesture("transform-begin"), modifiers });
    emit({ ...gesture("transform-update"), modifiers });

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(transforms.clearPreview).not.toHaveBeenCalled();
    expect(transients.sync).not.toHaveBeenCalled();
  });

  it("creates the transient handoff synchronously and retains it through projection success", async () => {
    const { service, transients, emit } = harness();
    const projection = deferred();
    const commits: Array<Extract<
      TCanvasProductTransformEvent,
      { type: "transform-commit" }
    >> = [];
    service.subscribe((event) => {
      if (event.type === "transform-commit") {
        commits.push(event);
        event.handoff.waitFor(projection.promise);
      }
    });

    emit(gesture("transform-commit"));
    const commitEvent = commits[0]!;
    expect(transients.sync).toHaveBeenCalledTimes(1);
    expect(transients.sync.mock.invocationCallOrder[0]).toBeLessThan(
      transients.release.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    expect(commitEvent.proposals).toEqual([
      expect.objectContaining({
        target: { kind: "element", id: "first" },
        nextTransform: expect.objectContaining({
          position: { x: 40, y: 20 },
        }),
      }),
    ]);
    expect(commitEvent.handoff.state).toBe("pending");
    expect(transients.release).not.toHaveBeenCalled();

    projection.resolve();
    await projection.promise;
    await Promise.resolve();
    expect(commitEvent.handoff.state).toBe("completed");
    expect(transients.release).toHaveBeenCalledWith(
      "vc:transient:transform-handoff:gesture-1",
    );
    const transientProjection = transients.sync.mock.calls[0]?.[1];
    expect(transientProjection.nodes).toEqual([
      expect.objectContaining({
        id: "vc:transient:transform-handoff:gesture-1::node:first",
        parentId: null,
        transform: expect.objectContaining({
          position: { x: 40, y: 20 },
        }),
      }),
      expect.objectContaining({
        id: "vc:transient:transform-handoff:gesture-1::node:first:render",
        parentId: "vc:transient:transform-handoff:gesture-1::node:first",
      }),
    ]);
    expect(transientProjection.nodes[0]).not.toHaveProperty("metadata");
  });

  it("clears and diagnoses a failed async handoff", async () => {
    const { service, transients, diagnostics, emit } = harness();
    const projection = deferred();
    const handoffs: TCanvasDurableHandoff[] = [];
    service.subscribe((event) => {
      if (event.type === "transform-commit") {
        handoffs.push(event.handoff);
        event.handoff.waitFor(projection.promise);
      }
    });
    const failure = new Error("projection failed");
    emit(gesture("transform-commit"));
    projection.reject(failure);
    await projection.promise.catch(() => undefined);
    await Promise.resolve();

    expect(handoffs[0]?.state).toBe("failed");
    expect(transients.release).toHaveBeenCalledTimes(1);
    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({
      operation: "handoff-failure",
      error: failure,
      gestureId: "gesture-1",
    }));
  });

  it("cancels retained handoffs on remote changes and teardown idempotently", () => {
    const first = harness();
    const remoteHandoffs: TCanvasDurableHandoff[] = [];
    first.service.subscribe((event) => {
      if (event.type === "transform-commit") {
        remoteHandoffs.push(event.handoff);
        event.handoff.retain();
      }
    });
    first.emit(gesture("transform-commit"));
    first.service.cancelForRemoteChange();
    expect(remoteHandoffs[0]?.state).toBe("cancelled");
    expect(first.transforms.cancelActiveGesture).toHaveBeenCalledTimes(1);
    expect(first.transients.release).toHaveBeenCalledTimes(1);

    const second = harness();
    const teardownHandoffs: TCanvasDurableHandoff[] = [];
    second.service.subscribe((event) => {
      if (event.type === "transform-commit") {
        teardownHandoffs.push(event.handoff);
        event.handoff.retain();
      }
    });
    second.emit(gesture("transform-commit"));
    second.service.destroy();
    second.service.destroy();
    expect(teardownHandoffs[0]?.state).toBe("cancelled");
    expect(second.unsubscribe).toHaveBeenCalledTimes(1);
    expect(second.transforms.cancelActiveGesture).toHaveBeenCalledTimes(1);
    expect(second.transients.release).toHaveBeenCalledTimes(1);
  });

  it("finishes teardown cleanup when unsubscribe and engine cancellation fail", () => {
    const result = harness();
    result.unsubscribe.mockImplementation(() => {
      throw new Error("unsubscribe failed");
    });
    vi.mocked(result.transforms.cancelActiveGesture).mockImplementation(() => {
      throw new Error("cancel failed");
    });
    const handoffs: TCanvasDurableHandoff[] = [];
    result.service.subscribe((event) => {
      if (event.type === "transform-commit") {
        handoffs.push(event.handoff);
        event.handoff.retain();
      }
    });
    result.emit(gesture("transform-commit"));

    expect(() => result.service.destroy()).toThrow("unsubscribe failed");
    expect(handoffs[0]?.state).toBe("cancelled");
    expect(result.transforms.cancelActiveGesture).toHaveBeenCalledTimes(1);
    expect(result.transients.release).toHaveBeenCalledTimes(1);
    expect(result.diagnostics).toHaveBeenCalledWith(expect.objectContaining({
      operation: "teardown",
    }));
    expect(() => result.service.destroy()).not.toThrow();
  });
});
