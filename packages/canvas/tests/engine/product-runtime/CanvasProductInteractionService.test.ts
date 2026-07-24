import type {
  ICamera2DController,
  IInteractionController,
  ITextEditingSession,
  TConnectorDraft,
  TCreationSessionOptions,
  TDragDraft,
  THitResult,
  TInteractionSample,
  TMarqueeSessionOptions,
  TStrokeSessionOptions,
} from "@vibecanvas/canvas-engine";
import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { describe, expect, it, vi } from "vitest";
import { CanvasTransientTargetRegistry } from "../../../src/engine/input/CanvasTransientTargetRegistry";
import { CanvasProductInteractionService } from "../../../src/engine/product-runtime/CanvasProductInteractionService";
import type { TCanvasProductRuntimeEnginePorts } from "../../../src/engine/product-runtime/interface";
import type { TCanvasProductPointerEvent } from "../../../src/engine/product-runtime/typed";
import type { TCanvasProjectionIndex } from "../../../src/engine/typed";

function projectionIndex(): TCanvasProjectionIndex {
  return {
    elementNodeIds: {
      first: ["node:first", "node:first:render", "node:first:inline-text"],
    },
    groupNodeIds: {},
    nodeTargets: {
      "node:first": { kind: "element", id: "first" },
      "node:first:render": { kind: "element", id: "first" },
      "node:first:inline-text": { kind: "element", id: "first" },
    },
    elementResourceIds: {},
    elementPortalIds: {},
    elementSignatures: {},
    groupSignatures: {},
    activeProjectionSignature: "projection",
    lastAppliedRevision: 1,
  };
}

function canvasDocument(): TCanvasDoc {
  return {
    id: "canvas",
    name: "Canvas",
    elements: {
      first: {
        id: "first",
        x: 0,
        y: 0,
        rotation: 0,
        zIndex: "z00000001",
        parentGroupId: null,
        bindings: [],
        locked: false,
        createdAt: 1,
        updatedAt: 1,
        data: {
          type: "text",
          w: 100,
          h: 40,
          text: "Hello",
          originalText: "Hello",
          fontFamily: "Inter",
          link: null,
          containerId: null,
          autoResize: true,
        },
        style: {},
      },
    },
    groups: {},
  };
}

function pointerEvent(): TCanvasProductPointerEvent {
  return {
    type: "pointer-down",
    timeStamp: 10,
    modifiers: {
      alt: false,
      control: true,
      meta: false,
      shift: true,
    },
    pointerId: 4,
    pointerType: "mouse",
    buttons: 1,
    button: 0,
    pressure: 0.5,
    tilt: { x: 0, y: 0 },
    client: { x: 20, y: 30 },
    viewport: { x: 10, y: 15 },
    world: { x: 5, y: 7.5 },
    deltaViewport: { x: 0, y: 0 },
    deltaWorld: { x: 0, y: 0 },
    hit: null,
  };
}

function sample(world = { x: 5, y: 7.5 }): TInteractionSample {
  return {
    pointerId: 4,
    pointerType: "mouse",
    world,
    viewport: { x: world.x * 2, y: world.y * 2 },
    client: { x: world.x * 2 + 10, y: world.y * 2 + 15 },
    pressure: 0.5,
    tilt: { x: 0, y: 0 },
    timeStamp: 10,
    modifiers: { alt: false, ctrl: true, meta: false, shift: true },
  };
}

function dragDraft(
  kind: TDragDraft["kind"],
  phase: TDragDraft["phase"],
): TDragDraft {
  return {
    kind,
    phase,
    start: sample(),
    current: sample({ x: 25, y: 30 }),
    worldBounds: { minX: 5, minY: 7.5, maxX: 25, maxY: 30 },
    viewportBounds: { minX: 10, minY: 15, maxX: 50, maxY: 60 },
    distanceViewport: 55,
  };
}

