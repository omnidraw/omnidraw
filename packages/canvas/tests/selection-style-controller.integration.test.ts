import type {
  TColor,
  TEditorSceneMutation,
  TNodeId,
  TSceneNode,
} from '@omnidraw/cangine';
import {
  STANDARD_EDITOR_FREEHAND_EXTENSION,
  createSelectionStyleController,
  type ICanvasEditor,
} from '@omnidraw/cangine/editor';
import { describe, expect, test, vi } from 'vitest';

const BLACK: TColor = { space: 'srgb', r: 0, g: 0, b: 0, a: 1 };
const BLUE: TColor = { space: 'srgb', r: 0, g: 0.4, b: 1, a: 1 };
const RED: TColor = { space: 'srgb', r: 1, g: 0, b: 0, a: 1 };
const IDENTITY = {
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  skew: { x: 0, y: 0 },
  origin: { x: 0, y: 0 },
};

function rect(id: string, parentId: string | null = null): TSceneNode {
  return {
    id,
    parentId,
    orderKey: id,
    kind: 'rect',
    transform: IDENTITY,
    size: { width: 100, height: 80 },
    fill: { type: 'solid', color: BLUE },
    stroke: { paint: { type: 'solid', color: BLACK }, width: 2 },
  };
}

function connector(
  id: string,
  routing: 'straight' | 'manual' = 'straight',
  waypoints?: readonly Readonly<{ x: number; y: number }>[],
): TSceneNode {
  return {
    id,
    parentId: null,
    orderKey: id,
    kind: 'connector',
    transform: IDENTITY,
    from: { type: 'point', point: { x: 0, y: 0 } },
    to: { type: 'point', point: { x: 100, y: 50 } },
    routing: routing === 'manual'
      ? { type: 'manual', path: { commands: [] } }
      : { type: 'straight' },
    ...(waypoints === undefined ? {} : { waypoints: [...waypoints] }),
    stroke: { paint: { type: 'solid', color: BLACK }, width: 2 },
  };
}

function textNode(id: string): TSceneNode {
  return {
    id,
    parentId: null,
    orderKey: id,
    kind: 'text',
    transform: IDENTITY,
    runs: [{ text: 'Hello' }],
    style: {
      fontFamilies: ['system-ui'],
      fontSize: 16,
      fill: { type: 'solid', color: BLACK },
    },
    layout: { type: 'auto-width' },
  };
}

function freehand(id: string): TSceneNode {
  return {
    id,
    parentId: null,
    orderKey: id,
    kind: 'path',
    transform: IDENTITY,
    path: {
      commands: [
        { type: 'M', to: { x: 0, y: 0 } },
        { type: 'L', to: { x: 20, y: 10 } },
      ],
    },
    fill: { type: 'solid', color: BLACK },
    extensions: {
      [STANDARD_EDITOR_FREEHAND_EXTENSION]: {
        version: 2,
        pressureMode: 'simulated',
        samples: [
          { x: 0, y: 0 },
          { x: 10, y: 5 },
          { x: 20, y: 10 },
        ],
        profile: {
          size: 4,
          thinning: 0.5,
          smoothing: 0.5,
          streamline: 0.5,
          easing: 'linear',
          start: { cap: true, taper: 0, easing: 'linear' },
          end: { cap: true, taper: 0, easing: 'linear' },
        },
      },
    },
  };
}

function group(id: string, parentId: string | null = null): TSceneNode {
  return {
    id,
    parentId,
    orderKey: id,
    kind: 'group',
    transform: IDENTITY,
  };
}

function widget(id: string, parentId: string | null = null): TSceneNode {
  return {
    id,
    parentId,
    orderKey: id,
    kind: 'widget-frame',
    transform: IDENTITY,
    size: { width: 320, height: 240 },
    title: 'Widget',
    portal: {
      portalId: id,
      interactive: true,
      scaleMode: 'world',
      suspendWhenOffscreen: true,
      overscan: 96,
    },
    resizable: true,
  };
}

