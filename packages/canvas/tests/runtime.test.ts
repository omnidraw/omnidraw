import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const runtimeState = vi.hoisted(() => ({
  activeToolIds: [] as string[],
  documentInstance: null as null | {
    history: object;
  },
  documentOptions: null as unknown,
  dropConfig: null as unknown,
  engine: null as unknown,
  engineConfig: null as unknown,
  events: [] as string[],
  inputListener: null as ((event: unknown) => void) | null,
  transformListener: null as ((event: unknown) => void) | null,
  hoverListener: null as ((event: unknown) => void) | null,
  widgetListener: null as ((event: unknown) => void) | null,
  widgetActivationListener: null as ((event: unknown) => void) | null,
  segmentModes: [] as string[],
  selectedNode: null as unknown,
  selectedNodeIds: [] as string[],
  sessionConfig: null as unknown,
}));

vi.mock('@omnidraw/cangine', () => ({
  createInfiniteCanvas: async (config: unknown) => {
    runtimeState.engineConfig = config;
    runtimeState.events.push('engine:create');
    return runtimeState.engine;
  },
}));

vi.mock('@omnidraw/cangine/editor', () => ({
  createImageDropController: (config: unknown) => {
    runtimeState.dropConfig = config;
    runtimeState.events.push('image-drop:create');
    return {
      destroy() {
        runtimeState.events.push('image-drop:destroy');
      },
    };
  },
  createStandardEditorSession: (config: {
    engine: unknown;
  }) => {
    runtimeState.sessionConfig = config;
    runtimeState.events.push('editor:create');
    const editor = {
      engine: config.engine,
      state: {
        activeToolId: 'line',
        contentNodeId: null,
        selectedNodeIds: runtimeState.selectedNodeIds,
        status: 'detached',
      },
      setActiveTool(toolId: string) {
        editor.state.activeToolId = toolId;
        runtimeState.activeToolIds.push(toolId);
      },
      subscribe: () => () => undefined,
    };
    return {
      editor,
      widgets: {
        state: { contentNodeId: null },
        subscribe(listener: (event: unknown) => void) {
          runtimeState.widgetListener = listener;
          return () => {
            runtimeState.events.push('trace:widget:release');
            runtimeState.widgetListener = null;
          };
        },
        subscribeActivation(listener: (event: unknown) => void) {
          runtimeState.widgetActivationListener = listener;
          return () => {
            runtimeState.events.push('trace:widget-activation:release');
            runtimeState.widgetActivationListener = null;
          };
        },
      },
      paths: {
        setSegmentMode(mode: string) {
          runtimeState.segmentModes.push(mode);
        },
      },
      attach() {
        editor.state.status = 'attached';
        runtimeState.events.push('editor:attach');
      },
      destroy() {
        editor.state.status = 'destroyed';
        runtimeState.events.push('editor:destroy');
      },
    };
  },
}));

vi.mock('../src/services/CanvasDocumentService', () => ({
  CanvasDocumentService: class {
    readonly history = {};

    constructor(options: unknown) {
      runtimeState.documentInstance = this;
      runtimeState.documentOptions = options;
      runtimeState.events.push('document:create');
    }

    async start(): Promise<void> {
      runtimeState.events.push('document:start');
    }

    async dispose(): Promise<void> {
      runtimeState.events.push('document:dispose');
    }
  },
}));

import { buildRuntime } from '../src/runtime';

class TestResizeObserver {
  observe(): void {
    runtimeState.events.push('resize:observe');
  }

  disconnect(): void {
    runtimeState.events.push('resize:disconnect');
  }
}

