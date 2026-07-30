import {
  createInfiniteCanvas,
  type IInfiniteCanvasEngine,
} from '@omnidraw/cangine';
import {
  createImageDropController,
  createSelectionStyleController,
  createStandardEditorSession,
  type IImageDropController,
  type ISelectionStyleController,
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

const IMAGE_FILE_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp';
const FONT_WEIGHTS = [400, 500, 600, 700] as const;
const FONT_FAMILIES = [
  ['Inter', 'sans-serif', 'inter', 'woff2'],
  ['Fraunces', 'serif', 'fraunces', 'ttf'],
  ['JetBrains Mono', 'monospace', 'jetbrains-mono', 'woff2'],
] as const;
const FONT_RESOURCES = FONT_FAMILIES.flatMap(([family, , slug, format]) => (
  FONT_WEIGHTS.map((weight) => ({
    descriptor: {
      id: `vibecanvas-font:${slug}:${weight}`,
      type: 'font' as const, family, weight,
      style: 'normal' as const, mimeType: `font/${format}`,
    },
    source: { type: 'url' as const, url: `/fonts/${slug}-${weight}.${format}` },
  }))
));

export type TCanvasRuntime = Readonly<{
  boot(): Promise<void>;
  shutdown(): Promise<void>;
  editor(): IStandardCanvasEditor | null;
  engine(): IInfiniteCanvasEngine | null;
  document(): CanvasDocumentService | null;
  selectionStyles(): ISelectionStyleController | null;
  openImagePicker(): void;
  widgetContentFocused(): boolean;
}>;

export function buildRuntime(
  config: TCanvasRuntimeConfig,
  extensions: readonly ICanvasRuntimeExtension[] = [],
): TCanvasRuntime {
  let engine: IInfiniteCanvasEngine | null = null;
  let editorSession: IStandardEditorSession | null = null;
  let selectionStyleController: ISelectionStyleController | null = null;
  let documentService: CanvasDocumentService | null = null;
  let imageDropController: IImageDropController | null = null;
  let imageInput: HTMLInputElement | null = null;
  let resizeObserver: ResizeObserver | null = null;
  const installs: TCanvasRuntimeExtensionInstall[] = [];
  const reportError = (title: string) => (error: unknown) => (
    config.notification?.showError(
      title,
      error instanceof Error ? error.message : String(error),
    )
  );

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
      for (const font of FONT_RESOURCES) engine.resources.register(font.descriptor, font.source);
      await engine.resources.preload(FONT_RESOURCES.map((font) => font.descriptor.id));
      documentService = new CanvasDocumentService({
        canvasId: config.canvasId,
        transport: config.transport,
        createCommandId: config.createId,
        image: config.image,
        onError: reportError('Canvas synchronization failed'),
      });
      await documentService.start(engine);
      editorSession = createStandardEditorSession({
        engine,
        host: config.container,
        editor: {
          contentParentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
          createNodeId: config.createId,
          sceneMutationPort: documentService,
          history: { kind: 'custom', adapter: documentService.history },
          creation: {
            textFontFamilies: [FONT_FAMILIES[0][0], FONT_FAMILIES[0][1]],
            ...(extensions.some((extension) => extension.createWidgetNodes !== undefined)
              ? {
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
                }
              : {}),
          },
          onCallbackError: reportError('Canvas action failed'),
        },
        navigationKeyTarget: config.container,
        clipboardImage: {
          parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
          imageImportPort: documentService,
          onError: reportError('Image paste failed'),
        },
        onCallbackError: reportError('Canvas editor failed'),
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
        onError: reportError('Image import failed'),
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
      const ownerWindow = config.container.ownerDocument.defaultView;
      if (ownerWindow === null) {
        throw new Error('Canvas selection styles require an owning window.');
      }
      selectionStyleController = createSelectionStyleController({
        editor: editorSession.editor,
        fontFamilies: FONT_FAMILIES.map(([family, fallback]) => [family, fallback]),
        continuousClock: {
          requestFrame: ownerWindow.requestAnimationFrame.bind(ownerWindow),
          cancelFrame: ownerWindow.cancelAnimationFrame.bind(ownerWindow),
        },
        onCallbackError: reportError('Selection style failed'),
      });
      selectionStyleController.attach();
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
      const styles = selectionStyleController;
      selectionStyleController = null;
      await attempt(() => styles?.destroy());
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
    selectionStyles: () => selectionStyleController,
    openImagePicker: () => imageInput?.click(),
    widgetContentFocused: () => {
      const contentNodeId = editorSession?.widgets.state.contentNodeId;
      return contentNodeId !== null && contentNodeId !== undefined;
    },
  });
}