function createHarness(initialNodes: readonly TSceneNode[]) {
  const nodes = new Map(initialNodes.map((node) => [node.id, node]));
  const sceneListeners = new Set<() => void>();
  const editorListeners = new Set<(state: typeof editorState) => void>();
  const mutations: TEditorSceneMutation[] = [];
  const beginCoalescing = vi.fn();
  const endCoalescing = vi.fn();
  const editorState = {
    revision: 1,
    status: 'attached' as const,
    activeToolId: 'select',
    selectedNodeIds: [] as readonly TNodeId[],
    focusedNodeId: null,
    canUndo: false,
    canRedo: false,
  };
  const scene = {
    get: (id: TNodeId) => nodes.get(id) ?? null,
    has: (id: TNodeId) => nodes.has(id),
    query: (predicate: (node: TSceneNode) => boolean) => (
      [...nodes.values()].filter(predicate)
    ),
    childrenOf: (parentId: TNodeId | null) => (
      [...nodes.values()].filter((node) => node.parentId === parentId)
    ),
    ancestorsOf: (
      id: TNodeId,
      options: Readonly<{ includeSelf?: boolean }> = {},
    ) => {
      const ancestors: TSceneNode[] = [];
      let current = options.includeSelf ? nodes.get(id) : nodes.get(nodes.get(id)?.parentId ?? '');
      while (current) {
        ancestors.push(current);
        current = current.parentId === null
          ? undefined
          : nodes.get(current.parentId);
      }
      return ancestors;
    },
    subscribe: (listener: () => void) => {
      sceneListeners.add(listener);
      return () => sceneListeners.delete(listener);
    },
  };
  const engine = {
    scene,
    geometry: {
      worldTransform: () => [1, 0, 0, 0, 1, 0, 0, 0, 1],
      routeConnector: (node: Extract<TSceneNode, { kind: 'connector' }>) => ({
        from: node.from.type === 'point' ? node.from.point : { x: 0, y: 0 },
        to: node.to.type === 'point' ? node.to.point : { x: 100, y: 50 },
      }),
    },
    subscribe: () => () => undefined,
  };
  const editor = {
    engine,
    state: editorState,
    history: { beginCoalescing, endCoalescing },
    subscribe: (listener: (state: typeof editorState) => void) => {
      editorListeners.add(listener);
      return () => editorListeners.delete(listener);
    },
    commitSceneMutation: (mutation: TEditorSceneMutation) => {
      mutations.push(mutation);
      for (const command of mutation.commands) {
        if (command.type === 'upsert') nodes.set(command.node.id, command.node);
      }
      for (const listener of sceneListeners) listener();
    },
    canExecuteCommand: () => false,
  } as unknown as ICanvasEditor;
  const select = (...ids: string[]) => {
    editorState.selectedNodeIds = ids;
    editorState.revision += 1;
    for (const listener of editorListeners) listener(editorState);
  };
  return {
    beginCoalescing,
    editor,
    endCoalescing,
    mutations,
    nodes,
    select,
  };
}

function controlIds(
  controller: ReturnType<typeof createSelectionStyleController>,
) {
  return controller.state.controls.map((control) => control.id);
}

