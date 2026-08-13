import {
  type IInfiniteCanvasEngine,
  type IRetainedProjectionOwner,
  type TConnectorRouting,
  type TInputEvent,
  type TSceneNode,
  type TTransformGestureEvent,
} from '@omnidraw/cangine';
import {
  createSelectionStyleController,
  createStandardEditorSession,
  type ISelectionStyleController,
  type IStandardCanvasEditor,
  type IStandardEditorSession,
  type TPathSegmentMode,
} from '@omnidraw/cangine/editor';
import type { TCanvasDocumentTransport } from '@omnidraw/canvas-contract';
import type { IThemeService } from '@omnidraw/theme';
import { Effect, Exit, type Scope } from 'effect';
import type {
  ICanvasExtension,
  TCanvasOverlayContribution,
} from './extension';
import { CanvasDocumentService } from './services/CanvasDocumentService';
import {
  fnCanvasBackgroundProjection,
} from './fn.canvas-background-projection';
import {
  fnCanginePathAppearance,
  fnCangineSelectionAppearance,
} from './fn.cangine-theme-appearance';
import {
  fnProjectSemanticCanvasNode,
} from './fn.semantic-canvas-style';
import {
  fnDecorateSemanticCanvasCreation,
  fnDecorateSemanticCanvasStyleMutation,
  fnThemeStyleScopeForCangineCreation,
} from './fn.semantic-canvas-decoration';
import {
  createTracedCanvasDocumentTransport,
} from './debug-trace/createTracedCanvasDocumentTransport';
import {
  REPRODUCTION_TRACE_PASSIVE_INPUT_SAMPLE_RATE,
} from './debug-trace/CONSTANTS';
import type {
  TReproductionTraceEventInput,
  TReproductionTraceOwner,
  TReproductionTraceSink,
} from './debug-trace/typed';
import type {
  TCanvasImagePort,
  TCanvasNotificationPort,
  TCanvasWaitPort,
} from './types';
import {
  fnCanvasInputGateSwallowsKeys,
  fnCanvasInputGateSwallowsWheel,
  fnCanvasShellFocusTransition,
  fnCanvasShellOwnsOverlay,
  fnCanvasShellProjection,
  fnCanvasWidgetShellAvailable,
  type TCanvasOverlayOwnership,
  type TCanvasShellFocusTransition,
  type TCanvasShellState,
} from './fn.canvas-shell';
import {
  CANVAS_RUNTIME_CONTENT_LAYER_ID,
  fnCanvasContractNodeToCangine,
} from './internal/cangine-contract-adapter';
import { CanvasExtensionBridge } from './internal/CanvasExtensionBridge';
import { CanvasInstanceScope } from './internal/CanvasInstanceScope';
import { CanvasScopeGeneration } from './internal/CanvasScopeGeneration';
import {
  createCanvasBackgroundOwner,
  createCanvasEngine,
} from './internal/CanvasCangineAdapter';
import {
  createCanvasImageInput,
  findCanvasWidgetPortalHost,
} from './internal/CanvasDomAdapter';
import { createCanvasImageDropAdapter } from './internal/CanvasMediaAdapter';

type TCanvasRuntimeConfig = Readonly<{
  canvasId: string;
  container: HTMLDivElement;
  transport: TCanvasDocumentTransport;
  createId(): string;
  wait: TCanvasWaitPort;
  themeService: IThemeService;
  initialGridVisible?: boolean;
  image: TCanvasImagePort;
  notification: TCanvasNotificationPort;
  trace?: TReproductionTraceOwner | null;
}>;