describe('canvas runtime composition', () => {
  beforeEach(() => {
    runtimeState.activeToolIds.length = 0;
    runtimeState.documentInstance = null;
    runtimeState.documentOptions = null;
    runtimeState.dropConfig = null;
    runtimeState.engineConfig = null;
    runtimeState.events.length = 0;
    runtimeState.inputListener = null;
    runtimeState.transformListener = null;
    runtimeState.hoverListener = null;
    runtimeState.widgetListener = null;
    runtimeState.widgetActivationListener = null;
    runtimeState.segmentModes.length = 0;
    runtimeState.selectedNode = null;
    runtimeState.selectedNodeIds.length = 0;
    runtimeState.sessionConfig = null;
    runtimeState.engine = {
      scene: {
        get() {
          return runtimeState.selectedNode;
        },
        get revision() {
          return 1;
        },
        subscribe() {
          return () => runtimeState.events.push('trace:scene:release');
        },
      },
      input: {
        subscribe(listener: (event: unknown) => void) {
          runtimeState.inputListener = listener;
          return () => {
            runtimeState.events.push('trace:input:release');
            runtimeState.inputListener = null;
          };
        },
      },
      transforms: {
        subscribe(listener: (event: unknown) => void) {
          runtimeState.transformListener = listener;
          return () => {
            runtimeState.events.push('trace:transform:release');
            runtimeState.transformListener = null;
          };
        },
        subscribeHover(listener: (event: unknown) => void) {
          runtimeState.hoverListener = listener;
          return () => {
            runtimeState.events.push('trace:hover:release');
            runtimeState.hoverListener = null;
          };
        },
      },
      resize() {
        runtimeState.events.push('engine:resize');
      },
      async destroy() {
        runtimeState.events.push('engine:destroy');
      },
    };
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  test('shares controlled ports and tears down in reverse ownership order', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const image = {
      uploadImage: vi.fn(),
      cloneImage: vi.fn(),
      deleteImage: vi.fn(),
    };
    const runtime = buildRuntime({
      canvasId: 'canvas-a',
      tenant: {
        accountId: 'account-a',
        cellId: 'cell-a',
        deploymentOrigin: 'https://example.test',
        orgId: 'org-a',
        placementEpoch: 1,
      },
      container,
      transport: {} as never,
      createId: () => 'id-a',
      onToggleSidebar: () => undefined,
      themeService: {} as never,
      image,
    }, [
      {
        name: 'first',
        install() {
          runtimeState.events.push('extension:first:install');
          return {
            dispose() {
              runtimeState.events.push('extension:first:dispose');
            },
          };
        },
      },
      {
        name: 'second',
        install() {
          runtimeState.events.push('extension:second:install');
          return {
            dispose() {
              runtimeState.events.push('extension:second:dispose');
            },
          };
        },
      },
    ]);

    await runtime.boot();

    const engineConfig = runtimeState.engineConfig as Record<string, unknown>;
    const sessionConfig = runtimeState.sessionConfig as {
      editor: {
        history: { adapter: unknown };
        sceneMutationPort: unknown;
      };
      clipboardImage: {
        imageImportPort: unknown;
      };
    };
    const dropConfig = runtimeState.dropConfig as {
      dropTarget: HTMLElement;
      fileInput: HTMLInputElement;
      imageImportPort: unknown;
    };
    expect(engineConfig).not.toHaveProperty('record');
    expect(sessionConfig.editor.sceneMutationPort).toBe(
      runtimeState.documentInstance,
    );
    expect(sessionConfig.editor.history.adapter).toBe(
      runtimeState.documentInstance?.history,
    );
    expect(sessionConfig.clipboardImage.imageImportPort).toBe(
      runtimeState.documentInstance,
    );
    expect(dropConfig.imageImportPort).toBe(runtimeState.documentInstance);
    expect(dropConfig.dropTarget).toBe(container);
    expect(dropConfig.fileInput.accept).toBe(
      'image/jpeg,image/png,image/gif,image/webp',
    );

    await runtime.shutdown();

    expect(runtimeState.events).toEqual(expect.arrayContaining([
      'extension:second:dispose',
      'extension:first:dispose',
      'image-drop:destroy',
      'editor:destroy',
      'document:dispose',
      'engine:destroy',
    ]));
    const teardown = runtimeState.events.filter((event) => (
      event.includes(':dispose')
      || event.includes(':destroy')
    ));
    expect(teardown).toEqual([
      'extension:second:dispose',
      'extension:first:dispose',
      'image-drop:destroy',
      'editor:destroy',
      'document:dispose',
      'engine:destroy',
    ]);
    expect(container.childNodes).toHaveLength(0);
  });

  test('installs normalized input before recording and releases active trace subscriptions', async () => {
    const { createReproductionTrace } = await import(
      '../src/debug-trace/createReproductionTrace'
    );
    let elapsed = 0;
    const trace = createReproductionTrace({
      environment: () => ({
        applicationVersion: 'test',
        buildMode: 'test',
        canvasId: 'canvas-a',
        cangineVersion: '0.2.6',
        browser: 'test',
        platform: 'test',
        viewport: { width: 1_000, height: 800 },
        devicePixelRatio: 1,
      }),
      monotonicNow: () => elapsed,
      wallClockNow: () => new Date(0),
      defer: (callback) => queueMicrotask(callback),
      schedule: () => () => {},
      writeClipboard: async () => {},
      createObjectUrl: () => 'blob:test',
      revokeObjectUrl: () => {},
      download: () => {},
    });
    const container = document.createElement('div');
    document.body.append(container);
    const runtime = buildRuntime({
      canvasId: 'canvas-a',
      tenant: {
        accountId: 'account-a',
        cellId: 'cell-a',
        deploymentOrigin: 'https://example.test',
        orgId: 'org-a',
        placementEpoch: 1,
      },
      container,
      transport: {} as never,
      createId: () => 'id-a',
      onToggleSidebar: () => undefined,
      themeService: {} as never,
      image: {
        uploadImage: vi.fn(),
        cloneImage: vi.fn(),
        deleteImage: vi.fn(),
      },
      trace,
    });
    await runtime.boot();

    expect(runtimeState.inputListener).not.toBeNull();
    expect(runtimeState.transformListener).not.toBeNull();
    trace.start();
    expect(runtimeState.transformListener).not.toBeNull();
    expect(runtimeState.widgetListener).not.toBeNull();
    elapsed = 5;
    const idlePointerMove = {
      type: 'pointer-move' as const,
      pointerId: 1,
      pointerType: 'mouse' as const,
      buttons: 0,
      button: -1,
      pressure: 0,
      tilt: { x: 0, y: 0 },
      client: { x: 8, y: 18 },
      viewport: { x: 8, y: 18 },
      world: { x: 8, y: 18 },
      deltaViewport: { x: 1, y: 1 },
      deltaWorld: { x: 1, y: 1 },
      hit: null,
      modifiers: {
        alt: false,
        control: false,
        meta: false,
        shift: false,
      },
      timeStamp: 0,
    };
    runtimeState.inputListener?.(idlePointerMove);
    runtimeState.inputListener?.(idlePointerMove);
    runtimeState.hoverListener?.({
      pointerId: 1,
      pointerType: 'mouse',
      handle: 'move',
      cursor: 'default',
    });
    expect(trace.state().retainedEvents).toBe(0);
    runtimeState.inputListener?.({
      type: 'pointer-down',
      pointerId: 1,
      pointerType: 'mouse',
      buttons: 1,
      button: 0,
      pressure: 0.5,
      tilt: { x: 0, y: 0 },
      client: { x: 10, y: 20 },
      viewport: { x: 10, y: 20 },
      world: { x: 10, y: 20 },
      deltaViewport: { x: 0, y: 0 },
      deltaWorld: { x: 0, y: 0 },
      hit: null,
      modifiers: {
        alt: false,
        control: false,
        meta: false,
        shift: false,
      },
      timeStamp: 1,
    });
    runtimeState.inputListener?.({
      ...idlePointerMove,
      buttons: 1,
      client: { x: 12, y: 22 },
      viewport: { x: 12, y: 22 },
      world: { x: 12, y: 22 },
      timeStamp: 1.5,
    });
    runtimeState.inputListener?.({
      type: 'key-down',
      key: 's',
      code: 'KeyS',
      repeat: false,
      composing: false,
      modifiers: {
        alt: false,
        control: false,
        meta: false,
        shift: false,
      },
      timeStamp: 2,
    });
    expect(trace.state().retainedEvents).toBe(3);
    runtimeState.inputListener?.({
      ...idlePointerMove,
      type: 'pointer-up',
      button: 0,
      timeStamp: 2.5,
    });
    for (let index = 0; index < 19; index += 1) {
      runtimeState.inputListener?.({
        ...idlePointerMove,
        client: { x: 20 + index, y: 30 },
        viewport: { x: 20 + index, y: 30 },
        world: { x: 20 + index, y: 30 },
        timeStamp: 3 + index,
      });
    }
    expect(trace.state().retainedEvents).toBe(4);
    runtimeState.inputListener?.({
      ...idlePointerMove,
      client: { x: 30, y: 30 },
      viewport: { x: 30, y: 30 },
      world: { x: 30, y: 30 },
      timeStamp: 12,
    });
    expect(trace.state().retainedEvents).toBe(4);

    trace.stop();
    expect(trace.artifacts()?.copy.text).toContain('"key":"[printable]"');
    expect(trace.artifacts()?.copy.text).not.toContain('"code":"KeyS"');
    expect(runtimeState.transformListener).not.toBeNull();
    expect(runtimeState.widgetListener).toBeNull();
    await runtime.shutdown();
    expect(runtimeState.inputListener).toBeNull();
    expect(runtimeState.events).toEqual(expect.arrayContaining([
      'trace:transform:release',
      'trace:widget:release',
      'trace:input:release',
    ]));
  });

  test('continues core teardown when an extension disposer throws', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const runtime = buildRuntime({
      canvasId: 'canvas-a',
      tenant: {
        accountId: 'account-a',
        cellId: 'cell-a',
        deploymentOrigin: 'https://example.test',
        orgId: 'org-a',
        placementEpoch: 1,
      },
      container,
      transport: {} as never,
      createId: () => 'id-a',
      onToggleSidebar: () => undefined,
      themeService: {} as never,
    }, [{
      name: 'throwing',
      install() {
        return {
          dispose() {
            runtimeState.events.push('extension:throwing:dispose');
            throw new Error('extension teardown failed');
          },
        };
      },
    }]);
    await runtime.boot();

    await expect(runtime.shutdown()).rejects.toThrow('extension teardown failed');

    expect(runtimeState.events).toEqual(expect.arrayContaining([
      'image-drop:destroy',
      'editor:destroy',
      'document:dispose',
      'engine:destroy',
    ]));
    expect(container.childNodes).toHaveLength(0);
  });

  test('exposes only supported selected connector segment changes', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const runtime = buildRuntime({
      canvasId: 'canvas-a',
      tenant: {
        accountId: 'account-a',
        cellId: 'cell-a',
        deploymentOrigin: 'https://example.test',
        orgId: 'org-a',
        placementEpoch: 1,
      },
      container,
      transport: {} as never,
      createId: () => 'id-a',
      onToggleSidebar: () => undefined,
      themeService: {} as never,
    });
    await runtime.boot();

    runtimeState.selectedNodeIds.push('connector-a');
    runtimeState.selectedNode = {
      id: 'connector-a',
      kind: 'connector',
      routing: { type: 'straight' },
    };
    runtime.setSelectedConnectorSegmentMode('straight');
    runtime.setSelectedConnectorSegmentMode('smooth');
    runtime.setSelectedConnectorSegmentMode('elbow');

    expect(runtimeState.segmentModes).toEqual([
      'smooth',
      'elbow',
    ]);
    expect(runtimeState.activeToolIds).toEqual(['select']);

    const bezierRouting = {
      type: 'bezier',
      control1: { x: 20, y: 30 },
      control2: { x: 80, y: 70 },
    };
    runtimeState.selectedNode = {
      id: 'connector-a',
      kind: 'connector',
      routing: bezierRouting,
    };
    runtime.setSelectedConnectorSegmentMode('smooth');
    expect(runtimeState.selectedNode).toMatchObject({
      routing: bezierRouting,
    });

    const orthogonalRouting = {
      type: 'orthogonal',
      cornerRadius: 12,
      obstaclePadding: 8,
      preferredAxis: 'horizontal',
    };
    runtimeState.selectedNode = {
      id: 'connector-a',
      kind: 'connector',
      routing: orthogonalRouting,
    };
    runtime.setSelectedConnectorSegmentMode('elbow');
    expect(runtimeState.selectedNode).toMatchObject({
      routing: orthogonalRouting,
    });

    runtimeState.selectedNode = {
      id: 'connector-a',
      kind: 'connector',
      routing: { type: 'manual', path: { commands: [] } },
    };
    runtime.setSelectedConnectorSegmentMode('straight');
    runtimeState.selectedNode = { id: 'path-a', kind: 'path' };
    runtime.setSelectedConnectorSegmentMode('smooth');
    runtimeState.selectedNodeIds.push('path-a');
    runtime.setSelectedConnectorSegmentMode('elbow');

    expect(runtimeState.segmentModes).toEqual(['smooth', 'elbow']);
    await runtime.shutdown();
  });
});
