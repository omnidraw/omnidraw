import type {
  TConnectorNode,
  TConnectorRouting,
  TResolvedConnectorGeometry,
} from '@omnidraw/cangine';
import {
  createPathInteractionController,
  type TPathSegmentMode,
} from '@omnidraw/cangine/editor';
import { describe, expect, test, vi } from 'vitest';

const TRANSFORM = {
  position: { x: 12, y: 18 },
  rotation: 0.25,
  scale: { x: 1, y: 1 },
  skew: { x: 0, y: 0 },
  origin: { x: 0, y: 0 },
} as const;

function connector(
  id: string,
  markerShape: 'none' | 'arrow',
): TConnectorNode {
  return {
    id,
    parentId: 'content',
    orderKey: id === 'line' ? 'A' : 'B',
    kind: 'connector',
    transform: structuredClone(TRANSFORM),
    opacity: 0.65,
    from: {
      type: 'node',
      nodeId: 'source',
      anchor: 'right',
      offset: { x: 2, y: 3 },
      gap: 4,
    },
    to: {
      type: 'node',
      nodeId: 'target',
      anchor: 'left',
      offset: { x: -2, y: -3 },
      gap: 5,
    },
    routing: {
      type: 'bezier',
      control1: { x: 25, y: 10 },
      control2: { x: 75, y: 70 },
    },
    waypoints: [{ x: 50, y: 40 }],
    stroke: {
      paint: {
        type: 'solid',
        color: { space: 'srgb', r: 0.2, g: 0.4, b: 0.8, a: 1 },
      },
      width: 3,
      cap: 'round',
      dash: [6, 2],
    },
    startMarker: { shape: 'circle', size: 8, filled: false },
    endMarker: { shape: markerShape, size: 12, filled: true },
    avoidNodeIds: ['obstacle'],
    labelNodeId: 'label',
  };
}

function route(node: TConnectorNode): TResolvedConnectorGeometry {
  const from = { x: 0, y: 0 };
  const to = { x: 100, y: 80 };
  return {
    from,
    to,
    pathStart: from,
    pathEnd: to,
    path: {
      commands: [
        { type: 'M', to: from },
        { type: 'L', to },
      ],
    },
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 80 },
    startTangent: { x: 1, y: 0 },
    endTangent: { x: 1, y: 0 },
  };
}

function withoutRouting(node: TConnectorNode) {
  const { routing: _routing, ...meaning } = node;
  return meaning;
}

function createHarness(initial: TConnectorNode) {
  let current = structuredClone(initial);
  const undoStack: TConnectorNode[] = [];
  const redoStack: TConnectorNode[] = [];
  let sceneListener: ((change: {
    added: readonly string[];
    updated: readonly string[];
    removed: readonly string[];
    reparented: readonly string[];
  }) => void) | null = null;
  const replaceOverlay = vi.fn();
  const owner = {
    id: `owner:${initial.id}`,
    clear: vi.fn(),
    destroy: vi.fn(),
    replace: replaceOverlay,
  };
  const engine = {
    camera: {
      subscribe: () => () => undefined,
      viewportToWorld: (point: Readonly<{ x: number; y: number }>) => point,
      worldToViewport: (point: Readonly<{ x: number; y: number }>) => point,
    },
    geometry: {
      localToWorld: (
        _nodeId: string,
        point: Readonly<{ x: number; y: number }>,
      ) => point,
      routeConnector: (node: TConnectorNode) => route(node),
      worldToLocal: (
        _nodeId: string,
        point: Readonly<{ x: number; y: number }>,
      ) => point,
    },
    input: {
      createClickRecognizer: () => ({
        destroy: vi.fn(),
        reset: vi.fn(),
        subscribe: () => () => undefined,
      }),
      subscribe: () => () => undefined,
    },
    scene: {
      childrenOf: () => [],
      get: (nodeId: string) => nodeId === current.id ? current : null,
      subscribe: (listener: typeof sceneListener) => {
        sceneListener = listener;
        return () => {
          sceneListener = null;
        };
      },
    },
    subscribe: () => () => undefined,
    transients: {
      createOwner: () => owner,
    },
  };
  const editor = {
    commitSceneMutation: (mutation: {
      commands: readonly Readonly<{
        type: 'upsert';
        node: TConnectorNode;
      }>[];
    }) => {
      undoStack.push(structuredClone(current));
      redoStack.length = 0;
      current = structuredClone(mutation.commands[0].node);
    },
    restoreSelectionOverlay: vi.fn(),
    state: {
      activeToolId: 'select',
      focusedNodeId: null,
      selectedNodeIds: [initial.id],
      status: 'attached',
    },
    subscribe: () => () => undefined,
    suppressSelectionOverlay: vi.fn(),
  };
  const controller = createPathInteractionController({
    editor: editor as never,
    engine: engine as never,
    ownerId: owner.id,
  });
  controller.attach();

  const publishSceneChange = () => {
    sceneListener?.({
      added: [],
      updated: [current.id],
      removed: [],
      reparented: [],
    });
  };

  return {
    controller,
    current: () => structuredClone(current),
    overlayUpdates: () => replaceOverlay.mock.calls.length,
    redo: () => {
      const next = redoStack.pop();
      if (!next) return false;
      undoStack.push(structuredClone(current));
      current = next;
      publishSceneChange();
      return true;
    },
    undo: () => {
      const previous = undoStack.pop();
      if (!previous) return false;
      redoStack.push(structuredClone(current));
      current = previous;
      publishSceneChange();
      return true;
    },
  };
}

const EXPECTED_ROUTING = {
  straight: { type: 'straight' },
  smooth: { type: 'bezier' },
  elbow: { type: 'orthogonal' },
} as const satisfies Readonly<Record<TPathSegmentMode, TConnectorRouting>>;

describe('connector line-shape integration', () => {
  test.each([
    ['Line', 'line', 'none'],
    ['Arrow', 'arrow', 'arrow'],
  ] as const)(
    'preserves %s meaning, updates its overlay, and supports undo/redo',
    (_label, id, markerShape) => {
      const original = connector(id, markerShape);
      const harness = createHarness(original);

      for (const mode of ['straight', 'smooth', 'elbow'] as const) {
        const before = harness.current();
        const overlaysBefore = harness.overlayUpdates();

        harness.controller.setSegmentMode(mode);

        const changed = harness.current();
        expect(changed.routing).toEqual(EXPECTED_ROUTING[mode]);
        expect(withoutRouting(changed)).toEqual(withoutRouting(before));
        expect(harness.controller.state.mode).toBe('selected');
        expect(harness.controller.state.segmentMode).toBe(mode);
        expect(harness.overlayUpdates()).toBeGreaterThan(overlaysBefore);

        expect(harness.undo()).toBe(true);
        expect(harness.current()).toEqual(before);
        expect(harness.controller.state.segmentMode).toBe(
          before.routing.type === 'orthogonal'
            ? 'elbow'
            : before.routing.type === 'straight'
              ? 'straight'
              : 'smooth',
        );

        expect(harness.redo()).toBe(true);
        expect(harness.current()).toEqual(changed);
        expect(harness.controller.state.segmentMode).toBe(mode);
      }

      harness.controller.destroy();
    },
  );
});