const FONT_WEIGHTS = [400, 500, 600, 700] as const;
const FONT_FAMILIES = [
  [
    'Inter',
    'sans-serif',
    'inter',
    'woff2',
    [
      new URL('./assets/fonts/inter-400.woff2', import.meta.url).href,
      new URL('./assets/fonts/inter-500.woff2', import.meta.url).href,
      new URL('./assets/fonts/inter-600.woff2', import.meta.url).href,
      new URL('./assets/fonts/inter-700.woff2', import.meta.url).href,
    ],
  ],
  [
    'Fraunces',
    'serif',
    'fraunces',
    'ttf',
    [
      new URL('./assets/fonts/fraunces-400.ttf', import.meta.url).href,
      new URL('./assets/fonts/fraunces-500.ttf', import.meta.url).href,
      new URL('./assets/fonts/fraunces-600.ttf', import.meta.url).href,
      new URL('./assets/fonts/fraunces-700.ttf', import.meta.url).href,
    ],
  ],
  [
    'JetBrains Mono',
    'monospace',
    'jetbrains-mono',
    'woff2',
    [
      new URL('./assets/fonts/jetbrains-mono-400.woff2', import.meta.url).href,
      new URL('./assets/fonts/jetbrains-mono-500.woff2', import.meta.url).href,
      new URL('./assets/fonts/jetbrains-mono-600.woff2', import.meta.url).href,
      new URL('./assets/fonts/jetbrains-mono-700.woff2', import.meta.url).href,
    ],
  ],
] as const;
const FONT_RESOURCES = FONT_FAMILIES.flatMap(([
  family,
  ,
  slug,
  format,
  urls,
]) => (
  FONT_WEIGHTS.map((weight, index) => ({
    descriptor: {
      id: `omnidraw-font:${slug}:${weight}`,
      type: 'font' as const, family, weight,
      style: 'normal' as const, mimeType: `font/${format}`,
    },
    source: { type: 'url' as const, url: urls[index]! },
  }))
));

export type TCanvasRuntime = Readonly<{
  /** Lazy package-internal programs executed by CanvasRuntimeLifecycle. */
  bootEffect(): Effect.Effect<void, unknown>;
  shutdownEffect(): Effect.Effect<void, unknown>;
  editor(): IStandardCanvasEditor | null;
  engine(): IInfiniteCanvasEngine | null;
  document(): CanvasDocumentService | null;
  selectionStyles(): ISelectionStyleController | null;
  setGridVisible(visible: boolean): boolean;
  openImagePicker(): void;
  setSelectedConnectorSegmentMode(mode: TPathSegmentMode): void;
  widgetContentFocused(): boolean;
  shell(): TCanvasShellState;
  subscribeShell(listener: (state: TCanvasShellState) => void): () => void;
  restoreMaximizedWidget(): boolean;
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

function acquireSyncRelease(
  subscribe: () => () => void,
): Effect.Effect<void, unknown, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.try({ try: subscribe, catch: (cause) => cause }),
    (release) => Effect.sync(release),
  ).pipe(Effect.asVoid);
}

function acquireTraceSubscriptions(
  trace: TReproductionTraceSink,
  engine: IInfiniteCanvasEngine,
  session: IStandardEditorSession,
): Effect.Effect<void, unknown, Scope.Scope> {
  return Effect.gen(function*() {
    yield* acquireSyncRelease(() => session.editor.subscribe((state) => {
      if (!trace.isRecording()) return;
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
    }));
    yield* acquireSyncRelease(() => session.widgets.subscribe((state) => {
      if (!trace.isRecording()) return;
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
    }));
    yield* acquireSyncRelease(() => session.widgets.subscribeActivation((activation) => {
      if (!trace.isRecording()) return;
      trace.emit({
        channel: 'widget-host',
        type: 'control-activated',
        priority: 'high',
        correlation: { widgetId: activation.widgetId },
        data: activation,
      });
    }));
    yield* acquireSyncRelease(() => engine.scene.subscribe((change) => {
      if (!trace.isRecording()) return;
      trace.emit({
        channel: 'editor',
        type: 'scene-publication-observed',
        priority: 'low',
        data: {
          revision: engine.scene.revision,
          source: 'source' in change ? String(change.source) : 'unknown',
        },
      });
    }));
  });
}

