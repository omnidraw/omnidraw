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
        contentNodeId: null,
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
    runtimeState.sessionConfig = null;
    runtimeState.engine = {
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
});
