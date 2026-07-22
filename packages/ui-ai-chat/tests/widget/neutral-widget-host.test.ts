import { ELEMENT_DATA_ATTR, VC_ON_REMOVE_ATTR } from '@vibecanvas/canvas/core/CONSTANTS';
import type { TCrdtChangeSummary } from '@vibecanvas/canvas/services';
import { fnToWidgetElement } from '@vibecanvas/canvas/widget-host/fn.to-widget-element';
import { ThemeService } from '@vibecanvas/service-theme';
import type { TElement } from '@vibecanvas/service-automerge/types/canvas-doc.types';
import { SyncHook } from '@vibecanvas/tapable';
import Konva from 'konva';
import { describe, expect, test, vi } from 'vitest';
import { WidgetManagerService } from '../../src/widget/WidgetManagerService';
import { WidgetPlacementService } from '../../src/widget-placement/WidgetPlacementService';
import { createTestContainer, createTestWidgetBrowser, ensureDom } from '../test-setup';

const DEFINITION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const REVISION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7';

type TRegisteredElementDefinition = Readonly<{
  id: string;
  matchesElement?(element: TElement): boolean;
  createNode?(element: TElement): Konva.Node | null;
  attachListeners?(node: Konva.Node): boolean | void;
  updateElement?(element: TElement): boolean | void;
  createDragClone?(args: Readonly<{
    node: Konva.Node;
    selection: Konva.Node[];
  }>): boolean | void;
}>;

const EMPTY_CHANGE: TCrdtChangeSummary = {
  fullReload: false,
  elements: { added: [], updated: [], deleted: [] },
  groups: { added: [], updated: [], deleted: [] },
};

