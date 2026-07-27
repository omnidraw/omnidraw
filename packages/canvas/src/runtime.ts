import {
  createInfiniteCanvas,
  type IInfiniteCanvasEngine,
} from '@omnidraw/cangine';
import {
  createStandardEditorSession,
  type IStandardCanvasEditor,
  type IStandardEditorSession,
} from '@omnidraw/cangine/editor';
import { CANVAS_SYNTHETIC_CONTENT_LAYER_ID } from '@vibecanvas/canvas-contract';
import type {
  ICanvasRuntimeExtension,
  TCanvasRuntimeExtensionInstall,
} from './extension';
import { CanvasDocumentService } from './services/CanvasDocumentService';
import type { TCanvasRuntimeConfig } from './types';

export type TCanvasRuntime = Readonly<{
  boot(): Promise<void>;
  shutdown(): Promise<void>;
  editor(): IStandardCanvasEditor | null;
  engine(): IInfiniteCanvasEngine | null;
  document(): CanvasDocumentService | null;
}>;

export function buildRuntime(
  config: TCanvasRuntimeConfig,
  extensions: readonly ICanvasRuntimeExtension[] = [],
): TCanvasRuntime {
  let engine: IInfiniteCanvasEngine | null = null;
  let editorSession: IStandardEditorSession | null = null;
  let documentService: CanvasDocumentService | null = null;
  let resizeObserver: ResizeObserver | null = null;
  const installs: TCanvasRuntimeExtensionInstall[] = [];

  return Object.freeze({
    async boot() {
      if (engine) throw new Error('Canvas runtime is already running.');
      engine = await createInfiniteCanvas({
        host: config.container,
        renderProfile: {
          vector2D: 'webgl2',
          threeD: 'disabled',
          portals: 'dom',
          fallbackOrder: ['webgl2', 'svg'],
          antialias: true,
        },
        record: {
          actor: config.tenant.accountId,
          capacity: 512,
        },
      });
      documentService = new CanvasDocumentService({
        canvasId: config.canvasId,
        transport: config.transport,
        createCommandId: config.createId,
        onError: (error) => config.notification?.showError(
          'Canvas synchronization failed',
          error instanceof Error ? error.message : String(error),
        ),
      });
      await documentService.start(engine);
      editorSession = createStandardEditorSession({
        engine,
        host: config.container,
        editor: {
          contentParentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
          createNodeId: config.createId,
          history: {
            kind: 'custom',
            adapter: documentService.history,
          },
          ...(extensions.some((extension) => extension.createWidgetNodes !== undefined)
            ? {
                creation: {
                  factories: {
                    widget: (creation) => {
                      for (const extension of extensions) {
                        const nodes = extension.createWidgetNodes?.({
                          config,
                          creation,
                          engine: engine!,
                        });
                        if (nodes !== undefined && nodes !== null) return nodes;
                      }
                      return null;
                    },
                  },
                },
              }
            : {}),
          onCallbackError: (error) => config.notification?.showError(
            'Canvas action failed',
            error instanceof Error ? error.message : String(error),
          ),
        },
        navigationKeyTarget: config.container,
        clipboardImage: false,
        onCallbackError: (error) => config.notification?.showError(
          'Canvas editor failed',
          error instanceof Error ? error.message : String(error),
        ),
      });
      for (const extension of extensions) {
        installs.push(await extension.install({
          config,
          document: documentService,
          editor: editorSession.editor,
          engine,
          widgets: editorSession.widgets,
        }));
      }
      editorSession.attach();
      resizeObserver = new ResizeObserver(() => engine?.resize());
      resizeObserver.observe(config.container);
      engine.resize();
    },
    async shutdown() {
      resizeObserver?.disconnect();
      resizeObserver = null;
      editorSession?.destroy();
      editorSession = null;
      for (const install of installs.splice(0).reverse()) {
        await install.dispose?.();
      }
      await documentService?.dispose();
      documentService = null;
      await engine?.destroy();
      engine = null;
      config.container.replaceChildren();
    },
    editor: () => editorSession?.editor ?? null,
    engine: () => engine,
    document: () => documentService,
  });
}