function hit(nodeId = "node:first"): THitResult {
  return {
    nodeId,
    path: [nodeId],
    worldPoint: { x: 25, y: 30 },
    localPoint: { x: 5, y: 5 },
    zOrder: 1,
  };
}

function harness() {
  let activeCancel: ((event: {
    kind: "create";
    pointerId: number;
    reason: "explicit";
  }) => void) | undefined;
  const textEngineSession = {
    projection: {
      nodeId: "node:first:inline-text",
      visible: true,
      clientMatrix: [1, 0, 0, 1, 20, 30],
      localSize: { width: 100, height: 40 },
    },
    sync: vi.fn(),
    commit: vi.fn(),
    cancel: vi.fn(),
    destroy: vi.fn(),
  } as unknown as ITextEditingSession;
  const interactions = {
    activeKind: null,
    beginMarquee: vi.fn(),
    beginCreation: vi.fn((
      _event,
      options: TCreationSessionOptions,
    ) => {
      activeCancel = options.onCancel as typeof activeCancel;
    }),
    beginStroke: vi.fn(),
    beginConnector: vi.fn(),
    createTextEditingSession: vi.fn(() => textEngineSession),
    cancelActive: vi.fn(() => {
      activeCancel?.({
        kind: "create",
        pointerId: 4,
        reason: "explicit",
      });
    }),
  } as unknown as IInteractionController;
  const camera = {
    worldToViewport: vi.fn((point: { x: number; y: number }) => ({
      x: point.x * 2,
      y: point.y * 2,
    })),
  } as unknown as ICamera2DController;
  const transientTargets = new CanvasTransientTargetRegistry();
  const diagnostics = vi.fn();
  const service = new CanvasProductInteractionService({
    interactions,
    camera,
    transientTargets,
    getProjectionIndex: projectionIndex,
    getDocument: canvasDocument,
    onDiagnostic: diagnostics,
  } as unknown as TCanvasProductRuntimeEnginePorts);
  return {
    service,
    interactions,
    textEngineSession,
    diagnostics,
  };
}

