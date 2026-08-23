import type {
  TConnectorNode,
  TConnectorRouting,
  TResolvedConnectorGeometry,
  TSceneNode,
} from '@omnidraw/cangine';
import {
  createPathInteractionController,
  createStandardEditorTools,
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
  let inputListener: ((event: unknown) => unknown) | null = null;
  let candidateHit: Readonly<{ nodeId: string }> | null = null;
  let pendingFramePreview: (() => void) | null = null;
  const undoStack: TConnectorNode[] = [];
  const redoStack: TConnectorNode[] = [];
  const commits: TConnectorNode[] = [];
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
  const targetNodes = new Map<string, TSceneNode>([
    ['source', {
      id: 'source', parentId: 'content', orderKey: 'C', kind: 'rect',
      transform: structuredClone(TRANSFORM), size: { width: 100, height: 60 },
    }],
    ['target', {
      id: 'target', parentId: 'content', orderKey: 'D', kind: 'ellipse',
      transform: structuredClone(TRANSFORM), size: { width: 100, height: 60 },
    }],
    ['group', {
      id: 'group', parentId: 'content', orderKey: 'E', kind: 'group',
      transform: structuredClone(TRANSFORM), layout: { type: 'free' },
    }],
    ['group-child', {
      id: 'group-child', parentId: 'group', orderKey: 'A', kind: 'rect',
      transform: structuredClone(TRANSFORM), size: { width: 80, height: 40 },
    }],
  ]);
  const hitTestViewport = vi.fn(() => candidateHit === null ? [] : [candidateHit]);
  const engine = {
    camera: {
      subscribe: () => () => undefined,
      viewportToWorld: (point: Readonly<{ x: number; y: number }>) => point,
      worldToViewport: (point: Readonly<{ x: number; y: number }>) => point,
    },
    geometry: {
      connectorAttachmentLocalBounds: (nodeId: string) => nodeId === 'group'
        ? { minX: 0, minY: 0, maxX: 200, maxY: 100 }
        : { minX: 0, minY: 0, maxX: 100, maxY: 60 },
      localToWorld: (
        _nodeId: string,
        point: Readonly<{ x: number; y: number }>,
      ) => point,
      routeConnector: (node: TConnectorNode) => route(node),
      worldBounds: () => ({ minX: 0, minY: 0, maxX: 200, maxY: 100 }),
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
      hitTestViewport,
      subscribe: (listener: typeof inputListener) => {
        inputListener = listener;
        return () => { inputListener = null; };
      },
    },
    interactions: {
      cancelFramePreview: () => { pendingFramePreview = null; },
      flushFramePreview: () => {
        const preview = pendingFramePreview;
        pendingFramePreview = null;
        preview?.();
      },
      scheduleFramePreview: (_ownerId: string, preview: () => void) => {
        pendingFramePreview = preview;
      },
    },
    scene: {
      childrenOf: () => [],
      get: (nodeId: string) => nodeId === current.id
        ? current
        : targetNodes.get(nodeId) ?? null,
      subscribe: (listener: typeof sceneListener) => {
        sceneListener = listener;
        return () => {
          sceneListener = null;
        };
      },
    },
    subscribe: () => () => undefined,
    transforms: {
      applyPathGeometryPreview: vi.fn(),
      applyPreview: vi.fn(),
      clearPathGeometryPreview: vi.fn(),
      clearPreview: vi.fn(),
      setSelection: vi.fn(),
    },
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
      commits.push(structuredClone(current));
    },
    history: {
      beginCoalescing: vi.fn(),
      endCoalescing: vi.fn(),
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
    resolveBindableNodeId: (nodeId) => nodeId === 'group-child' ? 'group' : nodeId,
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
    commitCount: () => commits.length,
    controller,
    current: () => structuredClone(current),
    overlayUpdates: () => replaceOverlay.mock.calls.length,
    endpointHandleId: (endpoint: 'from' | 'to') => {
      const overlay = replaceOverlay.mock.calls.at(-1)?.[0] as Readonly<{
        nodes?: readonly Readonly<{ id: string }>[];
      }> | undefined;
      const id = overlay?.nodes?.find((node) => (
        node.id.endsWith(`:anchor:endpoint:${endpoint}`)
      ))?.id;
      if (id === undefined) throw new Error(`Missing ${endpoint} endpoint handle.`);
      return id;
    },
    emitInput: (event: unknown) => inputListener?.(event),
    hitQueries: () => hitTestViewport.mock.calls.length,
    presentFrame: () => {
      const preview = pendingFramePreview;
      pendingFramePreview = null;
      preview?.();
    },
    previewNode: () => {
      const call = engine.transforms.applyPathGeometryPreview.mock.calls.at(-1);
      return call?.[0] as TConnectorNode | undefined;
    },
    setCandidate: (nodeId: string | null) => {
      candidateHit = nodeId === null ? null : { nodeId };
    },
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

const NO_MODIFIERS = Object.freeze({
  alt: false,
  ctrl: false,
  meta: false,
  shift: false,
});

function endpointPointerEvent(args: Readonly<{
  type: 'pointer-down' | 'pointer-move' | 'pointer-up';
  point: Readonly<{ x: number; y: number }>;
  handleId?: string;
  modifiers?: typeof NO_MODIFIERS;
  timeStamp: number;
}>) {
  return {
    type: args.type,
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    buttons: args.type === 'pointer-up' ? 0 : 1,
    world: { ...args.point },
    viewport: { ...args.point },
    client: { ...args.point },
    modifiers: { ...(args.modifiers ?? NO_MODIFIERS) },
    timeStamp: args.timeStamp,
    hit: args.handleId === undefined
      ? null
      : {
          nodeId: args.handleId,
          path: [args.handleId],
          transientOwnerId: '',
        },
  };
}

describe('connector line-shape integration', () => {
  test('standard Line and Arrow creation bind both ends with group-aware semantics', () => {
    const content: TSceneNode = {
      id: 'content', parentId: null, orderKey: '0', kind: 'layer',
      role: 'content', coordinateSpace: 'world', transform: structuredClone(TRANSFORM),
    };
    const source: TSceneNode = {
      id: 'source', parentId: 'content', orderKey: 'A', kind: 'rect',
      transform: structuredClone(TRANSFORM), size: { width: 100, height: 60 },
    };
    const group: TSceneNode = {
      id: 'group', parentId: 'content', orderKey: 'B', kind: 'group',
      transform: structuredClone(TRANSFORM), layout: { type: 'free' },
    };
    const child: TSceneNode = {
      id: 'group-child', parentId: 'group', orderKey: 'A', kind: 'ellipse',
      transform: structuredClone(TRANSFORM), size: { width: 80, height: 40 },
    };
    const nodes = new Map([content, source, group, child].map((node) => [node.id, node]));
    const commits: TConnectorNode[] = [];
    let connectorSession: Readonly<{
      onCommit(draft: unknown): void;
    }> | null = null;
    let nextId = 'created-arrow';
    const hit = (nodeId: string) => ({
      nodeId,
      path: [nodeId],
      worldPoint: { x: 0, y: 0 },
      localPoint: { x: 0, y: 0 },
      zOrder: 1,
    });
    const ancestorsOf = (nodeId: string) => {
      const ancestors: TSceneNode[] = [];
      let node = nodes.get(nodeId) ?? null;
      while (node !== null) {
        ancestors.push(node);
        node = node.parentId === null ? null : nodes.get(node.parentId) ?? null;
      }
      return ancestors;
    };
    const engine = {
      geometry: {
        connectorAttachmentLocalBounds: (nodeId: string) => nodeId === 'group'
          ? { minX: 0, minY: 0, maxX: 200, maxY: 100 }
          : { minX: 0, minY: 0, maxX: 100, maxY: 60 },
        worldToLocal: (_nodeId: string, point: Readonly<{ x: number; y: number }>) => point,
      },
      input: {
        focus: vi.fn(),
        hitTestViewport: vi.fn(() => [hit('source')]),
      },
      interactions: {
        beginConnector: (_event: unknown, options: typeof connectorSession) => {
          connectorSession = options;
        },
        cancelActive: vi.fn(),
      },
      scene: {
        ancestorsOf,
        childrenOf: (parentId: string | null) => [...nodes.values()].filter(
          (node) => node.parentId === parentId,
        ),
        get: (nodeId: string) => nodes.get(nodeId) ?? null,
        has: (nodeId: string) => nodes.has(nodeId),
      },
    };
    const editor = {
      clearSelection: vi.fn(),
      commitSceneMutation: (mutation: Readonly<{
        commands: readonly Readonly<{ type: string; node?: TSceneNode }>[];
      }>) => {
        const created = mutation.commands.find((command) => command.node?.id === nextId)?.node;
        if (created?.kind === 'connector') commits.push(structuredClone(created));
      },
      executeCommand: vi.fn(async () => undefined),
      history: null,
      setActiveTool: vi.fn(),
      setSelection: vi.fn(),
      state: { selectedNodeIds: [] },
    };
    const context = { editor, engine, signal: new AbortController().signal } as never;
    const tools = createStandardEditorTools({
      engine: engine as never,
      contentParentId: 'content',
      createNodeId: () => nextId,
    });
    const sample = (
      point: Readonly<{ x: number; y: number }>,
      modifiers = NO_MODIFIERS,
    ) => ({
      pointerId: 1,
      pointerType: 'mouse',
      world: { ...point }, viewport: { ...point }, client: { ...point },
      pressure: 0.5, tilt: { x: 0, y: 0 }, timeStamp: 1,
      modifiers: { ...modifiers },
    });
    const pointerDown = endpointPointerEvent({
      type: 'pointer-down', point: { x: 50, y: 30 }, timeStamp: 1,
    });

    tools.find((tool) => tool.id === 'arrow')!.handleInput!(pointerDown as never, context);
    expect(connectorSession).not.toBeNull();
    connectorSession!.onCommit({
      kind: 'connector', phase: 'commit', belowThreshold: false,
      start: sample({ x: 50, y: 30 }),
      current: sample({ x: -10, y: 50 }, { ...NO_MODIFIERS, alt: true }),
      candidate: hit('group-child'), route: null,
      worldBounds: { minX: -10, minY: 30, maxX: 50, maxY: 50 },
      viewportBounds: { minX: -10, minY: 30, maxX: 50, maxY: 50 },
      distanceViewport: 60,
      termination: { type: 'pointer-up' },
    });

    expect(commits[0]).toMatchObject({
      from: {
        type: 'node', nodeId: 'source', anchor: 'auto',
        attachment: { mode: 'inside', fixedPoint: { x: 0.5, y: 0.5 } },
      },
      to: {
        type: 'node', nodeId: 'group', anchor: 'auto',
        attachment: { mode: 'inside', fixedPoint: { x: 0, y: 0.5 } },
      },
      endMarker: { shape: 'arrow' },
    });

    nextId = 'created-line';
    tools.find((tool) => tool.id === 'connector')!.handleInput!(pointerDown as never, context);
    connectorSession!.onCommit({
      kind: 'connector', phase: 'commit', belowThreshold: false,
      start: sample({ x: 50, y: 30 }),
      current: sample({ x: -10, y: 50 }),
      candidate: hit('group-child'), route: null,
      worldBounds: { minX: -10, minY: 30, maxX: 50, maxY: 50 },
      viewportBounds: { minX: -10, minY: 30, maxX: 50, maxY: 50 },
      distanceViewport: 60,
      termination: { type: 'pointer-up' },
    });
    expect(commits[1]).toMatchObject({
      from: { type: 'node', nodeId: 'source' },
      to: {
        type: 'node', nodeId: 'group',
        attachment: { mode: 'orbit' },
      },
    });
    expect(commits[1]?.startMarker).toBeUndefined();
    expect(commits[1]?.endMarker).toBeUndefined();
  });

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

  test('rebinds tail and head independently while preserving marker styling', () => {
    const original = connector('arrow', 'arrow');
    const harness = createHarness(original);
    let timeStamp = 1;

    const dragEndpoint = (
      endpoint: 'from' | 'to',
      targetId: string,
      point: Readonly<{ x: number; y: number }>,
    ) => {
      const handleId = harness.endpointHandleId(endpoint);
      const down = endpointPointerEvent({
        type: 'pointer-down', point, handleId, timeStamp: timeStamp++,
      });
      down.hit!.transientOwnerId = handleId.slice(0, handleId.indexOf(':anchor:'));
      harness.emitInput(down);
      harness.setCandidate(targetId);
      harness.emitInput(endpointPointerEvent({
        type: 'pointer-move', point, timeStamp: timeStamp++,
      }));
      harness.presentFrame();
      harness.emitInput(endpointPointerEvent({
        type: 'pointer-up', point, timeStamp: timeStamp++,
      }));
    };

    dragEndpoint('from', 'target', { x: 50, y: 30 });
    expect(harness.current().from).toEqual({
      type: 'node',
      nodeId: 'target',
      anchor: 'auto',
      attachment: { mode: 'inside', fixedPoint: { x: 0.5, y: 0.5 } },
    });

    dragEndpoint('to', 'group-child', { x: -10, y: 50 });
    expect(harness.current().to).toEqual({
      type: 'node',
      nodeId: 'group',
      anchor: 'auto',
      attachment: { mode: 'orbit', fixedPoint: { x: 0, y: 0.5 } },
    });
    expect(harness.current().startMarker).toEqual(original.startMarker);
    expect(harness.current().endMarker).toEqual(original.endMarker);
    expect(harness.commitCount()).toBe(2);

    harness.controller.destroy();
  });

  test('publishes modifier-only endpoint decisions and flushes the final release once', () => {
    const original = connector('arrow', 'arrow');
    const harness = createHarness(original);
    const handleId = harness.endpointHandleId('to');
    const down = endpointPointerEvent({
      type: 'pointer-down',
      point: { x: 100, y: 80 },
      handleId,
      timeStamp: 1,
    });
    down.hit!.transientOwnerId = handleId.slice(0, handleId.indexOf(':anchor:'));
    harness.emitInput(down);
    harness.setCandidate('target');

    harness.emitInput(endpointPointerEvent({
      type: 'pointer-move', point: { x: -5, y: 30 }, timeStamp: 2,
    }));
    harness.presentFrame();
    expect(harness.previewNode()?.to).toMatchObject({
      type: 'node', attachment: { mode: 'orbit' },
    });

    harness.emitInput({
      type: 'key-down',
      key: 'Alt',
      code: 'AltLeft',
      modifiers: { ...NO_MODIFIERS, alt: true },
      timeStamp: 3,
    });
    harness.presentFrame();
    expect(harness.previewNode()?.to).toMatchObject({
      type: 'node', attachment: { mode: 'inside' },
    });

    const queriesBeforeLatestMoves = harness.hitQueries();
    harness.setCandidate('source');
    harness.emitInput(endpointPointerEvent({
      type: 'pointer-move', point: { x: 25, y: 20 }, timeStamp: 4,
    }));
    harness.setCandidate('group-child');
    harness.emitInput(endpointPointerEvent({
      type: 'pointer-move', point: { x: 40, y: 25 }, timeStamp: 5,
    }));
    harness.presentFrame();
    expect(harness.hitQueries() - queriesBeforeLatestMoves).toBe(1);
    expect(harness.previewNode()?.to).toMatchObject({
      type: 'node', nodeId: 'group',
    });

    harness.setCandidate('target');
    harness.emitInput(endpointPointerEvent({
      type: 'pointer-move',
      point: { x: 75, y: 15 },
      modifiers: { ...NO_MODIFIERS, ctrl: true },
      timeStamp: 6,
    }));
    harness.emitInput(endpointPointerEvent({
      type: 'pointer-up',
      point: { x: 75, y: 15 },
      modifiers: { ...NO_MODIFIERS, ctrl: true },
      timeStamp: 7,
    }));
    expect(harness.current().to).toEqual({
      type: 'point', point: { x: 75, y: 15 },
    });
    expect(harness.commitCount()).toBe(1);

    harness.controller.destroy();
  });

  test('forces elbow attachments to orbit and drops fixed legs when leaving elbow mode', () => {
    const elbow = connector('arrow', 'arrow');
    elbow.routing = { type: 'orthogonal' };
    elbow.from = {
      type: 'node', nodeId: 'source', anchor: 'auto',
      attachment: { mode: 'inside', fixedPoint: { x: 0.5, y: 0.5 } },
    };
    elbow.fixedSegments = [{
      id: 'pinned', start: { x: 20, y: 20 }, end: { x: 80, y: 20 },
    }];
    delete elbow.waypoints;
    const harness = createHarness(elbow);

    harness.controller.setSegmentMode('straight');
    expect(harness.current().routing).toEqual({ type: 'straight' });
    expect(harness.current().fixedSegments).toBeUndefined();
    harness.controller.setSegmentMode('elbow');
    expect(harness.current().from).toMatchObject({
      type: 'node', attachment: { mode: 'orbit' },
    });

    harness.controller.destroy();
  });
});
