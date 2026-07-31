import {
  createInfiniteCanvas,
  type IInfiniteCanvasEngine,
  type IRetainedProjectionOwner,
  type TConnectorRouting,
  type TInputEvent,
  type TTransformGestureEvent,
} from '@omnidraw/cangine';
import {
  createImageDropController,
  createSelectionStyleController,
  createStandardEditorSession,
  type IImageDropController,
  type ISelectionStyleController,
  type IStandardCanvasEditor,
  type IStandardEditorSession,
  type TPathSegmentMode,
} from '@omnidraw/cangine/editor';
import { CANVAS_SYNTHETIC_CONTENT_LAYER_ID } from '@omnidraw/canvas-contract';
import type {
  ICanvasRuntimeExtension,
  TCanvasRuntimeExtensionInstall,
} from './extension';
import { CanvasDocumentService } from './services/CanvasDocumentService';
import {
  fnCanvasBackgroundProjection,
} from './fn.canvas-background-projection';
import {
  createTracedCanvasDocumentTransport,
} from './debug-trace/createTracedCanvasDocumentTransport';
import {
  REPRODUCTION_TRACE_PASSIVE_INPUT_SAMPLE_RATE,
} from './debug-trace/CONSTANTS';
import type {
  TReproductionTraceEventInput,
  TReproductionTraceSink,
} from './debug-trace/typed';
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
      id: `omnidraw-font:${slug}:${weight}`,
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
  setGridVisible(visible: boolean): boolean;
  openImagePicker(): void;
  setSelectedConnectorSegmentMode(mode: TPathSegmentMode): void;
  widgetContentFocused(): boolean;
}>;

function connectorSegmentMode(
  routing: Readonly<TConnectorRouting>,
): TPathSegmentMode | null {
  switch (routing.type) {
    case 'straight':
      return 'straight';
    case 'quadratic':
    case 'bezier':
      return 'smooth';
    case 'orthogonal':
      return 'elbow';
    case 'manual':
      return null;
  }
}

function normalizedKeyIdentity(
  key: string,
  code: string,
): Readonly<{ key: string; code: string }> {
  if (code === 'Space' || Array.from(key).length !== 1) return { key, code };
  return { key: '[printable]', code: '[printable]' };
}

function inputTraceEvent(event: TInputEvent): TReproductionTraceEventInput {
  if (event.type.startsWith('pointer-')) {
    const pointer = event as Extract<TInputEvent, { type: `pointer-${string}` }>;
    return {
      channel: 'input.engine',
      type: event.type,
      priority: event.type === 'pointer-move' ? 'low' : 'high',
      correlation: {
        pointerId: String(pointer.pointerId),
        ...(pointer.hit === null ? {} : { nodeId: pointer.hit.nodeId }),
      },
      data: {
        pointerType: pointer.pointerType,
        button: pointer.button,
        buttons: pointer.buttons,
        pressure: pointer.pressure,
        viewport: pointer.viewport,
        world: pointer.world,
        modifiers: pointer.modifiers,
        hit: pointer.hit === null
          ? null
          : {
              nodeId: pointer.hit.nodeId,
              part: pointer.hit.part ?? null,
              path: pointer.hit.path,
            },
        ...('cancelReason' in pointer
          ? { cancelReason: pointer.cancelReason ?? null }
          : {}),
      },
    };
  }
  if (event.type === 'wheel') {
    return {
      channel: 'input.engine',
      type: event.type,
      priority: 'low',
      correlation: event.hit === null ? undefined : { nodeId: event.hit.nodeId },
      data: {
        viewport: event.viewport,
        world: event.world,
        delta: event.delta,
        deltaMode: event.deltaMode,
        modifiers: event.modifiers,
      },
    };
  }
  if (event.type === 'key-down' || event.type === 'key-up') {
    const identity = normalizedKeyIdentity(event.key, event.code);
    return {
      channel: 'input.engine',
      type: event.type,
      priority: 'high',
      data: {
        key: identity.key,
        code: identity.code,
        repeat: event.repeat,
        composing: event.composing,
        modifiers: event.modifiers,
      },
    };
  }
  const gesture = event as Extract<TInputEvent, {
    type:
      | 'gesture-start'
      | 'gesture-update'
      | 'gesture-end'
      | 'gesture-cancel';
  }>;
  return {
    channel: 'input.engine',
    type: gesture.type,
    priority: gesture.type === 'gesture-update' ? 'low' : 'high',
    data: {
      gesture: gesture.gesture,
      centroidViewport: gesture.centroidViewport,
      centroidWorld: gesture.centroidWorld,
      translation: gesture.translation,
      scale: gesture.scale,
      rotation: gesture.rotation,
      modifiers: gesture.modifiers,
    },
  };
}