describe('Cangine selection style consumer boundary', () => {
  test('publishes semantic controls for shapes, text, groups, and widgets', () => {
    const ordinaryGroup = group('group');
    const groupedRect = rect('grouped-rect', 'group');
    const widgetGroup = group('widget-group');
    const groupedWidget = widget('grouped-widget', 'widget-group');
    const harness = createHarness([
      rect('rect'),
      textNode('text'),
      ordinaryGroup,
      groupedRect,
      widget('widget'),
      widgetGroup,
      groupedWidget,
    ]);
    const controller = createSelectionStyleController({
      editor: harness.editor,
    });
    controller.attach();

    harness.select('rect');
    expect(controlIds(controller)).toEqual(expect.arrayContaining([
      'background',
      'foreground',
      'stroke-width',
      'opacity',
    ]));

    harness.select('text');
    expect(controlIds(controller)).toContain('foreground');
    expect(controlIds(controller)).not.toContain('background');

    harness.select('group');
    expect(
      controller.state.controls.find((entry) => entry.id === 'background')
        ?.coverage,
    ).toMatchObject({
      selectedRootCount: 1,
      eligibleTargetCount: 1,
    });

    harness.select('widget');
    expect(controller.state.controls).toHaveLength(0);

    harness.select('widget', 'rect');
    expect(controlIds(controller)).toContain('background');
    expect(
      controller.state.controls.find((entry) => entry.id === 'opacity')
        ?.coverage,
    ).toMatchObject({
      selectedRootCount: 2,
      eligibleTargetCount: 1,
    });

    harness.select('widget-group');
    expect(controlIds(controller)).not.toContain('opacity');
    expect(controller.state.unavailable).toContainEqual({
      propertyId: 'opacity',
      reason: 'widget-opacity-excluded',
    });
    controller.destroy();
  });

  test('reports mixed/complex paint, freehand width, and route availability', () => {
    const gradientRect = {
      ...rect('gradient'),
      fill: {
        type: 'linear-gradient' as const,
        from: { x: 0, y: 0 },
        to: { x: 1, y: 1 },
        stops: [
          { offset: 0, color: BLACK },
          { offset: 1, color: BLUE },
        ],
      },
    };
    const manual = connector('manual', 'manual');
    const waypoint = connector('waypoint', 'straight', [{ x: 20, y: 20 }]);
    const harness = createHarness([
      rect('rect'),
      gradientRect,
      connector('line'),
      manual,
      waypoint,
      freehand('pen'),
    ]);
    const controller = createSelectionStyleController({
      editor: harness.editor,
    });
    controller.attach();

    harness.select('rect', 'gradient');
    expect(
      controller.state.controls.find((entry) => entry.id === 'background')
        ?.value,
    ).toMatchObject({ status: 'complex', mixed: true });

    harness.select('pen');
    expect(
      controller.state.controls.find((entry) => entry.id === 'stroke-width')
        ?.value,
    ).toEqual({ status: 'shared', value: 4 });

    harness.select('line');
    expect(controlIds(controller)).toContain('line-routing');
    harness.select('manual');
    expect(controlIds(controller)).not.toContain('line-routing');
    expect(controller.state.unavailable).toContainEqual({
      propertyId: 'line-routing',
      reason: 'manual-routing',
    });
    harness.select('waypoint');
    expect(controller.state.unavailable).toContainEqual({
      propertyId: 'line-routing',
      reason: 'waypoint-routing',
    });
    controller.destroy();
  });

  test('commits typed changes atomically and suppresses unavailable/no-op work', () => {
    const ordinaryGroup = group('group');
    const groupedRect = rect('grouped-rect', 'group');
    const harness = createHarness([
      rect('rect'),
      connector('line-a'),
      connector('line-b'),
      connector('manual', 'manual'),
      textNode('text'),
      ordinaryGroup,
      groupedRect,
      freehand('pen'),
    ]);
    const controller = createSelectionStyleController({
      editor: harness.editor,
    });
    controller.attach();

    harness.select('rect');
    expect(controller.apply({ propertyId: 'background', value: RED })).toBe(true);
    expect(controller.apply({ propertyId: 'foreground', value: BLUE })).toBe(true);
    expect(controller.apply({ propertyId: 'stroke-width', value: 8 })).toBe(true);
    expect(harness.mutations.map((mutation) => mutation.source)).toEqual([
      'cangine-editor:selection-style:background',
      'cangine-editor:selection-style:foreground',
      'cangine-editor:selection-style:stroke-width',
    ]);
    expect(controller.apply({ propertyId: 'stroke-width', value: 8 })).toBe(false);

    harness.select('line-a', 'line-b');
    expect(controller.apply({
      propertyId: 'line-routing',
      value: 'elbow',
    })).toBe(true);
    expect(harness.mutations.at(-1)?.commands).toHaveLength(2);

    harness.select('manual');
    const beforeUnavailable = harness.mutations.length;
    expect(controller.apply({
      propertyId: 'line-routing',
      value: 'straight',
    })).toBe(false);
    expect(harness.mutations).toHaveLength(beforeUnavailable);

    harness.select('group');
    expect(controller.apply({ propertyId: 'opacity', value: 0.5 })).toBe(true);
    expect(harness.mutations.at(-1)?.commands).toHaveLength(1);
    expect(harness.mutations.at(-1)?.commands[0]).toMatchObject({
      type: 'upsert',
      node: { id: 'group', opacity: 0.5 },
    });
    expect(harness.nodes.get('grouped-rect')).not.toHaveProperty('opacity');

    harness.select('pen');
    expect(controller.apply({ propertyId: 'stroke-width', value: 8 })).toBe(true);
    const pen = harness.nodes.get('pen');
    expect(
      pen?.extensions?.[STANDARD_EDITOR_FREEHAND_EXTENSION],
    ).toMatchObject({
      version: 2,
      profile: { size: 8 },
    });
    controller.destroy();
  });

  test('flushes one exact continuous value under one history key', () => {
    const harness = createHarness([rect('rect')]);
    const frames = new Map<number, (time: number) => void>();
    let nextFrame = 0;
    const cancelFrame = vi.fn((handle: number) => {
      frames.delete(handle);
    });
    const controller = createSelectionStyleController({
      editor: harness.editor,
      continuousClock: {
        requestFrame: (callback) => {
          const handle = ++nextFrame;
          frames.set(handle, callback);
          return handle;
        },
        cancelFrame,
      },
    });
    controller.attach();
    harness.select('rect');

    controller.beginContinuous('opacity');
    expect(controller.updateContinuous({
      propertyId: 'opacity',
      value: 0.4,
    })).toBe(true);
    expect(controller.updateContinuous({
      propertyId: 'opacity',
      value: 0.35,
    })).toBe(true);
    expect(harness.mutations).toHaveLength(0);
    controller.endContinuous();

    expect(cancelFrame).toHaveBeenCalledTimes(1);
    expect(harness.mutations).toHaveLength(1);
    expect(harness.mutations[0]?.commands[0]).toMatchObject({
      type: 'upsert',
      node: { id: 'rect', opacity: 0.35 },
    });
    expect(harness.beginCoalescing).toHaveBeenCalledTimes(1);
    expect(harness.endCoalescing).toHaveBeenCalledWith(
      harness.beginCoalescing.mock.calls[0]?.[0],
    );
    expect(Object.isFrozen(controller.state.controls)).toBe(true);
    controller.destroy();
  });
});