function createNeutralHostHarness() {
  ensureDom();
  const container = createTestContainer();
  const stage = new Konva.Stage({ container, width: 800, height: 600 });
  const staticLayer = new Konva.Layer();
  const dynamicLayer = new Konva.Layer();
  stage.add(staticLayer);
  stage.add(dynamicLayer);

  const definitions = new Map<string, TRegisteredElementDefinition>();
  const elements: Record<string, TElement> = {};
  const change = new SyncHook<[TCrdtChangeSummary]>();
  const pendingCommits: Array<() => void> = [];
  const runtimeCleanups: ReturnType<typeof vi.fn>[] = [];
  const render = vi.fn(() => {
    const cleanup = vi.fn();
    runtimeCleanups.push(cleanup);
    return cleanup;
  });
  const deleteDefinition = vi.fn(async () => true);
  const actorEvents = vi.fn();
  const actorDeleteDefinition = vi.fn();
  const actorSnapshot = vi.fn();
  const actorSendMessage = vi.fn();
  const historyRecord = vi.fn();
  const clearTimeout = vi.fn();
  const setTimeout = vi.fn((_callback: () => void, _timeout: number) => Symbol('timer'));
  let id = 0;
  const browser = {
    ...createTestWidgetBrowser(),
    createId: () => `neutral-id-${++id}`,
    setTimeout,
    clearTimeout,
  };

  const elementService = {
    registerElement(definition: TRegisteredElementDefinition) {
      definitions.set(definition.id, definition);
    },
    unregisterElement: vi.fn(),
    createNodeFromElement(element: TElement) {
      const definition = [...definitions.values()].find((candidate) => {
        return candidate.matchesElement?.(element) === true;
      });
      const node = definition?.createNode?.(element) ?? null;
      if (node) definition?.attachListeners?.(node);
      return node;
    },
    createDragClone(args: { node: Konva.Node; selection: Konva.Node[] }) {
      const element = fnToWidgetElement(args.node, browser.now());
      if (!element) return false;
      const definition = [...definitions.values()].find((candidate) => {
        return candidate.matchesElement?.(element) === true;
      });
      return definition?.createDragClone?.(args) === true;
    },
    toElement(node: Konva.Node) {
      return fnToWidgetElement(node, browser.now());
    },
    updateElement(element: TElement) {
      const definition = [...definitions.values()].find((candidate) => {
        return candidate.matchesElement?.(element) === true;
      });
      return definition?.updateElement?.(element) ?? false;
    },
    removeElement(node: Konva.Node, builder: ReturnType<typeof build>) {
      const onRemove = node.getAttr(VC_ON_REMOVE_ATTR) as ((args: { node: Konva.Node }) => void) | undefined;
      onRemove?.({ node });
      node.destroy();
      return builder.deleteElement(node.id());
    },
  };

  function build() {
    const patches = new Map<string, TElement>();
    const fieldPatches: Array<Readonly<{
      elementId: string;
      key: keyof TElement;
      value: unknown;
    }>> = [];
    const deletions = new Set<string>();
    const builder = {
      patchElement(elementId: string, elementOrKey: TElement | keyof TElement, value?: unknown) {
        if (typeof elementOrKey === 'string') {
          fieldPatches.push({ elementId, key: elementOrKey, value });
        } else {
          patches.set(elementId, elementOrKey);
        }
        deletions.delete(elementId);
        return builder;
      },
      deleteElement(elementId: string) {
        deletions.add(elementId);
        patches.delete(elementId);
        return builder;
      },
      commit() {
        pendingCommits.push(() => {
          const added: string[] = [];
          const updated: string[] = [];
          const deleted: string[] = [];
          patches.forEach((element, elementId) => {
            (elements[elementId] ? updated : added).push(elementId);
            elements[elementId] = element;
          });
          fieldPatches.forEach(({ elementId, key, value }) => {
            const element = elements[elementId];
            if (!element) return;
            if (!updated.includes(elementId) && !added.includes(elementId)) updated.push(elementId);
            elements[elementId] = { ...element, [key]: value };
          });
          deletions.forEach((elementId) => {
            if (elements[elementId]) deleted.push(elementId);
            delete elements[elementId];
          });
          change.call({
            ...EMPTY_CHANGE,
            elements: { added, updated, deleted },
          });
        });
        return { rollback: vi.fn(), redoOps: [] };
      },
    };
    return builder;
  }

  const manager = new WidgetManagerService({
    crdtService: {
      doc: () => ({ elements }),
      hooks: { change },
      build,
      applyOps: vi.fn(),
    } as never,
    contextMenuService: { close: vi.fn() } as never,
    loggingService: { warn: vi.fn() } as never,
    themeService: new ThemeService(),
    selectionService: {
      focusedId: null,
      selection: [],
      hooks: { change: new SyncHook<[]>() },
      clear: vi.fn(),
      setSelection: vi.fn(),
      setFocusedNode: vi.fn(),
      setFocusedId: vi.fn(),
    } as never,
    elementService: elementService as never,
    toolService: {
      unregisterTool: vi.fn(),
      setActiveTool: vi.fn(),
    } as never,
    sceneService: {
      stage,
      staticForegroundLayer: staticLayer,
      dynamicLayer,
      hooks: { resize: new SyncHook<[]>() },
    } as never,
    renderOrderService: {
      assignOrderOnInsert: vi.fn(),
      sortChildren: vi.fn(),
    } as never,
    cameraService: { hooks: { change: new SyncHook<[]>() } } as never,
    confirmDialogService: { confirm: vi.fn(async () => true) } as never,
    historyService: { record: historyRecord } as never,
    browser,
    transport: {
      api: {
        actors: {
          events: actorEvents,
          definitions: { delete: actorDeleteDefinition },
          instances: { snapshot: actorSnapshot, sendMessage: actorSendMessage },
        },
        widget: {},
        function: {},
      },
    } as never,
    neutralHost: {
      canvasId: 'canvas-1',
      runtime: { render } as never,
      deleteDefinition,
    },
  });

  manager.start({
    hooks: { elementDefinitionInvalidated: { call: vi.fn() } },
  } as never);

  const flushCommits = () => {
    while (pendingCommits.length > 0) pendingCommits.shift()?.();
  };
  const replaceCommittedElement = (element: TElement) => {
    elements[element.id] = element;
    change.call({
      ...EMPTY_CHANGE,
      elements: { added: [], updated: [element.id], deleted: [] },
    });
  };
  const destroy = () => {
    manager.stop();
    stage.destroy();
    container.remove();
  };

  return {
    actorDeleteDefinition,
    actorEvents,
    actorSendMessage,
    actorSnapshot,
    browser,
    change,
    clearTimeout,
    definitions,
    deleteDefinition,
    destroy,
    dynamicLayer,
    elements,
    flushCommits,
    historyRecord,
    manager,
    render,
    replaceCommittedElement,
    runtimeCleanups,
    staticLayer,
  };
}

