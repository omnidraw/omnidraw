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
  fontPreloads: [] as string[],
  fontRegistrations: [] as Array<{
    descriptor: Record<string, unknown>;
    source: Record<string, unknown>;
  }>,
  sessionConfig: null as unknown,
  styleConfig: null as unknown,
  styleController: null as unknown,
  styleDestroyError: null as Error | null,
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
        selectedNodeIds: [],
        status: 'detached',
      },
      subscribe: () => () => undefined,
    };
    return {
      editor,
      widgets: {
        state: { contentNodeId: null },
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
    runtimeState.documentInstance = null;
    runtimeState.documentOptions = null;
    runtimeState.dropConfig = null;
    runtimeState.engineConfig = null;
    runtimeState.events.length = 0;
    runtimeState.fontPreloads.length = 0;
    runtimeState.fontRegistrations.length = 0;
    runtimeState.sessionConfig = null;
    runtimeState.styleConfig = null;
    runtimeState.styleController = null;
    runtimeState.styleDestroyError = null;
    runtimeState.engine = {
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

    await runtime.boot();

    const engineConfig = runtimeState.engineConfig as Record<string, unknown>;
    const sessionConfig = runtimeState.sessionConfig as {
      editor: {
        creation: { textFontFamilies: string[] };
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
    const styleConfig = runtimeState.styleConfig as {
      editor: unknown;
      fontFamilies: string[][];
      continuousClock: {
        requestFrame(callback: FrameRequestCallback): number;
        cancelFrame(handle: number): void;
      };
      onCallbackError(error: unknown): void;
    };
    expect(engineConfig).not.toHaveProperty('record');
    expect(sessionConfig.editor.sceneMutationPort).toBe(
      runtimeState.documentInstance,
    );
    expect(sessionConfig.editor.history.adapter).toBe(
      runtimeState.documentInstance?.history,
    );
    expect(sessionConfig.editor.creation.textFontFamilies)
      .toEqual(['Inter', 'sans-serif']);
    expect(sessionConfig.clipboardImage.imageImportPort).toBe(
      runtimeState.documentInstance,
    );
    expect(dropConfig.imageImportPort).toBe(runtimeState.documentInstance);
    expect(dropConfig.dropTarget).toBe(container);
    expect(dropConfig.fileInput.accept).toBe(
      'image/jpeg,image/png,image/gif,image/webp',
    );
    expect(styleConfig.editor).toBe(runtime.editor());
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
          url: expect.stringMatching(/^\/fonts\/.+\.(ttf|woff2)$/),
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

    await runtime.shutdown();

    expect(runtimeState.events).toEqual(expect.arrayContaining([
      'extension:second:dispose',
      'extension:first:dispose',
      'image-drop:destroy',
      'selection-style:destroy',
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
      'selection-style:destroy',
      'editor:destroy',
      'document:dispose',
      'engine:destroy',
    ]);
    expect(container.childNodes).toHaveLength(0);
    expect(runtime.selectionStyles()).toBeNull();
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

  test('reports style callbacks and clears ownership before failed teardown', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const showError = vi.fn();
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
});
