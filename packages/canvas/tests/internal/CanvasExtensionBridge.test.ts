import type {
  TPortalRegistration,
  TSceneNode,
} from '@omnidraw/cangine';
import type { TWidgetActivation } from '@omnidraw/cangine/editor';
import {
  CANVAS_WIDGET_EXTENSION_KEY,
  type TCanvasItemQuery,
  type TWidgetFrameNode,
} from '@omnidraw/canvas-contract';
import { describe, expect, test, vi } from 'vitest';
import type { CanvasDocumentService } from '../../src/services/CanvasDocumentService';
import { CanvasExtensionBridge } from '../../src/internal/CanvasExtensionBridge';
import {
  fnCanvasContractNodeToCangine,
  fnCangineNodeToAuthoredCanvasContract,
} from '../../src/internal/cangine-contract-adapter';

const transform = {
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  skew: { x: 0, y: 0 },
  origin: { x: 0, y: 0 },
} as const;

function widget(title = 'Chat'): TWidgetFrameNode {
  return {
    id: 'widget-a',
    parentId: null,
    orderKey: 'A',
    kind: 'widget-frame',
    transform,
    size: { width: 360, height: 280 },
    title,
    extensions: {
      [CANVAS_WIDGET_EXTENSION_KEY]: {
        schemaVersion: 1,
        type: 'ui-widget',
        kind: 'ai-chat',
      },
    },
  };
}

function harness() {
  let authored: TSceneNode = fnCanvasContractNodeToCangine(widget());
  const authoredListeners = new Set<() => void>();
  const portalListeners = new Set<() => void>();
  let portalRegistration: TPortalRegistration | null = null;
  let mountedCleanup: (() => void | Promise<void>) | null = null;
  let actionListener: ((activation: TWidgetActivation) => void) | null = null;
  const unregisterPortal = vi.fn(() => {
    const cleanup = mountedCleanup;
    mountedCleanup = null;
    void cleanup?.();
  });
  const query = vi.fn(async () => ({ items: [], nextCursor: null }));
  const document = {
    item: vi.fn((itemId: string) => itemId === authored.id ? {
      id: authored.id,
      item: fnCangineNodeToAuthoredCanvasContract(authored),
      itemRevision: 1,
      createdAtSec: '2026-01-01 00:00:00',
      updatedAtSec: '2026-01-01 00:00:00',
    } : null),
    items: vi.fn(() => []),
    authoredNode: vi.fn((nodeId: string) => nodeId === authored.id ? authored : null),
    authoredNodes: vi.fn(() => [authored]),
    subscribeAuthored(listener: () => void) {
      authoredListeners.add(listener);
      return () => { authoredListeners.delete(listener); };
    },
    query,
  } as unknown as CanvasDocumentService;
  const commitSceneMutation = vi.fn();
  const setSelection = vi.fn();
  const previewOwner = {
    replace: vi.fn(),
    clear: vi.fn(),
    destroy: vi.fn(),
  };
  const createPreviewOwner = vi.fn(() => previewOwner);
  const editor = {
    commitSceneMutation,
    setSelection,
  };
  const engine = {
    camera: {
      viewportSize: { width: 800, height: 600 },
      clientToViewport: ({ x, y }: { x: number; y: number }) => ({ x: x - 10, y: y - 20 }),
      viewportToWorld: ({ x, y }: { x: number; y: number }) => ({ x: x * 2, y: y * 2 }),
      visibleWorldBounds: () => ({ minX: -100, minY: -50, maxX: 1_500, maxY: 1_150 }),
    },
    transients: {
      createOwner: createPreviewOwner,
    },
    portals: {
      register(registration: TPortalRegistration) {
        portalRegistration = registration;
        return unregisterPortal;
      },
      subscribe(listener: () => void) {
        portalListeners.add(listener);
        return () => { portalListeners.delete(listener); };
      },
    },
  };
  const onError = vi.fn();
  const bridge = new CanvasExtensionBridge({
    config: {
      canvasId: 'canvas-a',
      container: documentOwner().createElement('div'),
      notification: {
        showError: vi.fn(),
        showInfo: vi.fn(),
        showSuccess: vi.fn(),
      },
    },
    document,
    editor: editor as never,
    engine: engine as never,
    trace: null,
    shell: {
      state: () => ({ kind: 'canvas', widgetId: null }),
      owns: () => true,
      subscribe: () => () => undefined,
      registerOverlay: () => () => undefined,
    },
    subscribeWidgetActions(listener) {
      actionListener = listener;
      return () => { actionListener = null; };
    },
    onError,
  });
  return {
    bridge,
    commitSceneMutation,
    setSelection,
    query,
    onError,
    unregisterPortal,
    previewOwner,
    createPreviewOwner,
    portal: () => portalRegistration,
    action: (activation: TWidgetActivation) => actionListener?.(activation),
    publish(next = authored) {
      authored = next;
      for (const listener of [...authoredListeners]) listener();
    },
    async mount(host: HTMLDivElement) {
      const result = portalRegistration!.mount({
        portalId: portalRegistration!.portalId,
        host,
        engine: engine as never,
      });
      const cleanup = await result;
      mountedCleanup = cleanup ?? null;
      return cleanup;
    },
  };
}