function transformTraceEvent(
  event: TTransformGestureEvent,
): TReproductionTraceEventInput {
  return {
    channel: 'transform',
    type: event.type,
    priority: event.type === 'transform-update' ? 'low' : 'critical',
    correlation: {
      gestureId: event.gestureId,
      pointerId: String(event.pointerId),
      ...(event.proposals.length === 1
        ? { nodeId: event.proposals[0]!.nodeId }
        : {}),
    },
    data: {
      handle: event.handle,
      proposalCount: event.proposals.length,
      nodeIds: event.proposals.map((proposal) => proposal.nodeId),
      worldPointer: event.worldPointer,
      modifiers: event.modifiers,
    },
  };
}

function reportTraceCallbackError(
  trace: TReproductionTraceSink | null | undefined,
  scope: string,
  error: unknown,
): void {
  trace?.emit({
    channel: 'system',
    type: 'callback-error',
    priority: 'critical',
    data: {
      scope,
      error: error instanceof Error
        ? { name: error.name, message: error.message }
        : { name: 'Error', message: String(error) },
    },
  });
}

function installTraceSubscriptions(
  trace: TReproductionTraceSink,
  engine: IInfiniteCanvasEngine,
  session: IStandardEditorSession,
): () => void {
  const releases = [
    session.editor.subscribe((state) => {
      trace.emit({
        channel: 'editor',
        type: 'state-observed',
        priority: 'normal',
        correlation: state.focusedNodeId === null
          ? undefined
          : { nodeId: state.focusedNodeId },
        data: {
          revision: state.revision,
          status: state.status,
          activeToolId: state.activeToolId,
          selectedNodeIds: state.selectedNodeIds,
          focusedNodeId: state.focusedNodeId,
          canUndo: state.canUndo,
          canRedo: state.canRedo,
        },
      });
    }),
    session.widgets.subscribe((state) => {
      trace.emit({
        channel: 'widget-host',
        type: 'interaction-state-observed',
        priority: 'normal',
        correlation: state.contentNodeId === null
          ? undefined
          : { widgetId: state.contentNodeId },
        data: {
          revision: state.revision,
          frameNodeId: state.frameNodeId,
          contentNodeId: state.contentNodeId,
          maximizedNodeId: state.maximizedNodeId,
          hovered: state.hovered,
          pressed: state.pressed,
        },
      });
    }),
    session.widgets.subscribeActivation((activation) => {
      trace.emit({
        channel: 'widget-host',
        type: 'control-activated',
        priority: 'high',
        correlation: { widgetId: activation.widgetId },
        data: activation,
      });
    }),
    engine.scene.subscribe((change) => {
      trace.emit({
        channel: 'editor',
        type: 'scene-publication-observed',
        priority: 'low',
        data: {
          revision: engine.scene.revision,
          source: 'source' in change ? String(change.source) : 'unknown',
        },
      });
    }),
  ];
  return () => {
    for (const release of releases.reverse()) release();
  };
}