describe("CanvasProductInteractionService", () => {
  it("normalizes marquee, creation, stroke, and connector sessions", () => {
    const { service, interactions } = harness();
    const marqueeCommit = vi.fn();
    service.beginMarquee(pointerEvent(), { onCommit: marqueeCommit });
    const [enginePointer, marquee] = vi.mocked(interactions.beginMarquee)
      .mock.calls[0]!;
    expect(enginePointer).toMatchObject({
      modifiers: { ctrl: true, shift: true },
      hit: null,
    });
    (marquee as TMarqueeSessionOptions).onCommit({
      ...dragDraft("marquee", "commit"),
      kind: "marquee",
      phase: "commit",
      hits: [hit(), hit("node:first:render")],
      belowThreshold: false,
    });
    expect(marqueeCommit).toHaveBeenCalledWith(expect.objectContaining({
      kind: "marquee",
      hits: [
        expect.objectContaining({
          target: { kind: "element", id: "first" },
          viewport: { x: 50, y: 60 },
        }),
      ],
    }));

    const creationCommit = vi.fn();
    service.beginCreation(pointerEvent(), { onCommit: creationCommit });
    const creation = vi.mocked(interactions.beginCreation).mock.calls[0]![1];
    creation.onCommit({
      ...dragDraft("create", "commit"),
      kind: "create",
      phase: "commit",
      belowThreshold: true,
    });
    expect(creationCommit).toHaveBeenCalledWith(expect.objectContaining({
      kind: "create",
      belowThreshold: true,
      current: expect.objectContaining({ world: { x: 25, y: 30 } }),
    }));

    const strokeCommit = vi.fn();
    service.beginStroke(pointerEvent(), { onCommit: strokeCommit });
    const stroke = vi.mocked(interactions.beginStroke).mock
      .calls[0]![1] as TStrokeSessionOptions;
    stroke.onCommit({
      kind: "stroke",
      phase: "commit",
      samples: [sample()],
      added: [sample()],
      sampleCount: 1,
    });
    expect(strokeCommit).toHaveBeenCalledWith(expect.objectContaining({
      phase: "commit",
      samples: [
        expect.objectContaining({
          modifiers: expect.objectContaining({ control: true }),
        }),
      ],
    }));

    const connectorUpdate = vi.fn();
    const connectorCommit = vi.fn();
    service.beginConnector(pointerEvent(), {
      source: { kind: "element", id: "first" },
      acceptCandidate: () => true,
      onUpdate: connectorUpdate,
      onCommit: connectorCommit,
    });
    const connector = vi.mocked(interactions.beginConnector).mock.calls[0]![1];
    expect(connector.acceptCandidate?.(hit())).toBe(true);
    expect(connector.createPreviewNode?.({
      ...dragDraft("connector", "update"),
      kind: "connector",
      candidate: hit(),
    })).toMatchObject({
      kind: "connector",
      from: { type: "node", nodeId: "node:first", anchor: "auto" },
      to: { type: "node", nodeId: "node:first", anchor: "auto" },
      routing: { type: "straight" },
    });
    const connectorDraft: TConnectorDraft = {
      ...dragDraft("connector", "update"),
      kind: "connector",
      candidate: hit(),
      route: {
        from: { x: 5, y: 7.5 },
        to: { x: 25, y: 30 },
        pathStart: { x: 5, y: 7.5 },
        pathEnd: { x: 25, y: 30 },
        path: {
          commands: [
            { type: "M", to: { x: 5, y: 7.5 } },
            { type: "L", to: { x: 25, y: 30 } },
          ],
        },
        bounds: { minX: 5, minY: 7.5, maxX: 25, maxY: 30 },
        startTangent: { x: 1, y: 0 },
        endTangent: { x: 1, y: 0 },
      },
    };
    connector.onUpdate?.(connectorDraft);
    expect(connectorUpdate).toHaveBeenCalledWith(expect.objectContaining({
      candidate: expect.objectContaining({
        target: { kind: "element", id: "first" },
      }),
      route: expect.objectContaining({
        path: [
          { type: "M", to: { x: 5, y: 7.5 } },
          { type: "L", to: { x: 25, y: 30 } },
        ],
      }),
    }));
  });

  it("owns text editing session projection, control, and teardown", () => {
    const { service, interactions, textEngineSession } = harness();
    const session = service.createTextSession({
      target: { kind: "element", id: "first" },
      element: {} as HTMLElement,
    });
    expect(interactions.createTextEditingSession).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: "node:first:inline-text",
      }),
    );
    expect(session.projection).toEqual({
      visible: true,
      clientMatrix: [1, 0, 0, 1, 20, 30],
      localSize: { width: 100, height: 40 },
    });
    session.sync();
    session.commit();
    session.cancel();
    session.destroy();
    session.destroy();
    expect(textEngineSession.sync).toHaveBeenCalledTimes(1);
    expect(textEngineSession.commit).toHaveBeenCalledTimes(1);
    expect(textEngineSession.cancel).toHaveBeenCalledTimes(1);
    expect(textEngineSession.destroy).toHaveBeenCalledTimes(1);
  });

  it("reports remote cancellation and cancels retained text sessions", () => {
    const { service, textEngineSession } = harness();
    const cancellation = vi.fn();
    service.beginCreation(pointerEvent(), {
      onCommit: vi.fn(),
      onCancel: cancellation,
    });
    service.createTextSession({
      target: { kind: "element", id: "first" },
      element: {} as HTMLElement,
    });

    service.cancelForRemoteChange();
    expect(cancellation).toHaveBeenCalledWith(expect.objectContaining({
      reason: "remote-change",
    }));
    expect(textEngineSession.cancel).toHaveBeenCalledTimes(1);
    service.destroy();
    service.destroy();
    expect(textEngineSession.destroy).toHaveBeenCalledTimes(1);
  });
});