function documentOwner(): Document {
  return document;
}

describe('Canvas extension bridge', () => {
  test('mounts contract-only widget content and disposes each generation once', async () => {
    const test = harness();
    const cleanup = vi.fn();
    const mount = vi.fn(() => cleanup);
    const unregister = test.bridge.context.widgets.register({
      id: 'ai-chat',
      match: (node) => node.extensions?.[CANVAS_WIDGET_EXTENSION_KEY]
        !== undefined,
      mount,
    });
    expect(test.portal()?.portalId).toBe('omnidraw:widget:widget-a');

    const root = document.createElement('div');
    const titlebar = document.createElement('div');
    titlebar.dataset.vibecanvasWidgetTitlebar = '';
    const host = document.createElement('div');
    root.append(titlebar, host);
    await test.mount(host);

    const args = mount.mock.calls[0]![0];
    expect(args.node).toEqual(widget());
    expect(args.node).not.toHaveProperty('portal');
    expect(args.container).not.toBe(host);
    expect(args.container.parentElement).toBe(host);
    expect(args.container.dataset.omnidrawWidgetContentHost).toBe('');
    expect(args.signal.aborted).toBe(false);

    const embeddedEditor = document.createElement('input');
    args.container.append(embeddedEditor);
    const embeddedKeydown = vi.fn();
    const canvasKeydown = vi.fn();
    embeddedEditor.addEventListener('keydown', embeddedKeydown);
    host.addEventListener('keydown', canvasKeydown);
    embeddedEditor.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      key: 'Enter',
    }));
    expect(embeddedKeydown).toHaveBeenCalledOnce();
    expect(canvasKeydown).not.toHaveBeenCalled();

    unregister();
    unregister();
    expect(args.signal.aborted).toBe(true);
    expect(args.container.isConnected).toBe(false);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(test.unregisterPortal).toHaveBeenCalledOnce();
    await test.bridge.dispose();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  test('projects titlebar actions, node updates, and cancellable activations', async () => {
    const test = harness();
    const changes = vi.fn();
    const onAction = vi.fn(async () => undefined);
    test.bridge.context.widgets.register({
      id: 'ai-chat',
      match: () => true,
      mount(args) {
        args.onNodeChange?.(changes);
        args.setTitlebar?.({
          badge: 'Online',
          actions: [{ id: 'settings', label: 'Settings', icon: '⚙' }],
        });
      },
      onAction,
    });
    const root = document.createElement('div');
    const titlebar = document.createElement('div');
    titlebar.dataset.vibecanvasWidgetTitlebar = '';
    const host = document.createElement('div');
    root.append(titlebar, host);
    await test.mount(host);

    const button = titlebar.querySelector<HTMLButtonElement>('button')!;
    expect(button.getAttribute('aria-label')).toBe('Settings');
    button.click();
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledOnce());
    expect(onAction.mock.calls[0]![0]).toMatchObject({ actionId: 'settings' });

    const updated = fnCanvasContractNodeToCangine(widget('Updated'));
    test.publish(updated);
    expect(changes).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Updated',
      parentId: null,
    }));
    test.action({
      type: 'header-button',
      widgetId: 'widget-a',
      itemId: 'settings',
    });
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledTimes(2));
    await test.bridge.dispose();
  });

  test('forwards query/selection and admits commands only through the contract', async () => {
    const test = harness();
    const query: TCanvasItemQuery = {
      canvasId: 'canvas-a',
      filter: { type: 'kind', kind: 'widget-frame' },
    };
    await expect(test.bridge.context.document.query(query)).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(test.query).toHaveBeenCalledWith(query);

    test.bridge.context.document.setSelection(['widget-a'], {
      focusedNodeId: 'widget-a',
    });
    expect(test.setSelection).toHaveBeenCalledWith(['widget-a'], {
      focusedNodeId: 'widget-a',
    });
    test.bridge.context.document.commit({
      source: 'extension:test',
      commands: [{ type: 'upsert', node: widget('Committed') }],
    });
    expect(test.commitSceneMutation).toHaveBeenCalledWith(expect.objectContaining({
      source: 'extension:test',
      commands: [expect.objectContaining({
        type: 'upsert',
        node: expect.objectContaining({
          parentId: 'omnidraw:runtime:content',
          portal: expect.objectContaining({
            portalId: 'omnidraw:widget:widget-a',
          }),
        }),
      })],
    }));
    expect(() => test.bridge.context.document.commit({
      source: 'extension:test',
      commands: [{
        type: 'upsert',
        node: { kind: 'layer' } as never,
      }],
    })).toThrow('Invalid Canvas scene node');
    await test.bridge.dispose();
  });

  test('projects external client placement and owns transient preview cleanup', async () => {
    const test = harness();
    const container = test.bridge.context.config.container;
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 810,
      bottom: 620,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    });

    expect(test.bridge.context.placement.containsClientPoint({ x: 100, y: 80 }))
      .toBe(true);
    expect(test.bridge.context.placement.containsClientPoint({ x: 900, y: 80 }))
      .toBe(false);
    expect(test.bridge.context.placement.clientToWorld({ x: 100, y: 80 }))
      .toEqual({ x: 180, y: 120 });
    expect(test.bridge.context.placement.visibleWorldBounds()).toEqual({
      minX: -100,
      minY: -50,
      maxX: 1_500,
      maxY: 1_150,
    });
    expect(test.bridge.context.placement.viewportCenter()).toEqual({ x: 800, y: 600 });

    const preview = test.bridge.context.placement.createWidgetPreview({
      nodeId: 'preview-a',
      title: 'Preview',
    });
    preview.update({ x: 40, y: 60, width: 300, height: 200 });
    expect(test.createPreviewOwner).toHaveBeenCalledWith(
      'omnidraw:external-placement:preview-a',
    );
    expect(test.previewOwner.replace).toHaveBeenCalledWith({
      band: 'world-overlay',
      hitTest: 'none',
      nodes: [expect.objectContaining({
        id: 'preview-a',
        kind: 'widget-frame',
        size: { width: 300, height: 200 },
        title: 'Preview',
        transform: expect.objectContaining({ position: { x: 40, y: 60 } }),
      })],
    });
    preview.clear();
    expect(test.previewOwner.clear).toHaveBeenCalledOnce();
    preview.dispose();
    preview.dispose();
    expect(test.previewOwner.destroy).toHaveBeenCalledOnce();
    await test.bridge.dispose();
  });
});
