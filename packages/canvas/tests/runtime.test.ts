import {
  BUILTIN_THEMES,
  type TThemeDefinition,
} from '@omnidraw/service-theme';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const runtimeState = vi.hoisted(() => ({
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
  widgetController: null as unknown,
  editorController: null as unknown,
  activeToolIds: [] as string[],
  segmentModes: [] as string[],
  selectionAppearances: [] as unknown[],
  pathAppearances: [] as unknown[],
  selectedNode: null as unknown,
  selectedNodeIds: [] as string[],
  fontPreloads: [] as string[],
  fontRegistrations: [] as Array<{
    descriptor: Record<string, unknown>;
    source: Record<string, unknown>;
  }>,
  sessionConfig: null as unknown,
  styleConfig: null as unknown,
  styleController: null as unknown,
  styleDestroyError: null as Error | null,
  projectionCreateArgs: null as unknown,
  projectionSnapshots: [] as unknown[],
  projectionDisposed: false,
  projectionReplaceError: null as Error | null,
  documentStartHook: null as (() => void) | null,
  theme: null as unknown as TThemeDefinition,
  themeListener: null as ((theme: TThemeDefinition) => void) | null,
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
  createSelectionStyleController: (config: unknown) => {
    runtimeState.styleConfig = config;
    runtimeState.events.push('selection-style:create');
    const controller = {
      state: {
        revision: 1,
        status: 'attached',
        selectedRootIds: [],
        controls: [],
        actions: [],
        unavailable: [],
      },
      attach() {
        runtimeState.events.push('selection-style:attach');
      },
      destroy() {
        runtimeState.events.push('selection-style:destroy');
        if (runtimeState.styleDestroyError) throw runtimeState.styleDestroyError;
      },
      subscribe: () => () => undefined,
    };
    runtimeState.styleController = controller;
    return controller;
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
        focusedNodeId: null,
        selectedNodeIds: runtimeState.selectedNodeIds,
        status: 'detached',
      },
      setActiveTool(toolId: string) {
        editor.state.activeToolId = toolId;
        runtimeState.activeToolIds.push(toolId);
      },
      setSelectionAppearance(appearance: unknown) {
        runtimeState.selectionAppearances.push(appearance);
      },
      suppressSelectionOverlay: vi.fn(),
      restoreSelectionOverlay: vi.fn(),
      subscribe: () => () => undefined,
    };
    const widgets = {
      state: {
        revision: 0,
        frameNodeId: null as string | null,
        contentNodeId: null as string | null,
        maximizedNodeId: null as string | null,
        hovered: null,
        pressed: null,
        cursor: null,
      },
      enterContentMode: vi.fn(() => true),
      enterFrameMode: vi.fn(),
      clearContentFocus: vi.fn(),
      restore: vi.fn(() => true),
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
    };
    runtimeState.editorController = editor;
    runtimeState.widgetController = widgets;
    return {
      editor,
      widgets,
      paths: {
        setAppearance(appearance: unknown) {
          runtimeState.pathAppearances.push(appearance);
        },
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
      runtimeState.documentStartHook?.();
    }

    async dispose(): Promise<void> {
      runtimeState.events.push('document:dispose');
    }

    reproject(): boolean {
      runtimeState.events.push('document:reproject');
      return true;
    }

  },
}));

import { buildRuntime } from '../src/runtime';
import {
  fnCanvasBackgroundProjection,
} from '../src/fn.canvas-background-projection';
import {
  fnCanginePathAppearance,
  fnCangineSelectionAppearance,
} from '../src/fn.cangine-theme-appearance';

const themeService = {
  getTheme: () => runtimeState.theme,
  getSnapshot: () => ({ revision: 1, definition: runtimeState.theme }),
  getDefaultStyle: (scope: string) => ({
    ...(scope === 'rect' || scope === 'ellipse'
      ? { backgroundColor: 'neutral' }
      : { strokeColor: 'neutral' }),
  }),
  subscribeThemeChange(listener: NonNullable<typeof runtimeState.themeListener>) {
    runtimeState.themeListener = listener;
    return () => {
      runtimeState.events.push('theme:release');
      runtimeState.themeListener = null;
    };
  },
} as never;

