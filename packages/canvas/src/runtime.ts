import {
  createInfiniteCanvas,
  type IInfiniteCanvasEngine,
} from '@omnidraw/cangine';
import {
  createImageDropController,
  createStandardEditorSession,
  type IImageDropController,
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

const IMAGE_FILE_ACCEPT = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
].join(',');

export type TCanvasRuntime = Readonly<{
  boot(): Promise<void>;
  shutdown(): Promise<void>;
  editor(): IStandardCanvasEditor | null;
  engine(): IInfiniteCanvasEngine | null;
  document(): CanvasDocumentService | null;
  openImagePicker(): void;
  widgetContentFocused(): boolean;
}>;

export function buildRuntime(
  config: TCanvasRuntimeConfig,
  extensions: readonly ICanvasRuntimeExtension[] = [],
): TCanvasRuntime {
  let engine: IInfiniteCanvasEngine | null = null;
  let editorSession: IStandardEditorSession | null = null;
  let documentService: CanvasDocumentService | null = null;
  let imageDropController: IImageDropController | null = null;
  let imageInput: HTMLInputElement | null = null;
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
      });
      documentService = new CanvasDocumentService({
        canvasId: config.canvasId,
        transport: config.transport,
        createCommandId: config.createId,
        image: config.image,
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
          sceneMutationPort: documentService,
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
        clipboardImage: {
          parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
          imageImportPort: documentService,
          onError: (error) => config.notification?.showError(
            'Image paste failed',
            error instanceof Error ? error.message : String(error),
          ),
        },
        onCallbackError: (error) => config.notification?.showError(
          'Canvas editor failed',
          error instanceof Error ? error.message : String(error),
        ),
      });
      imageInput = config.container.ownerDocument.createElement('input');
      imageInput.type = 'file';
      imageInput.accept = IMAGE_FILE_ACCEPT;
      imageInput.multiple = true;
      imageInput.hidden = true;
      imageInput.dataset.vibecanvasImageInput = '';
      config.container.append(imageInput);
      imageDropController = createImageDropController({
        editor: editorSession.editor,
        dropTarget: config.container,
        fileInput: imageInput,
        parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
        imageImportPort: documentService,
        onError: (error) => config.notification?.showError(
          'Image import failed',
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
      const errors: unknown[] = [];
      const attempt = async (
        operation: () => void | Promise<void>,
      ): Promise<void> => {
        try {
          await operation();
        } catch (error) {
          errors.push(error);
        }
      };
      const observer = resizeObserver;
      resizeObserver = null;
      await attempt(() => observer?.disconnect());
      for (const install of installs.splice(0).reverse()) {
        await attempt(() => install.dispose?.());
      }
      const dropController = imageDropController;
      imageDropController = null;
      await attempt(() => dropController?.destroy());
      const input = imageInput;
      imageInput = null;
      await attempt(() => input?.remove());
      const session = editorSession;
      editorSession = null;
      await attempt(() => session?.destroy());
      const document = documentService;
      documentService = null;
      await attempt(() => document?.dispose());
      const canvasEngine = engine;
      engine = null;
      await attempt(() => canvasEngine?.destroy());
      await attempt(() => config.container.replaceChildren());
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, 'Canvas runtime teardown failed.');
      }
    },
    editor: () => editorSession?.editor ?? null,
    engine: () => engine,
    document: () => documentService,
    openImagePicker: () => imageInput?.click(),
    widgetContentFocused: () => {
      const contentNodeId = editorSession?.widgets.state.contentNodeId;
      return contentNodeId !== null && contentNodeId !== undefined;
    },
  });
}