function acquireEarlyEngineTraceSubscriptions(
  lifetime: CanvasInstanceScope,
  trace: TReproductionTraceSink,
  engine: IInfiniteCanvasEngine,
): Effect.Effect<void, unknown> {
  const activePointerIds = new Set<number>();
  const hitByPointerId = new Map<number, string>();
  const passiveMoveCountByPointerId = new Map<number, number>();
  let hoverIdentity = '';
  return Effect.gen(function*() {
    yield* lifetime.addFinalizer(() => {
      activePointerIds.clear();
      hitByPointerId.clear();
      passiveMoveCountByPointerId.clear();
    });
    yield* lifetime.acquireSync(() => engine.input.subscribe((event) => {
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
    }), (release) => release());
    yield* lifetime.acquireSync(() => engine.transforms.subscribe((event) => {
      if (trace.isRecording()) trace.emit(transformTraceEvent(event));
    }), (release) => release());
    yield* lifetime.acquireSync(() => engine.transforms.subscribeHover((hover) => {
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
    }), (release) => release());
  });
}

export function buildRuntime(
  config: TCanvasRuntimeConfig,
  extensions: readonly ICanvasExtension[] = [],
): TCanvasRuntime {
  const lifetime = new CanvasInstanceScope();
  let engine: IInfiniteCanvasEngine | null = null;
  let editorSession: IStandardEditorSession | null = null;
  let selectionStyleController: ISelectionStyleController | null = null;
  let documentService: CanvasDocumentService | null = null;
  let imageDropController: ReturnType<typeof createCanvasImageDropAdapter> | null = null;
  let imageInput: HTMLInputElement | null = null;
  let extensionBridge: CanvasExtensionBridge | null = null;
  let canvasBackgroundProjection: IRetainedProjectionOwner | null = null;
  let gridVisible = config.initialGridVisible ?? true;
  let shellState: TCanvasShellState = Object.freeze({
    kind: 'canvas',
    widgetId: null,
  });
  let lastMaximizedWidgetId: string | null = null;
  let lastWidgetCreationExtension: ICanvasExtension | null = null;
  let normalizingWidgetShell = false;
  let selectionOverlaySuppressed = false;
  const shellSelectionOverlayOwner = Object.freeze({});
  const shellListeners = new Set<(state: TCanvasShellState) => void>();
  const shellOverlays = new Set<TCanvasOverlayContribution>();
  const setOverlayMounted = (
    contribution: TCanvasOverlayContribution,
    mounted: boolean,
  ): void => {
    try {
      contribution.setMounted(mounted);
    } catch (error) {
      reportTraceCallbackError(config.trace, 'shell-overlay', error);
      config.notification?.showError(
        'Canvas overlay failed',
        error instanceof Error ? error.message : String(error),
      );
    }
  };
  const syncShellOverlays = (): void => {
    for (const contribution of shellOverlays) {
      setOverlayMounted(
        contribution,
        fnCanvasShellOwnsOverlay(shellState, contribution.ownership),
      );
    }
  };
  const applyShellFocusTransition = (
    transition: TCanvasShellFocusTransition,
  ): void => {
    if (transition.kind === 'none' || engine === null) return;
    const node = engine.scene.get(transition.widgetId);
    const portalId = (node !== null && node.kind === 'widget-frame')
      ? node.portal?.portalId ?? null
      : null;
    const host = portalId === null
      ? null
        : findCanvasWidgetPortalHost(config.container, portalId);
    const activeElement = config.container.ownerDocument.activeElement;
    if (transition.kind === 'enter-maximized') {
      if (
        host === null
        || (activeElement !== null && host.contains(activeElement))
      ) return;
      try {
        host.focus({ preventScroll: true });
      } catch (error) {
        reportTraceCallbackError(config.trace, 'widget-shell-focus', error);
      }
      return;
    }
    if (
      host !== null
      && activeElement !== null
      && host.contains(activeElement)
    ) {
      engine.input.focus();
    }
  };
  const syncCanvasBackgroundProjection = (nextGridVisible: boolean) =>
    canvasBackgroundProjection?.replace(fnCanvasBackgroundProjection({
      viewport: config.themeService.getSnapshot().definition.canvas.viewport,
      gridVisible: nextGridVisible,
    }));

  return Object.freeze({
    bootEffect() {
      const boot = Effect.gen(function*() {
      if (engine) throw new Error('Canvas runtime is already running.');
      yield* lifetime.addFinalizer(() => config.container.replaceChildren());
      engine = yield* lifetime.acquirePromise(
        () => createCanvasEngine(config.container),
        async (canvasEngine) => {
          if (engine === canvasEngine) engine = null;
          await canvasEngine.destroy();
        },
      );
      documentService = yield* lifetime.acquireSync(
        () => new CanvasDocumentService({
          canvasId: config.canvasId,
          transport: createTracedCanvasDocumentTransport(
            config.transport,
            config.trace ?? null,
          ),
          createCommandId: config.createId,
          wait: config.wait,
          image: config.image,
          projectNode: (node: TSceneNode) => fnProjectSemanticCanvasNode({
            node,
            colors: config.themeService.getSnapshot().definition.canvas.colors,
          }),
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
        }),
        async (document) => {
          if (documentService === document) documentService = null;
          await document.dispose();
        },
      );
      canvasBackgroundProjection = yield* lifetime.acquireSync(
        () => createCanvasBackgroundOwner(engine!),
        (projection) => {
          if (canvasBackgroundProjection === projection) {
            canvasBackgroundProjection = null;
          }
          projection.dispose();
        },
      );
      syncCanvasBackgroundProjection(gridVisible);
      yield* lifetime.acquireSync(
        () => config.themeService.subscribeThemeChange((theme) => {
          syncCanvasBackgroundProjection(gridVisible);
          editorSession?.editor.setSelectionAppearance(
            fnCangineSelectionAppearance(theme.canvas.selection),
          );
          editorSession?.paths?.setAppearance(
            fnCanginePathAppearance(theme.canvas.path),
          );
          documentService?.reproject((node) => fnProjectSemanticCanvasNode({
            node,
            colors: theme.canvas.colors,
          }));
        }),
        (release) => release(),
      );
      if (config.trace !== undefined && config.trace !== null) {
        yield* acquireEarlyEngineTraceSubscriptions(
          lifetime,
          config.trace,
          engine,
        );
      }
      for (const font of FONT_RESOURCES) {
        engine.resources.register(font.descriptor, font.source);
      }
      yield* Effect.tryPromise({
        try: () => engine!.resources.preload(
          FONT_RESOURCES.map((font) => font.descriptor.id),
        ),
        catch: (cause) => cause,
      });
      yield* Effect.tryPromise({
        try: () => documentService!.start(engine!),
        catch: (cause) => cause,
      });
      const canvasEngine = engine;
      const document = documentService;
      if (canvasEngine === null || document === null) {
        return yield* Effect.fail(new Error('Canvas runtime acquisition was interrupted.'));
      }
      editorSession = yield* lifetime.acquireSync(() => createStandardEditorSession({
        engine: canvasEngine,
        host: config.container,
        editor: {
          contentParentId: CANVAS_RUNTIME_CONTENT_LAYER_ID,
          selectionAppearance: fnCangineSelectionAppearance(
            config.themeService.getSnapshot().definition.canvas.selection,
          ),
          createNodeId: config.createId,
          sceneMutationPort: document,
          history: { kind: 'custom', adapter: document.history },
          creation: {
            textFontFamilies: [FONT_FAMILIES[0][0], FONT_FAMILIES[0][1]],
            decorate: (context, node) => {
              const style = config.themeService.getDefaultStyle(
                fnThemeStyleScopeForCangineCreation(context.kind),
              );
              return fnDecorateSemanticCanvasCreation({
                kind: context.kind,
                node,
                colors: config.themeService.getSnapshot().definition.canvas.colors,
                ...(style.backgroundColor === undefined
                  ? {}
                  : { background: style.backgroundColor }),
                ...(style.strokeColor === undefined
                  ? {}
                  : { ink: style.strokeColor }),
              });
            },
            ...(extensions.some(
              (extension) => extension.createWidgetNodes !== undefined,
            )
              ? {
                  factories: {
                    widget: (creation) => {
                      for (const extension of extensions) {
                        const nodes = extension.createWidgetNodes?.({
                          kind: 'widget',
                          nodeId: creation.nodeId,
                          parentId: creation.parentId === CANVAS_RUNTIME_CONTENT_LAYER_ID
                            ? null
                            : creation.parentId,
                          draft: {
                            worldBounds: {
                              x: creation.draft.worldBounds.minX,
                              y: creation.draft.worldBounds.minY,
                              width: creation.draft.worldBounds.maxX
                                - creation.draft.worldBounds.minX,
                              height: creation.draft.worldBounds.maxY
                                - creation.draft.worldBounds.minY,
                            },
                            belowThreshold: creation.draft.belowThreshold,
                          },
                        });
                        if (nodes !== undefined && nodes !== null) {
                          lastWidgetCreationExtension = extension;
                          return nodes.map(fnCanvasContractNodeToCangine);
                        }
                      }
                      lastWidgetCreationExtension = null;
                      return null;
                    },
                  },
                }
              : {}),
          },
          // One-shot extensions (e.g. AI Chat) opt out of the sticky widget
          // tool right after their committed placement is selected.
          onWidgetCreated: () => {
            const extension = lastWidgetCreationExtension;
            lastWidgetCreationExtension = null;
            if (
              extension?.oneShotWidgetCreation !== true
              || editorSession?.editor.state.activeToolId !== 'widget'
            ) return;
            editorSession.editor.setActiveTool('select');
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
        paths: {
          appearance: fnCanginePathAppearance(
            config.themeService.getSnapshot().definition.canvas.path,
          ),
        },
        clipboardImage: {
          parentId: CANVAS_RUNTIME_CONTENT_LAYER_ID,
          imageImportPort: document,
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
      }), (session) => {
        if (editorSession === session) editorSession = null;
        session.destroy();
      });
      const session = editorSession;
      if (session === null) {
        return yield* Effect.fail(new Error('Canvas editor acquisition was interrupted.'));
      }
      const ownerWindow = config.container.ownerDocument.defaultView;
      if (ownerWindow === null) {
        return yield* Effect.fail(
          new Error('Canvas selection styles require an owning window.'),
        );
      }
      selectionStyleController = yield* lifetime.acquireSync(
        () => createSelectionStyleController({
          editor: session.editor,
          fontFamilies: FONT_FAMILIES.map(
            ([family, fallback]) => [family, fallback],
          ),
          continuousClock: {
            requestFrame: ownerWindow.requestAnimationFrame.bind(ownerWindow),
            cancelFrame: ownerWindow.cancelAnimationFrame.bind(ownerWindow),
          },
          decorateMutation: ({ after, change, intent }) => (
            fnDecorateSemanticCanvasStyleMutation({
              node: after,
              propertyId: change.propertyId,
              intent,
            })
          ),
          onCallbackError: (error) => {
            reportTraceCallbackError(config.trace, 'selection-style', error);
            config.notification?.showError(
              'Selection style failed',
              error instanceof Error ? error.message : String(error),
            );
          },
        }),
        (controller) => {
          if (selectionStyleController === controller) {
            selectionStyleController = null;
          }
          controller.destroy();
        },
      );
      const projectShell = (): void => {
        const session = editorSession;
        if (session === null || engine === null) return;
        const widgetState = session.widgets.state;
        const focusedNode = session.editor.state.focusedNodeId === null
          ? null
          : engine.scene.get(session.editor.state.focusedNodeId);
        const focusedWidgetNodeId = focusedNode !== null
          && fnCanvasWidgetShellAvailable(focusedNode)
          ? focusedNode.id
          : null;
        const previousMaximizedWidgetId = lastMaximizedWidgetId;
        lastMaximizedWidgetId = widgetState.maximizedNodeId;

        if (
          widgetState.maximizedNodeId !== null
          && !fnCanvasWidgetShellAvailable(
            engine.scene.get(widgetState.maximizedNodeId),
          )
          && !normalizingWidgetShell
        ) {
          normalizingWidgetShell = true;
          try {
            session.widgets.restore(widgetState.maximizedNodeId);
          } finally {
            normalizingWidgetShell = false;
          }
          if (session.widgets.state.maximizedNodeId !== widgetState.maximizedNodeId) {
            return projectShell();
          }
        }

        if (!normalizingWidgetShell) {
          if (
            widgetState.maximizedNodeId !== null
            && widgetState.contentNodeId === widgetState.maximizedNodeId
          ) {
            const previousContentNodeId = widgetState.contentNodeId;
            normalizingWidgetShell = true;
            try {
              session.widgets.clearContentFocus();
            } finally {
              normalizingWidgetShell = false;
            }
            if (
              session.widgets.state.contentNodeId !== previousContentNodeId
            ) return projectShell();
          }
          if (
            previousMaximizedWidgetId !== null
            && widgetState.maximizedNodeId === null
          ) {
            const previousContentNodeId = widgetState.contentNodeId;
            const previousFrameNodeId = widgetState.frameNodeId;
            normalizingWidgetShell = true;
            try {
              if (widgetState.contentNodeId !== null) {
                session.widgets.clearContentFocus();
              }
              if (fnCanvasWidgetShellAvailable(engine.scene.get(previousMaximizedWidgetId))) {
                session.widgets.enterFrameMode(previousMaximizedWidgetId);
              }
            } finally {
              normalizingWidgetShell = false;
            }
            if (
              session.widgets.state.contentNodeId !== previousContentNodeId
              || session.widgets.state.frameNodeId !== previousFrameNodeId
            ) return projectShell();
          }
        }

        const next = fnCanvasShellProjection({
          maximizedNodeId: widgetState.maximizedNodeId,
          contentNodeId: fnCanvasWidgetShellAvailable(
            widgetState.contentNodeId === null
              ? null
              : engine.scene.get(widgetState.contentNodeId),
          ) ? widgetState.contentNodeId : null,
          frameNodeId: fnCanvasWidgetShellAvailable(
            widgetState.frameNodeId === null
              ? null
              : engine.scene.get(widgetState.frameNodeId),
          ) ? widgetState.frameNodeId : null,
          focusedWidgetNodeId,
        });
        if (
          next.kind === shellState.kind
          && next.widgetId === shellState.widgetId
        ) return;
        const focusTransition = fnCanvasShellFocusTransition(shellState, next);
        shellState = next;
        const shouldSuppressSelectionOverlay = shellState.kind === 'maximized-widget';
        if (shouldSuppressSelectionOverlay !== selectionOverlaySuppressed) {
          selectionOverlaySuppressed = shouldSuppressSelectionOverlay;
          if (shouldSuppressSelectionOverlay) {
            session.editor.suppressSelectionOverlay(shellSelectionOverlayOwner);
          } else {
            session.editor.restoreSelectionOverlay(shellSelectionOverlayOwner);
          }
        }
        if (imageInput !== null) {
          imageInput.disabled = shellState.kind === 'maximized-widget';
        }
        applyShellFocusTransition(focusTransition);
        syncShellOverlays();
        for (const listener of [...shellListeners]) listener(shellState);
      };
      yield* lifetime.addFinalizerEffect(Effect.gen(function*() {
        lastMaximizedWidgetId = null;
        lastWidgetCreationExtension = null;
        normalizingWidgetShell = false;
        if (selectionOverlaySuppressed) {
          selectionOverlaySuppressed = false;
          editorSession?.editor.restoreSelectionOverlay(shellSelectionOverlayOwner);
        }
        for (const contribution of [...shellOverlays]) {
          yield* lifetime.attempt(
            () => setOverlayMounted(contribution, false),
          );
        }
        shellOverlays.clear();
        if (shellState.kind !== 'canvas') {
          shellState = Object.freeze({ kind: 'canvas', widgetId: null });
          for (const listener of [...shellListeners]) {
            yield* lifetime.attempt(() => listener(shellState));
          }
        }
        shellListeners.clear();
      }));
      yield* lifetime.acquireSync(
        () => editorSession!.widgets.subscribe(projectShell),
        (release) => release(),
      );
      yield* lifetime.acquireSync(
        () => editorSession!.editor.subscribe(projectShell),
        (release) => release(),
      );
      projectShell();
      imageInput = yield* lifetime.acquireSync(
        () => createCanvasImageInput(
          config.container,
          shellState.kind === 'maximized-widget',
        ),
        (input) => {
        if (imageInput === input) imageInput = null;
        input.remove();
        },
      );
      imageDropController = yield* lifetime.acquireSync(
        () => createCanvasImageDropAdapter({
          editor: editorSession!.editor,
          container: config.container,
          input: imageInput!,
          imageImportPort: documentService!,
          onError: (error) => {
            reportTraceCallbackError(config.trace, 'image-import', error);
            config.notification?.showError(
              'Image import failed',
              error instanceof Error ? error.message : String(error),
            );
          },
        }),
        (controller) => {
          if (imageDropController === controller) imageDropController = null;
          controller.destroy();
        },
      );
      const extensionShell = Object.freeze({
        state: () => shellState,
        owns: (ownership: TCanvasOverlayOwnership) =>
          fnCanvasShellOwnsOverlay(shellState, ownership),
        subscribe(listener: (state: TCanvasShellState) => void) {
          shellListeners.add(listener);
          return () => { shellListeners.delete(listener); };
        },
        registerOverlay(contribution: TCanvasOverlayContribution) {
          shellOverlays.add(contribution);
          setOverlayMounted(
            contribution,
            fnCanvasShellOwnsOverlay(shellState, contribution.ownership),
          );
          return () => {
            if (!shellOverlays.delete(contribution)) return;
            setOverlayMounted(contribution, false);
          };
        },
      });
      extensionBridge = yield* lifetime.acquireSync(() => new CanvasExtensionBridge({
        config: Object.freeze({
          canvasId: config.canvasId,
          container: config.container,
          notification: config.notification,
        }),
        document,
        editor: session.editor,
        engine: canvasEngine,
        trace: config.trace ?? null,
        shell: extensionShell,
        subscribeWidgetActions: (listener) => (
          editorSession!.widgets.subscribeActivation(listener)
        ),
        onError: (error) => {
          reportTraceCallbackError(config.trace, 'extension', error);
          config.notification?.showError(
            'Canvas extension failed',
            error instanceof Error ? error.message : String(error),
          );
        },
      }), async (bridge) => {
        if (extensionBridge === bridge) extensionBridge = null;
        await bridge.dispose();
      });
      yield* Effect.forEach(
        extensions,
        (extension) => lifetime.acquirePromise(
          () => Promise.resolve(extension.install(extensionBridge!.context)),
          (install) => Promise.resolve(install.dispose?.()),
        ),
        { discard: true },
      );
      // Subscribes before `attach()` so this listener runs first in
      // registration order and can short-circuit the editor/standard-tools
      // path (which only subscribes once the session attaches below).
      yield* lifetime.acquireSync(() => engine!.input.subscribe((event) => {
        if (event.type !== 'key-down' && event.type !== 'key-up' && event.type !== 'wheel') {
          return;
        }
        const session = editorSession;
        if (session === null) return;
        const gate = {
          maximizedNodeId: session.widgets.state.maximizedNodeId,
          contentNodeId: session.widgets.state.contentNodeId,
        };
        if (
          (event.type === 'key-down' || event.type === 'key-up')
            ? fnCanvasInputGateSwallowsKeys(gate)
            : fnCanvasInputGateSwallowsWheel(gate)
        ) return { handled: true, stopRouting: true };
        return;
      }), (release) => release());
      editorSession.attach();
      if (config.trace !== undefined && config.trace !== null) {
        const trace = config.trace;
        yield* lifetime.acquireSync(
          () => {
            const generation = new CanvasScopeGeneration(
              () => acquireTraceSubscriptions(trace, canvasEngine, session),
              (error) => reportTraceCallbackError(trace, 'trace-subscription', error),
            );
            const releaseLifecycle = trace.subscribeLifecycle(
              (recording) => generation.replace(recording),
            );
            return { generation, releaseLifecycle };
          },
          ({ generation, releaseLifecycle }) => {
            releaseLifecycle();
            generation.dispose();
          },
        );
      }
      selectionStyleController.attach();
      });
      return boot.pipe(
        Effect.onExit((exit) => Exit.isFailure(exit)
          ? lifetime.close(exit)
          : Effect.void),
      );
    },
    shutdownEffect() {
      return lifetime.close();
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
    openImagePicker: () => {
      if (shellState.kind !== 'maximized-widget') imageInput?.click();
    },
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
    shell: () => shellState,
    subscribeShell: (listener) => {
      shellListeners.add(listener);
      return () => { shellListeners.delete(listener); };
    },
    restoreMaximizedWidget: () => editorSession?.widgets.restore() ?? false,
  });
}