const wait = Object.freeze({
  wait: () => Object.freeze({
    promise: Promise.resolve(),
    cancel: () => undefined,
  }),
});

describe('canvas runtime composition', () => {
  beforeEach(() => {
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
    runtimeState.widgetController = null;
    runtimeState.editorController = null;
    runtimeState.activeToolIds.length = 0;
    runtimeState.segmentModes.length = 0;
    runtimeState.selectionAppearances.length = 0;
    runtimeState.pathAppearances.length = 0;
    runtimeState.selectedNode = null;
    runtimeState.selectedNodeIds.length = 0;
    runtimeState.fontPreloads.length = 0;
    runtimeState.fontRegistrations.length = 0;
    runtimeState.sessionConfig = null;
    runtimeState.styleConfig = null;
    runtimeState.styleController = null;
    runtimeState.styleDestroyError = null;
    runtimeState.projectionCreateArgs = null;
    runtimeState.projectionSnapshots.length = 0;
    runtimeState.projectionDisposed = false;
    runtimeState.projectionReplaceError = null;
    runtimeState.documentStartHook = null;
    runtimeState.theme = BUILTIN_THEMES[0]!;
    runtimeState.themeListener = null;
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
      projections: {
        createOwner(ownerId: string, options: unknown) {
          runtimeState.projectionCreateArgs = { ownerId, options };
          runtimeState.events.push('projection:create');
          return {
            id: ownerId,
            band: 'background',
            orderKey: '1000000000000000',
            hitTest: 'none',
            get revision() {
              return runtimeState.projectionSnapshots.length;
            },
            get status() {
              return runtimeState.projectionDisposed ? 'disposed' : 'active';
            },
            replace(snapshot: unknown) {
              if (runtimeState.projectionReplaceError !== null) {
                throw runtimeState.projectionReplaceError;
              }
              if (
                JSON.stringify(snapshot)
                === JSON.stringify(runtimeState.projectionSnapshots.at(-1))
              ) return false;
              runtimeState.projectionSnapshots.push(snapshot);
              runtimeState.events.push('projection:replace');
              return true;
            },
            dispose() {
              runtimeState.projectionDisposed = true;
              runtimeState.events.push('projection:dispose');
            },
          };
        },
      },
      resources: {
        register(
          descriptor: Record<string, unknown>,
          source: Record<string, unknown>,
        ) {
          runtimeState.fontRegistrations.push({ descriptor, source });
        },
        async preload(resourceIds: string[]) {
          runtimeState.fontPreloads.push(...resourceIds);
          runtimeState.events.push('fonts:preload');
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
      async destroy() {
        runtimeState.events.push('engine:destroy');
      },
    };
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
      container,
      transport: {} as never,
      createId: () => 'id-a',
      wait,
      themeService,
      image,
      notification: {
        showError: vi.fn(),
        showInfo: vi.fn(),
        showSuccess: vi.fn(),
      },
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

    runtimeState.documentStartHook = () => {
      runtimeState.theme = BUILTIN_THEMES[3]!;
      runtimeState.themeListener?.(BUILTIN_THEMES[3]!);
    };
    await runtime.boot();

    const engineConfig = runtimeState.engineConfig as Record<string, unknown>;
    const sessionConfig = runtimeState.sessionConfig as {
      editor: {
        creation: {
          textFontFamilies: string[];
          decorate: (context: unknown, node: unknown) => unknown;
        };
        history: { adapter: unknown };
        sceneMutationPort: unknown;
        selectionAppearance: unknown;
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
    const styleConfig = runtimeState.styleConfig as {
      editor: unknown;
      fontFamilies: string[][];
      continuousClock: {
        requestFrame(callback: FrameRequestCallback): number;
        cancelFrame(handle: number): void;
      };
      decorateMutation(context: unknown): unknown;
      onCallbackError(error: unknown): void;
    };
    expect(engineConfig).not.toHaveProperty('record');
    expect(engineConfig.host).toBe(container);
    expect(runtimeState.engine).not.toHaveProperty('resize');
    expect(runtimeState.projectionCreateArgs).toEqual({
      ownerId: 'omnidraw:canvas-background',
      options: {
        band: 'background',
        orderKey: '1000000000000000',
        hitTest: 'none',
      },
    });
    expect(runtimeState.events.indexOf('projection:replace')).toBeLessThan(
      runtimeState.events.indexOf('document:start'),
    );
    expect(runtimeState.projectionSnapshots).toEqual([
      fnCanvasBackgroundProjection({
        viewport: BUILTIN_THEMES[0]!.canvas.viewport,
        gridVisible: true,
      }),
      fnCanvasBackgroundProjection({
        viewport: BUILTIN_THEMES[3]!.canvas.viewport,
        gridVisible: true,
      }),
    ]);
    expect(runtime.setGridVisible(true)).toBe(false);
    runtimeState.projectionReplaceError = new Error('projection failed');
    expect(() => runtime.setGridVisible(false)).toThrow('projection failed');
    runtimeState.projectionReplaceError = null;
    expect(runtime.setGridVisible(false)).toBe(true);
    expect(runtimeState.projectionSnapshots).toHaveLength(3);
    runtimeState.theme = BUILTIN_THEMES[2]!;
    runtimeState.themeListener?.(BUILTIN_THEMES[2]!);
    expect(runtimeState.projectionSnapshots).toHaveLength(4);
    expect(runtimeState.selectionAppearances.at(-1)).toEqual(
      fnCangineSelectionAppearance(BUILTIN_THEMES[2]!.canvas.selection),
    );
    expect(runtimeState.pathAppearances.at(-1)).toEqual(
      fnCanginePathAppearance(BUILTIN_THEMES[2]!.canvas.path),
    );
    expect(runtime.engine()?.scene.revision).toBe(1);
    expect(runtimeState.projectionSnapshots[3]).toEqual(
      fnCanvasBackgroundProjection({
        viewport: BUILTIN_THEMES[2]!.canvas.viewport,
        gridVisible: false,
      }),
    );
    runtimeState.themeListener?.(BUILTIN_THEMES[2]!);
    expect(runtimeState.projectionSnapshots).toHaveLength(4);
    expect(sessionConfig.editor.sceneMutationPort).toBe(
      runtimeState.documentInstance,
    );
    expect(sessionConfig.editor.history.adapter).toBe(
      runtimeState.documentInstance?.history,
    );
    expect(sessionConfig.editor.creation.textFontFamilies)
      .toEqual(['Inter', 'sans-serif']);
    expect(sessionConfig.editor.creation.decorate).toEqual(expect.any(Function));
    expect(sessionConfig.editor.selectionAppearance).toEqual(
      fnCangineSelectionAppearance(BUILTIN_THEMES[3]!.canvas.selection),
    );
    expect(sessionConfig.clipboardImage.imageImportPort).toBe(
      runtimeState.documentInstance,
    );
    expect(dropConfig.imageImportPort).toBe(runtimeState.documentInstance);
    expect(dropConfig.dropTarget).toBe(container);
    expect(dropConfig.fileInput.accept).toBe(
      'image/jpeg,image/png,image/gif,image/webp',
    );
    expect(styleConfig.editor).toBe(runtime.editor());
    expect(styleConfig.decorateMutation).toEqual(expect.any(Function));
    expect(styleConfig.fontFamilies).toEqual([
      ['Inter', 'sans-serif'],
      ['Fraunces', 'serif'],
      ['JetBrains Mono', 'monospace'],
    ]);
    expect(runtimeState.fontRegistrations).toHaveLength(12);
    expect(runtimeState.fontRegistrations.map(({ descriptor, source }) => ({
      family: descriptor.family,
      mimeType: descriptor.mimeType,
      url: source.url,
      weight: descriptor.weight,
    }))).toEqual([
      ...['Inter', 'Fraunces', 'JetBrains Mono'].flatMap((family) => (
        [400, 500, 600, 700].map((weight) => expect.objectContaining({
          family,
          url: expect.stringMatching(/\/assets\/fonts\/.+\.(ttf|woff2)$/),
          weight,
        }))
      )),
    ]);
    expect(runtimeState.fontPreloads).toHaveLength(12);
    expect(runtimeState.events.indexOf('fonts:preload')).toBeLessThan(
      runtimeState.events.indexOf('document:start'),
    );
    expect(runtime.selectionStyles()).toBe(runtimeState.styleController);
    expect(runtimeState.events.indexOf('selection-style:attach')).toBeGreaterThan(
      runtimeState.events.indexOf('editor:attach'),
    );

    const lateThemeChange = runtimeState.themeListener;
    await runtime.shutdown();

    expect(runtimeState.events).toEqual(expect.arrayContaining([
      'extension:second:dispose',
      'extension:first:dispose',
      'image-drop:destroy',
      'selection-style:destroy',
      'editor:destroy',
      'theme:release',
      'projection:dispose',
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
      'selection-style:destroy',
      'editor:destroy',
      'projection:dispose',
      'document:dispose',
      'engine:destroy',
    ]);
    expect(container.childNodes).toHaveLength(0);
    expect(runtime.selectionStyles()).toBeNull();
    expect(runtimeState.projectionDisposed).toBe(true);
    expect(runtimeState.themeListener).toBeNull();
    runtimeState.theme = BUILTIN_THEMES[1]!;
    lateThemeChange?.(BUILTIN_THEMES[1]!);
    expect(runtimeState.projectionSnapshots).toHaveLength(4);
  });

  test('projects one exclusive widget shell and centrally mounts only owned overlays', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const canvasOverlayStates: boolean[] = [];
    const activeWidgetOverlayStates: boolean[] = [];
    const siblingWidgetOverlayStates: boolean[] = [];
    const runtime = buildRuntime({
      canvasId: 'canvas-shell',
      container,
      transport: {} as never,
      createId: () => 'id-shell',
      wait,
      themeService,
    }, [{
      name: 'shell-overlays',
      install(context) {
        context.shell.registerOverlay({
          ownership: { kind: 'canvas-shell' },
          setMounted: (mounted) => canvasOverlayStates.push(mounted),
        });
        context.shell.registerOverlay({
          ownership: { kind: 'widget-shell', widgetId: 'widget-active' },
          setMounted: (mounted) => activeWidgetOverlayStates.push(mounted),
        });
        context.shell.registerOverlay({
          ownership: { kind: 'widget-shell', widgetId: 'widget-sibling' },
          setMounted: (mounted) => siblingWidgetOverlayStates.push(mounted),
        });
        return {};
      },
    }]);
    await runtime.boot();

    const widgets = runtimeState.widgetController as {
      state: {
        frameNodeId: string | null;
        contentNodeId: string | null;
        maximizedNodeId: string | null;
      };
      enterContentMode: ReturnType<typeof vi.fn>;
      enterFrameMode: ReturnType<typeof vi.fn>;
      clearContentFocus: ReturnType<typeof vi.fn>;
      restore: ReturnType<typeof vi.fn>;
    };
    const editor = runtimeState.editorController as {
      suppressSelectionOverlay: ReturnType<typeof vi.fn>;
      restoreSelectionOverlay: ReturnType<typeof vi.fn>;
    };
    widgets.enterContentMode.mockImplementation((widgetId: string) => {
      widgets.state.frameNodeId = null;
      widgets.state.contentNodeId = widgetId;
      return true;
    });
    widgets.enterFrameMode.mockImplementation((widgetId: string) => {
      widgets.state.frameNodeId = widgetId;
      widgets.state.contentNodeId = null;
    });
    widgets.clearContentFocus.mockImplementation(() => {
      widgets.state.contentNodeId = null;
    });
    widgets.restore.mockImplementation(() => {
      widgets.state.maximizedNodeId = null;
      return true;
    });
    runtimeState.selectedNode = {
      id: 'widget-active',
      kind: 'widget-frame',
      collapsed: false,
      visibility: 'visible',
    };

    widgets.state.frameNodeId = 'widget-active';
    widgets.state.maximizedNodeId = 'widget-active';
    runtimeState.widgetListener?.({});
    expect(widgets.enterContentMode).not.toHaveBeenCalled();
    expect(runtime.shell()).toEqual({
      kind: 'maximized-widget',
      widgetId: 'widget-active',
    });
    expect(canvasOverlayStates.at(-1)).toBe(false);
    expect(activeWidgetOverlayStates.at(-1)).toBe(true);
    expect(siblingWidgetOverlayStates.at(-1)).toBe(false);
    expect(container.querySelector<HTMLInputElement>('[data-omnidraw-image-input]')?.disabled)
      .toBe(true);
    expect(editor.suppressSelectionOverlay).toHaveBeenCalledOnce();

    widgets.state.maximizedNodeId = null;
    runtimeState.widgetListener?.({});
    expect(widgets.clearContentFocus).not.toHaveBeenCalled();
    expect(widgets.enterFrameMode).toHaveBeenCalledWith('widget-active');
    expect(runtime.shell()).toEqual({
      kind: 'contained-widget',
      widgetId: 'widget-active',
    });
    expect(canvasOverlayStates.at(-1)).toBe(true);
    expect(activeWidgetOverlayStates.at(-1)).toBe(true);
    expect(siblingWidgetOverlayStates.at(-1)).toBe(true);
    expect(editor.restoreSelectionOverlay).toHaveBeenCalledOnce();

    widgets.state.frameNodeId = null;
    widgets.state.contentNodeId = 'widget-active';
    widgets.state.maximizedNodeId = 'widget-active';
    const contentEntryCalls = widgets.enterContentMode.mock.calls.length;
    const contentClearCalls = widgets.clearContentFocus.mock.calls.length;
    runtimeState.widgetListener?.({});
    expect(widgets.enterContentMode).toHaveBeenCalledTimes(contentEntryCalls);
    expect(widgets.clearContentFocus).toHaveBeenCalledTimes(contentClearCalls + 1);
    expect(widgets.state.contentNodeId).toBeNull();
    expect(runtime.shell().kind).toBe('maximized-widget');

    runtimeState.selectedNode = {
      id: 'widget-active',
      kind: 'widget-frame',
      collapsed: true,
      visibility: 'visible',
    };
    runtimeState.widgetListener?.({});
    expect(widgets.restore).toHaveBeenCalledWith('widget-active');
    expect(runtime.shell()).toEqual({ kind: 'canvas', widgetId: null });

    await runtime.shutdown();
    expect(canvasOverlayStates.at(-1)).toBe(false);
    expect(activeWidgetOverlayStates.at(-1)).toBe(false);
    expect(siblingWidgetOverlayStates.at(-1)).toBe(false);
    expect(runtime.shell()).toEqual({ kind: 'canvas', widgetId: null });
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
        cangineVersion: '0.6.0',
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
      container,
      transport: {} as never,
      createId: () => 'id-a',
      wait,
      themeService,
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
      container,
      transport: {} as never,
      createId: () => 'id-a',
      wait,
      themeService,
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

  test('reports style callbacks and clears ownership before failed teardown', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const showError = vi.fn();
    const runtime = buildRuntime({
      canvasId: 'canvas-a',
      container,
      transport: {} as never,
      createId: () => 'id-a',
      wait,
      themeService,
      notification: {
        showError,
        showInfo: vi.fn(),
        showSuccess: vi.fn(),
      },
    });
    await runtime.boot();

    const styleConfig = runtimeState.styleConfig as {
      onCallbackError(error: unknown): void;
    };
    styleConfig.onCallbackError(new Error('style callback failed'));
    expect(showError).toHaveBeenCalledWith(
      'Selection style failed',
      'style callback failed',
    );

    runtimeState.styleDestroyError = new Error('style teardown failed');
    await expect(runtime.shutdown()).rejects.toThrow('style teardown failed');
    expect(runtime.selectionStyles()).toBeNull();
    expect(runtimeState.events).toEqual(expect.arrayContaining([
      'selection-style:destroy',
      'editor:destroy',
      'document:dispose',
      'engine:destroy',
    ]));

    await runtime.shutdown();
    expect(runtimeState.events.filter(
      (event) => event === 'selection-style:destroy',
    )).toHaveLength(1);
  });

  test('exposes only supported selected connector segment changes', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const runtime = buildRuntime({
      canvasId: 'canvas-a',
      container,
      transport: {} as never,
      createId: () => 'id-a',
      wait,
      themeService,
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