function installEarlyEngineTraceSubscriptions(
  trace: TReproductionTraceSink,
  engine: IInfiniteCanvasEngine,
): () => void {
  const activePointerIds = new Set<number>();
  const hitByPointerId = new Map<number, string>();
  const passiveMoveCountByPointerId = new Map<number, number>();
  let hoverIdentity = '';
  const releases = [
    engine.input.subscribe((event) => {
      if (!trace.isRecording()) return;
      const isPointer = (
        event.type.startsWith('pointer-')
        && 'pointerId' in event
      );
      if (isPointer && event.type === 'pointer-down') {
        activePointerIds.add(event.pointerId);
        passiveMoveCountByPointerId.delete(event.pointerId);
      }
      const isPassivePointerMove = (
        isPointer
        && event.type === 'pointer-move'
        && (
          event.buttons === 0
          || !activePointerIds.has(event.pointerId)
        )
      );
      let emitInput = true;
      if (isPassivePointerMove) {
        activePointerIds.delete(event.pointerId);
        const passiveCount = (
          passiveMoveCountByPointerId.get(event.pointerId) ?? 0
        ) + 1;
        passiveMoveCountByPointerId.set(event.pointerId, passiveCount);
        emitInput = (
          passiveCount % REPRODUCTION_TRACE_PASSIVE_INPUT_SAMPLE_RATE === 0
        );
      } else if (isPointer && event.type === 'pointer-move') {
        passiveMoveCountByPointerId.delete(event.pointerId);
      }
      if (emitInput) trace.emit(inputTraceEvent(event));
      if (
        'hit' in event
        && (
          !isPassivePointerMove
          || emitInput
        )
      ) {
        const hitIdentity = event.hit === null
          ? 'none'
          : [
              event.hit.nodeId,
              event.hit.part ?? '',
              ...event.hit.path,
            ].join(':');
        const previousHit = isPointer
          ? hitByPointerId.get(event.pointerId)
          : undefined;
        if (
          event.type !== 'pointer-move'
          || previousHit !== hitIdentity
        ) {
          trace.emit({
            channel: 'picking',
            type: 'hit-observed',
            priority: event.type === 'pointer-move' ? 'low' : 'high',
            correlation: {
              ...(isPointer
                ? { pointerId: String(event.pointerId) }
                : {}),
              ...(event.hit === null ? {} : { nodeId: event.hit.nodeId }),
            },
            data: {
              inputType: event.type,
              hit: event.hit === null
                ? null
                : {
                    nodeId: event.hit.nodeId,
                    part: event.hit.part ?? null,
                    path: event.hit.path,
                  },
            },
          });
        }
        if (isPointer) hitByPointerId.set(event.pointerId, hitIdentity);
      }
      if (
        isPointer
        && (
          event.type === 'pointer-up'
          || event.type === 'pointer-cancel'
        )
      ) {
        activePointerIds.delete(event.pointerId);
        hitByPointerId.delete(event.pointerId);
        passiveMoveCountByPointerId.delete(event.pointerId);
      }
    }),
    engine.transforms.subscribe((event) => {
      if (trace.isRecording()) trace.emit(transformTraceEvent(event));
    }),
    engine.transforms.subscribeHover((hover) => {
      if (!trace.isRecording() || activePointerIds.size === 0) return;
      const nextIdentity = hover === null
        ? 'none'
        : [
            hover.pointerId,
            hover.pointerType,
            hover.handle,
            hover.cursor,
          ].join(':');
      if (nextIdentity === hoverIdentity) return;
      hoverIdentity = nextIdentity;
      trace.emit({
        channel: 'picking',
        type: 'transform-hover-observed',
        priority: 'low',
        correlation: hover === null
          ? undefined
          : { pointerId: String(hover.pointerId) },
        data: hover === null
          ? { hover: null }
          : {
              pointerType: hover.pointerType,
              handle: hover.handle,
              cursor: hover.cursor,
            },
      });
    }),
  ];
  return () => {
    activePointerIds.clear();
    hitByPointerId.clear();
    passiveMoveCountByPointerId.clear();
    for (const release of releases.reverse()) release();
  };
}

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
  let releaseTraceSubscriptions: (() => void) | null = null;
  let releaseTraceLifecycle: (() => void) | null = null;
  let releaseEarlyEngineTrace: (() => void) | null = null;
  let releaseThemeChange: (() => void) | null = null;
  let canvasBackgroundProjection: IRetainedProjectionOwner | null = null;
  let gridVisible = config.initialGridVisible ?? true;
  const installs: TCanvasRuntimeExtensionInstall[] = [];
  const syncCanvasBackgroundProjection = (nextGridVisible: boolean) =>
    canvasBackgroundProjection?.replace(fnCanvasBackgroundProjection({
      colors: config.themeService.getTheme().colors,
      gridVisible: nextGridVisible,
    }));

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
      canvasBackgroundProjection = engine.projections.createOwner(
        'omnidraw:canvas-background',
        {
          band: 'background',
          orderKey: '1000000000000000',
          hitTest: 'none',
        },
      );
      syncCanvasBackgroundProjection(gridVisible);
      releaseThemeChange = config.themeService.hooks.change.tap(
        () => syncCanvasBackgroundProjection(gridVisible),
      );
      if (config.trace !== undefined && config.trace !== null) {
        releaseEarlyEngineTrace = installEarlyEngineTraceSubscriptions(
          config.trace,
          engine,
        );
      }
      for (const font of FONT_RESOURCES) {
        engine.resources.register(font.descriptor, font.source);
      }
      await engine.resources.preload(FONT_RESOURCES.map((font) => font.descriptor.id));
      documentService = new CanvasDocumentService({
        canvasId: config.canvasId,
        transport: createTracedCanvasDocumentTransport(
          config.transport,
          config.trace ?? null,
        ),
        createCommandId: config.createId,
        image: config.image,
        observe: config.trace === undefined || config.trace === null
          ? undefined
          : (observation) => config.trace?.emit({
              channel: 'document',
              type: observation.phase,
              priority: observation.priority,
              correlation: {
                canvasId: config.canvasId,
                ...(observation.transactionId === undefined
                  ? {}
                  : { transactionId: observation.transactionId }),
                ...(observation.commandId === undefined
                  ? {}
                  : { commandId: observation.commandId }),
                ...(observation.nodeIds?.length === 1
                  ? { nodeId: observation.nodeIds[0] }
                  : {}),
              },
              data: {
                acceptedRevision: observation.acceptedRevision,
                projectedSceneRevision: observation.projectedSceneRevision,
                pendingCount: observation.pendingCount,
                nodeIds: observation.nodeIds ?? [],
                ...observation.data,
              },
            }),
        onError: (error) => {
          reportTraceCallbackError(config.trace, 'document', error);
          config.notification?.showError(
            'Canvas synchronization failed',
            error instanceof Error ? error.message : String(error),
          );
        },
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
            ...(extensions.some(
              (extension) => extension.createWidgetNodes !== undefined,
            )
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
          onCallbackError: (error) => {
            reportTraceCallbackError(config.trace, 'editor', error);
            config.notification?.showError(
              'Canvas action failed',
              error instanceof Error ? error.message : String(error),
            );
          },
        },
        navigationKeyTarget: config.container,
        clipboardImage: {
          parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
          imageImportPort: documentService,
          onError: (error) => {
            reportTraceCallbackError(config.trace, 'clipboard-image', error);
            config.notification?.showError(
              'Image paste failed',
              error instanceof Error ? error.message : String(error),
            );
          },
        },
        onCallbackError: (error) => {
          reportTraceCallbackError(config.trace, 'editor-session', error);
          config.notification?.showError(
            'Canvas editor failed',
            error instanceof Error ? error.message : String(error),
          );
        },
      });
      imageInput = config.container.ownerDocument.createElement('input');
      imageInput.type = 'file';
      imageInput.accept = IMAGE_FILE_ACCEPT;
      imageInput.multiple = true;
      imageInput.hidden = true;
      imageInput.dataset.omnidrawImageInput = '';
      config.container.append(imageInput);
      imageDropController = createImageDropController({
        editor: editorSession.editor,
        dropTarget: config.container,
        fileInput: imageInput,
        parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
        imageImportPort: documentService,
        onError: (error) => {
          reportTraceCallbackError(config.trace, 'image-import', error);
          config.notification?.showError(
            'Image import failed',
            error instanceof Error ? error.message : String(error),
          );
        },
      });
      for (const extension of extensions) {
        installs.push(await extension.install({
          config,
          document: documentService,
          editor: editorSession.editor,
          engine,
          trace: config.trace ?? null,
          widgets: editorSession.widgets,
        }));
      }
      editorSession.attach();
      if (config.trace !== undefined && config.trace !== null) {
        const owner = config.trace;
        const updateTraceSubscriptions = (recording: boolean) => {
          releaseTraceSubscriptions?.();
          releaseTraceSubscriptions = null;
          if (recording && engine !== null && editorSession !== null) {
            releaseTraceSubscriptions = installTraceSubscriptions(
              owner,
              engine,
              editorSession,
            );
          }
        };
        releaseTraceLifecycle = owner.subscribeLifecycle(
          updateTraceSubscriptions,
        );
      }
      const ownerWindow = config.container.ownerDocument.defaultView;
      if (ownerWindow === null) {
        throw new Error('Canvas selection styles require an owning window.');
      }
      selectionStyleController = createSelectionStyleController({
        editor: editorSession.editor,
        fontFamilies: FONT_FAMILIES.map(
          ([family, fallback]) => [family, fallback],
        ),
        continuousClock: {
          requestFrame: ownerWindow.requestAnimationFrame.bind(ownerWindow),
          cancelFrame: ownerWindow.cancelAnimationFrame.bind(ownerWindow),
        },
        onCallbackError: (error) => {
          reportTraceCallbackError(config.trace, 'selection-style', error);
          config.notification?.showError(
            'Selection style failed',
            error instanceof Error ? error.message : String(error),
          );
        },
      });
      selectionStyleController.attach();
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
      const traceLifecycle = releaseTraceLifecycle;
      releaseTraceLifecycle = null;
      await attempt(() => traceLifecycle?.());
      const traceSubscriptions = releaseTraceSubscriptions;
      releaseTraceSubscriptions = null;
      await attempt(() => traceSubscriptions?.());
      const earlyEngineTrace = releaseEarlyEngineTrace;
      releaseEarlyEngineTrace = null;
      await attempt(() => earlyEngineTrace?.());
      const backgroundProjection = canvasBackgroundProjection;
      canvasBackgroundProjection = null;
      const themeChange = releaseThemeChange;
      releaseThemeChange = null;
      await attempt(() => themeChange?.());
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
      await attempt(() => backgroundProjection?.dispose());
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
    setGridVisible: (visible) => {
      if (visible === gridVisible) return false;
      syncCanvasBackgroundProjection(visible);
      gridVisible = visible;
      return true;
    },
    openImagePicker: () => imageInput?.click(),
    setSelectedConnectorSegmentMode: (mode) => {
      const session = editorSession;
      if (session === null || session.paths === null) return;
      const selectedNodeIds = session.editor.state.selectedNodeIds;
      if (selectedNodeIds.length !== 1) return;
      const selectedNode = engine?.scene.get(selectedNodeIds[0]);
      if (
        selectedNode?.kind !== 'connector'
        || selectedNode.routing.type === 'manual'
      ) return;
      if (connectorSegmentMode(selectedNode.routing) === mode) return;
      if (session.editor.state.activeToolId !== 'select') {
        session.editor.setActiveTool('select');
      }
      session.paths.setSegmentMode(mode);
    },
    widgetContentFocused: () => {
      const contentNodeId = editorSession?.widgets.state.contentNodeId;
      return contentNodeId !== null && contentNodeId !== undefined;
    },
  });
}