describe('neutral widget host', () => {
  test('public placement pins the exact neutral identity before runtime load without actor calls', async () => {
    const harness = createNeutralHostHarness();
    const reference = {
      source: 'published' as const,
      name: `v2:${DEFINITION_ID}`,
      revision: REVISION_ID,
    };
    const resolvePlacement = vi.fn(async () => [undefined, {
      ok: true,
      descriptor: {
        kind: 'published-v2',
        draftId: null,
        reference,
        bounds: { width: 420, height: 300 },
        definitionId: DEFINITION_ID,
        revisionId: REVISION_ID,
        definitionName: null,
        definitionSlug: 'weather',
        previewId: null,
      },
    }] as const);
    const placement = new WidgetPlacementService({
      api: {
        api: {
          agent: {
            widgets: { resolvePlacement },
          },
        },
      } as never,
      browser: harness.browser,
      coordinator: { register: vi.fn(() => () => undefined) } as never,
      dropPlacement: {
        resolveWorldBounds: vi.fn(() => ({ x: 40, y: 50, width: 420, height: 300 })),
      } as never,
      previewFrames: { place: vi.fn() } as never,
      widgetManager: harness.manager,
    });

    await placement.createDropRequest({
      reference,
      bounds: { width: 360, height: 320 },
      label: 'Weather',
    }).onCommit({
      reference,
      bounds: { width: 360, height: 320 },
      clientPoint: { x: 100, y: 120 },
    });

    expect(resolvePlacement).not.toHaveBeenCalled();
    expect(harness.elements).toEqual({});
    expect(harness.render).not.toHaveBeenCalled();
    expect(harness.actorEvents).not.toHaveBeenCalled();
    expect(harness.actorDeleteDefinition).not.toHaveBeenCalled();
    expect(harness.actorSnapshot).not.toHaveBeenCalled();
    expect(harness.actorSendMessage).not.toHaveBeenCalled();

    harness.flushCommits();

    const placed = harness.elements['neutral-id-1'];
    expect(placed).toMatchObject({
      id: 'neutral-id-1',
      x: 40,
      y: 50,
      data: {
        type: 'widget-instance',
        definitionId: DEFINITION_ID,
        revisionId: REVISION_ID,
        instanceId: 'neutral-id-2',
        w: 420,
        h: 300,
        expanded: true,
        window: 'contained',
      },
    });
    expect(placed?.data).not.toHaveProperty('actorDefinitionName');
    expect(placed?.data).not.toHaveProperty('actorInstanceId');

    expect(harness.render).toHaveBeenCalledOnce();
    expect(harness.render).toHaveBeenCalledWith(expect.objectContaining({
      canvasId: 'canvas-1',
      element: placed,
    }));
    expect(harness.actorEvents).not.toHaveBeenCalled();
    expect(harness.actorDeleteDefinition).not.toHaveBeenCalled();
    expect(harness.actorSnapshot).not.toHaveBeenCalled();
    expect(harness.actorSendMessage).not.toHaveBeenCalled();

    harness.manager.setGlobalDefinitionError({
      phase: 'definition-discovery',
      code: 'WIDGET_DEFINITION_UNAVAILABLE',
      message: 'Legacy discovery failed.',
      retryable: true,
    });
    harness.manager.completeDefinitionDiscovery();
    expect(harness.manager.getWidgetError(placed)).toBeNull();

    harness.destroy();
  });

  test('keeps clone previews inert and activates the clone only after its CRDT commit', () => {
    const harness = createNeutralHostHarness();
    const source = harness.manager.placeWidgetInstance({
      definitionId: 'definition-1',
      revisionId: 'revision-7',
      stateDocumentId: 'state-source',
      bounds: { x: 40, y: 50, width: 420, height: 300 },
    });
    harness.flushCommits();
    expect(harness.render).toHaveBeenCalledOnce();
    harness.render.mockClear();

    const sourceNode = harness.staticLayer.findOne(`#${source.id}`);
    const definition = harness.definitions.get('__widget-instance-host');
    expect(sourceNode).toBeInstanceOf(Konva.Group);
    expect(definition?.createDragClone?.({
      node: sourceNode as Konva.Group,
      selection: [sourceNode as Konva.Group],
    })).toBe(true);

    const preview = harness.dynamicLayer.getChildren()[0];
    expect(preview).toBeInstanceOf(Konva.Group);
    expect(harness.render).not.toHaveBeenCalled();

    preview?.fire('dragend');
    expect(harness.render).not.toHaveBeenCalled();

    harness.flushCommits();
    expect(harness.render).toHaveBeenCalledOnce();
    const clone = harness.render.mock.calls[0]?.[0].element as TElement;
    expect(clone).toMatchObject({
      id: 'neutral-id-3',
      data: {
        type: 'widget-instance',
        definitionId: 'definition-1',
        revisionId: 'revision-7',
        instanceId: 'neutral-id-4',
      },
    });
    expect(clone.data).not.toHaveProperty('stateDocumentId');
    expect(harness.historyRecord).toHaveBeenCalledWith(expect.objectContaining({
      label: 'clone-widget',
    }));

    harness.destroy();
  });

  test('remounts on pinned identity changes, ignores geometry, and removes hooks and timers on teardown', () => {
    const harness = createNeutralHostHarness();
    let committed = harness.manager.placeWidgetInstance({
      definitionId: 'definition-1',
      revisionId: 'revision-1',
      bounds: { x: 40, y: 50, width: 420, height: 300 },
    });
    harness.flushCommits();

    const geometryOnly = {
      ...committed,
      x: 90,
      y: 110,
      data: {
        ...committed.data,
        w: 500,
        h: 360,
      },
    } satisfies TElement;
    harness.replaceCommittedElement(geometryOnly);
    expect(harness.render).toHaveBeenCalledTimes(1);
    expect(harness.runtimeCleanups[0]).not.toHaveBeenCalled();
    committed = geometryOnly;

    const identityPatches = [
      { definitionId: 'definition-2' },
      { revisionId: 'revision-2' },
      { instanceId: 'instance-2' },
      { stateDocumentId: 'state-2' },
    ] as const;
    identityPatches.forEach((patch, index) => {
      if (committed.data.type !== 'widget-instance') throw new Error('Expected widget instance.');
      committed = {
        ...committed,
        data: { ...committed.data, ...patch },
      };
      harness.replaceCommittedElement(committed);
      expect(harness.render).toHaveBeenCalledTimes(index + 2);
      expect(harness.runtimeCleanups[index]).toHaveBeenCalledOnce();
      expect(harness.render).toHaveBeenLastCalledWith(expect.objectContaining({
        element: committed,
      }));
    });

    const renderCountBeforeStop = harness.render.mock.calls.length;
    harness.manager.stop();
    expect(harness.runtimeCleanups.at(-1)).toHaveBeenCalledOnce();
    expect(harness.clearTimeout).toHaveBeenCalled();

    if (committed.data.type !== 'widget-instance') throw new Error('Expected widget instance.');
    harness.replaceCommittedElement({
      ...committed,
      data: { ...committed.data, revisionId: 'revision-after-stop' },
    });
    expect(harness.render).toHaveBeenCalledTimes(renderCountBeforeStop);

    harness.destroy();
  });
});
