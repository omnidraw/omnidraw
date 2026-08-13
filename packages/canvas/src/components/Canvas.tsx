import type {
  TCanvasFillColorCode,
  TCanvasInkColorCode,
} from '@omnidraw/canvas-contract';
import type {
  IStandardCanvasEditor,
  TSelectionStyleChange,
  TSelectionStyleState,
} from '@omnidraw/cangine/editor';
import {
  applyThemeToElement,
  type TThemeColorPickerPalette,
} from '@omnidraw/theme';
import {
  Match,
  Show,
  Switch,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import {
  REPRODUCTION_TRACE_PASSIVE_INPUT_SAMPLE_RATE,
} from '../debug-trace/CONSTANTS';
import type {
  TCanvasSemanticColorMutationIntent,
} from '../fn.semantic-canvas-decoration';
import {
  fnCanvasSemanticStyleIntent,
} from '../fn.semantic-canvas-style';
import { buildRuntime, type TCanvasRuntime } from '../runtime';
import type {
  TCanvasProps,
} from '../types';
import { FloatingCanvasToolbar } from './FloatingCanvasToolbar';
import type {
  TCanvasKeyboardShortcut,
  TCanvasToolbarContribution,
} from './FloatingCanvasToolbar/toolbar.types';
import {
  SelectionStyleMenu,
} from './SelectionStyleMenu';
import {
  fnSelectionStyleMenuVisible,
} from './SelectionStyleMenu/fn.selection-style-presentation';
import { fnCanvasRuntimeActivation } from './fn.canvas-runtime-activation';
import {
  fnCanBeginSpacePan,
  fnSpacePanScreenDelta,
} from './fn.space-pan';
import { fnCanvasToolShortcut } from './fn.canvas-tool-shortcut';
import { CanvasRuntimeLifecycle } from './CanvasRuntimeLifecycle';
import type { TCanvasShellState } from '../fn.canvas-shell';

type TCanvasSource = Readonly<{
  key: string;
  canvasId: string;
}>;

const DETACHED_SELECTION_STYLE_STATE = Object.freeze({
  revision: 0,
  status: 'detached',
  selectedRootIds: Object.freeze([]),
  controls: Object.freeze([]),
  actions: Object.freeze([]),
  unavailable: Object.freeze([]),
}) satisfies TSelectionStyleState;

function eventTargetElement(target: EventTarget | null): Element | null {
  if (target === null || typeof target !== 'object') return null;
  const candidate = target as Partial<Element>;
  return (
    typeof candidate.closest === 'function'
    && typeof candidate.tagName === 'string'
  ) ? target as Element : null;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  const element = eventTargetElement(target);
  if (element === null) return false;
  const tagName = element.tagName.toLowerCase();
  return (
    (element as HTMLElement).isContentEditable
    || tagName === 'input'
    || tagName === 'textarea'
    || tagName === 'select'
  );
}

function isNativeSpaceControl(target: EventTarget | null): boolean {
  return (
    isTextEntryTarget(target)
    || eventTargetElement(target)?.matches('button, a') === true
  );
}

function isWidgetContentTarget(target: EventTarget | null): boolean {
  return (
    eventTargetElement(target)?.closest('[data-vibecanvas-portal-id]') ?? null
  ) !== null;
}

function isWidgetEscapeConsumer(event: KeyboardEvent): boolean {
  return event.composedPath().some((target) => {
    const element = eventTargetElement(target);
    if (element === null) return false;
    const role = element.getAttribute('role');
    return (
      role === 'dialog'
      || role === 'alertdialog'
      || role === 'menu'
      || element.getAttribute('aria-modal') === 'true'
    );
  });
}

function isOpenNativeDialogTarget(event: KeyboardEvent): boolean {
  return event.composedPath().some((target) => {
    const element = eventTargetElement(target);
    return element?.tagName.toLowerCase() === 'dialog'
      && element.hasAttribute('open');
  });
}

function semanticTraceTarget(
  target: EventTarget | null,
): Readonly<Record<string, string | null>> {
  const targetElement = eventTargetElement(target);
  if (targetElement === null) {
    return { kind: target === null ? 'none' : 'event-target', role: null };
  }
  const semantic = targetElement.closest<HTMLElement>(
    '[data-omnidraw-portal-id], [data-omnidraw-widget-id], [data-canvas-node-id], [role]',
  ) ?? targetElement;
  return {
    kind: semantic.tagName.toLowerCase(),
    role: semantic.getAttribute('role'),
    portalId: semantic.getAttribute('data-omnidraw-portal-id'),
    widgetId: semantic.getAttribute('data-omnidraw-widget-id'),
    nodeId: semantic.getAttribute('data-canvas-node-id'),
  };
}

function shortcutMatches(
  shortcut: TCanvasKeyboardShortcut,
  event: KeyboardEvent,
): boolean {
  return (
    shortcut.key.toLowerCase() === event.key.toLowerCase()
    && (shortcut.primary ?? false) === (event.ctrlKey || event.metaKey)
    && (shortcut.alt ?? false) === event.altKey
    && (shortcut.shift ?? false) === event.shiftKey
  );
}

function contributionForShortcut(
  contributions: readonly TCanvasToolbarContribution[],
  event: KeyboardEvent,
): TCanvasToolbarContribution | null {
  for (const contribution of contributions) {
    if (contribution.shortcuts?.some(
      (shortcut) => shortcutMatches(shortcut, event),
    )) return contribution;
  }
  return null;
}

function traceKeyboardIdentity(
  event: KeyboardEvent,
): Readonly<{ key: string; code: string }> {
  const contentTarget = (
    isTextEntryTarget(event.target)
    || isWidgetContentTarget(event.target)
  );
  if (!contentTarget || event.code === 'Space') {
    return { key: event.key, code: event.code };
  }
  const printable = Array.from(event.key).length === 1;
  return printable
    ? { key: '[redacted-text-entry]', code: '[redacted-text-entry]' }
    : { key: event.key, code: event.code };
}

export function Canvas(props: TCanvasProps) {
  let canvasRootRef!: HTMLDivElement;
  let containerRef!: HTMLDivElement;
  let keyboardDocument: Document | null = null;
  let keyboardWindow: Window | null = null;
  let keyboardActive = false;
  let releaseThemeChange: (() => void) | null = null;
  let traceDomListenersAttached = false;
  let activeRuntime: TCanvasRuntime | null = null;
  let unsubscribeEditor: (() => void) | null = null;
  let unsubscribeSelectionStyles: (() => void) | null = null;
  let unsubscribeShell: (() => void) | null = null;
  const handledMaximizedEscapes = new WeakSet<KeyboardEvent>();
  let spacePointerId: number | null = null;
  let spacePointerPosition: Readonly<{ x: number; y: number }> | null = null;
  const pointerGestureIds = new Map<number, string>();
  const passivePointerMoveCounts = new Map<number, number>();
  const trace = () => props.dependencies.diagnostics ?? null;
  const [containerReady, setContainerReady] = createSignal(false);
  const [booting, setBooting] = createSignal(true);
  const [bootError, setBootError] = createSignal<string | null>(null);
  const [editor, setEditor] = createSignal<IStandardCanvasEditor | null>(null);
  const [editorRevision, setEditorRevision] = createSignal(0);
  const [selectionStyleState, setSelectionStyleState] = createSignal<
    TSelectionStyleState
  >(
    DETACHED_SELECTION_STYLE_STATE,
  );
  const [gridVisible, setGridVisible] = createSignal(true);
  const [spaceHeld, setSpaceHeld] = createSignal(false);
  const [spaceDragging, setSpaceDragging] = createSignal(false);
  const [themeRevision, setThemeRevision] = createSignal(0);
  const [shellState, setShellState] = createSignal<TCanvasShellState>({
    kind: 'canvas',
    widgetId: null,
  });

  const source = (): TCanvasSource => ({
    key: JSON.stringify([props.hostScopeKey, props.canvas.id]),
    canvasId: props.canvas.id,
  });

  const lifecycle = new CanvasRuntimeLifecycle<TCanvasSource>({
    createRuntime: (next) => {
      activeRuntime = buildRuntime({
        canvasId: next.canvasId,
        container: containerRef,
        transport: props.dependencies.transport,
        createId: props.dependencies.createId,
        wait: props.dependencies.wait,
        initialGridVisible: gridVisible(),
        image: props.dependencies.image,
        notification: props.dependencies.notification,
        themeService: props.dependencies.themeService,
        trace: trace(),
      }, props.dependencies.extensions);
      return activeRuntime;
    },
    onBootStart: () => {
      trace()?.emit({
        channel: 'system',
        type: 'runtime-replacement-started',
        priority: 'critical',
      });
      unsubscribeEditor?.();
      unsubscribeEditor = null;
      unsubscribeSelectionStyles?.();
      unsubscribeSelectionStyles = null;
      unsubscribeShell?.();
      unsubscribeShell = null;
      setShellState({ kind: 'canvas', widgetId: null });
      setSelectionStyleState(DETACHED_SELECTION_STYLE_STATE);
      setEditor(null);
      setBooting(true);
      setBootError(null);
    },
    onBootSuccess: () => {
      const nextEditor = activeRuntime?.editor() ?? null;
      setEditor(nextEditor);
      setEditorRevision(nextEditor?.state.revision ?? 0);
      unsubscribeEditor = nextEditor?.subscribe((state) => {
        setEditorRevision(state.revision);
      }) ?? null;
      const runtime = activeRuntime;
      const styles = runtime?.selectionStyles() ?? null;
      setSelectionStyleState(styles?.state ?? DETACHED_SELECTION_STYLE_STATE);
      unsubscribeSelectionStyles = styles?.subscribe((nextState) => {
        if (
          activeRuntime === runtime
          && runtime?.selectionStyles() === styles
        ) {
          setSelectionStyleState(nextState);
        }
      }) ?? null;
      setShellState(runtime?.shell() ?? { kind: 'canvas', widgetId: null });
      unsubscribeShell = runtime?.subscribeShell((nextState) => {
        if (activeRuntime === runtime) setShellState(nextState);
      }) ?? null;
      setBooting(false);
      trace()?.emit({
        channel: 'system',
        type: 'runtime-ready',
        priority: 'critical',
        correlation: { canvasId: props.canvas.id },
      });
    },
    onBootError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      props.dependencies.notification.showError('Failed to start canvas', message);
      setSelectionStyleState(DETACHED_SELECTION_STYLE_STATE);
      setBooting(false);
      setBootError(message);
      trace()?.emit({
        channel: 'system',
        type: 'runtime-failed',
        priority: 'critical',
        correlation: { canvasId: props.canvas.id },
        data: { error: { name: 'Error', message } },
      });
    },
    onShutdownError: (error) => {
      props.dependencies.notification.showError(
        'Failed to stop canvas',
        error instanceof Error ? error.message : String(error),
      );
    },
  });
  const unregisterHostRetirement = (
    props.dependencies.hostRetirement?.register(() => lifecycle.dispose())
    ?? null
  );

  createEffect<string | null>((previousKey) => {
    const next = source();
    const activation = fnCanvasRuntimeActivation({
      containerReady: containerReady(),
      nextKey: next.key,
      previousKey,
    });
    if (activation.shouldReplace) {
      void lifecycle.replace(next);
    }
    return activation.key;
  }, null);

  const ownsKeyboardEvent = (event: KeyboardEvent): boolean => {
    const targetCanvas = eventTargetElement(event.target)
      ?.closest('.omnidraw-canvas-host') ?? null;
    if (targetCanvas !== null) return targetCanvas === canvasRootRef;
    if (keyboardActive) return true;
    return keyboardDocument?.querySelectorAll('.omnidraw-canvas-host').length === 1;
  };

  const updateKeyboardActivity = (event: Event) => {
    keyboardActive = eventTargetElement(event.target)
      ?.closest('.omnidraw-canvas-host') === canvasRootRef;
  };

  const handleKeyboardShortcut = (event: KeyboardEvent) => {
    if (!ownsKeyboardEvent(event)) return;
    const traceControlTarget = (
      eventTargetElement(event.target)?.closest('.omnidraw-trace-control') ?? null
    ) !== null;
    if (trace() !== null && !traceControlTarget) {
      const identity = traceKeyboardIdentity(event);
      trace()!.emit({
        channel: 'input.dom',
        type: 'key-down',
        priority: 'high',
        data: {
          key: identity.key,
          code: identity.code,
          repeat: event.repeat,
          composing: event.isComposing,
          modifiers: {
            alt: event.altKey,
            control: event.ctrlKey,
            meta: event.metaKey,
            shift: event.shiftKey,
          },
          defaultPrevented: event.defaultPrevented,
          target: semanticTraceTarget(event.target),
        },
      });
    }
    if (event.repeat) return;
    if (shellState().kind === 'maximized-widget') return;
    if (
      (
        activeRuntime?.widgetContentFocused() === true
        && isWidgetContentTarget(event.target)
      )
      || isTextEntryTarget(event.target)
    ) return;
    const key = event.key.toLowerCase();
    const contribution = contributionForShortcut(
      props.dependencies.toolbarContributions ?? [],
      event,
    );
    if (contribution !== null) {
      event.preventDefault();
      event.stopPropagation();
      if (contribution.kind === 'tool') {
        editor()?.setActiveTool(contribution.toolId);
      } else {
        contribution.onActivate();
      }
      return;
    }
    if (event.code === 'Space' && !isNativeSpaceControl(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      setSpaceHeld(true);
      return;
    }
    if (
      event.ctrlKey
      || event.metaKey
      || event.altKey
    ) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      editor()?.setActiveTool('select');
      return;
    }
    if (key === 'g') {
      event.preventDefault();
      event.stopPropagation();
      toggleGrid();
      return;
    }
    const toolId = fnCanvasToolShortcut(key);
    if (toolId === null) return;
    event.preventDefault();
    event.stopPropagation();
    editor()?.setActiveTool(toolId);
  };

  const handleMaximizedEscape = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented
      || event.repeat
      || event.key !== 'Escape'
      || shellState().kind !== 'maximized-widget'
      || !ownsKeyboardEvent(event)
      || isOpenNativeDialogTarget(event)
    ) return;
    event.preventDefault();
    event.stopPropagation();
    handledMaximizedEscapes.add(event);
    activeRuntime?.restoreMaximizedWidget();
  };

  const scheduleMaximizedEscapeFallback = (event: KeyboardEvent) => {
    if (
      event.repeat
      || event.key !== 'Escape'
      || shellState().kind !== 'maximized-widget'
      || !ownsKeyboardEvent(event)
    ) return;
    const widgetOverlayOwnsEscape = isWidgetEscapeConsumer(event);
    const nativeDialogOwnsEscape = isOpenNativeDialogTarget(event);
    queueMicrotask(() => {
      if (
        handledMaximizedEscapes.has(event)
        || nativeDialogOwnsEscape
        || (event.defaultPrevented && widgetOverlayOwnsEscape)
        || shellState().kind !== 'maximized-widget'
      ) return;
      activeRuntime?.restoreMaximizedWidget();
    });
  };

  const suppressMaximizedCanvasDrop = (event: DragEvent) => {
    if (shellState().kind !== 'maximized-widget') return;
    event.preventDefault();
    event.stopPropagation();
  };

  const finishSpacePan = (pointerId?: number) => {
    if (
      pointerId !== undefined
      && spacePointerId !== null
      && pointerId !== spacePointerId
    ) return;
    if (
      spacePointerId !== null
      && canvasRootRef.hasPointerCapture(spacePointerId)
    ) {
      canvasRootRef.releasePointerCapture(spacePointerId);
    }
    spacePointerId = null;
    spacePointerPosition = null;
    setSpaceDragging(false);
  };

  const handleKeyboardRelease = (event: KeyboardEvent) => {
    if (!ownsKeyboardEvent(event) && !(event.code === 'Space' && spaceHeld())) {
      return;
    }
    const traceControlTarget = (
      eventTargetElement(event.target)?.closest('.omnidraw-trace-control') ?? null
    ) !== null;
    if (trace() !== null && !traceControlTarget) {
      const identity = traceKeyboardIdentity(event);
      trace()!.emit({
        channel: 'input.dom',
        type: 'key-up',
        priority: 'high',
        data: {
          key: identity.key,
          code: identity.code,
          modifiers: {
            alt: event.altKey,
            control: event.ctrlKey,
            meta: event.metaKey,
            shift: event.shiftKey,
          },
          defaultPrevented: event.defaultPrevented,
          target: semanticTraceTarget(event.target),
        },
      });
    }
    if (event.code !== 'Space') return;
    setSpaceHeld(false);
    finishSpacePan();
  };

  const handleWindowBlur = () => {
    trace()?.emit({
      channel: 'system',
      type: 'window-blurred',
      priority: 'high',
    });
    setSpaceHeld(false);
    finishSpacePan();
  };

  const beginSpacePan = (event: PointerEvent) => {
    const target = event.target;
    if (!fnCanBeginSpacePan({
      insideCanvasSurface: (
        target !== null
        && typeof (target as Node).nodeType === 'number'
        && containerRef.contains(target as Node)
      ),
      primaryButton: event.button === 0,
      spaceHeld: spaceHeld(),
      widgetContentFocused: (
        activeRuntime?.widgetContentFocused() === true
        && isWidgetContentTarget(target)
      ),
    })) return;
    event.preventDefault();
    event.stopPropagation();
    spacePointerId = event.pointerId;
    spacePointerPosition = { x: event.clientX, y: event.clientY };
    canvasRootRef.setPointerCapture(event.pointerId);
    setSpaceDragging(true);
  };

  const moveSpacePan = (event: PointerEvent) => {
    if (
      spacePointerId !== event.pointerId
      || spacePointerPosition === null
    ) return;
    event.preventDefault();
    event.stopPropagation();
    const next = { x: event.clientX, y: event.clientY };
    activeRuntime?.engine()?.camera.panByScreen(fnSpacePanScreenDelta({
      current: next,
      previous: spacePointerPosition,
    }));
    spacePointerPosition = next;
  };

  const endSpacePan = (event: PointerEvent) => {
    if (spacePointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    finishSpacePan(event.pointerId);
  };

  const handleLostSpaceCapture = (event: PointerEvent) => {
    if (spacePointerId !== event.pointerId) return;
    spacePointerId = null;
    spacePointerPosition = null;
    setSpaceDragging(false);
  };

  const traceDomPointer = (event: PointerEvent) => {
    if ((
      eventTargetElement(event.target)?.closest('.omnidraw-trace-control') ?? null
    ) !== null) return;
    const type = event.type === 'pointerdown'
      ? 'pointer-down'
      : event.type === 'pointermove'
        ? 'pointer-move'
        : event.type === 'pointerup'
          ? 'pointer-up'
          : event.type === 'pointercancel'
            ? 'pointer-cancel'
            : event.type === 'gotpointercapture'
              ? 'capture-gained'
              : 'capture-lost';
    if (event.type === 'pointerdown') {
      passivePointerMoveCounts.delete(event.pointerId);
      pointerGestureIds.set(
        event.pointerId,
        `dom:${event.pointerId}:${Math.round(event.timeStamp)}`,
      );
    }
    let gestureId = pointerGestureIds.get(event.pointerId);
    const isPassivePointerMove = (
      event.type === 'pointermove'
      && (
        event.buttons === 0
        || gestureId === undefined
      )
    );
    if (isPassivePointerMove) {
      pointerGestureIds.delete(event.pointerId);
      gestureId = undefined;
      const passiveCount = (
        passivePointerMoveCounts.get(event.pointerId) ?? 0
      ) + 1;
      passivePointerMoveCounts.set(event.pointerId, passiveCount);
      if (
        passiveCount % REPRODUCTION_TRACE_PASSIVE_INPUT_SAMPLE_RATE !== 0
      ) return;
    } else if (event.type === 'pointermove') {
      passivePointerMoveCounts.delete(event.pointerId);
    }
    const target = event.target;
    trace()?.emit({
      channel: 'input.dom',
      type,
      priority: type === 'pointer-move' ? 'low' : 'critical',
      correlation: {
        pointerId: String(event.pointerId),
        ...(gestureId === undefined ? {} : { gestureId }),
      },
      data: {
        phase: event.eventPhase,
        pointerType: event.pointerType,
        button: event.button,
        buttons: event.buttons,
        pressure: event.pressure,
        client: { x: event.clientX, y: event.clientY },
        viewport: { x: event.clientX, y: event.clientY },
        modifiers: {
          alt: event.altKey,
          control: event.ctrlKey,
          meta: event.metaKey,
          shift: event.shiftKey,
        },
        cancelable: event.cancelable,
        defaultPrevented: event.defaultPrevented,
        target: semanticTraceTarget(target),
        captureOwner: (
          eventTargetElement(target) !== null
          && typeof (target as HTMLElement).hasPointerCapture === 'function'
          && (target as HTMLElement).hasPointerCapture(event.pointerId)
        ) ? semanticTraceTarget(target) : null,
      },
    });
    if (
      event.type === 'pointercancel'
      || event.type === 'lostpointercapture'
    ) {
      pointerGestureIds.delete(event.pointerId);
    }
    if (
      event.type === 'pointerup'
      || event.type === 'pointercancel'
      || event.type === 'lostpointercapture'
    ) {
      passivePointerMoveCounts.delete(event.pointerId);
    }
  };

  const setTraceDomListeners = (enabled: boolean) => {
    if (enabled === traceDomListenersAttached) return;
    if (enabled) {
      canvasRootRef.addEventListener('pointerdown', traceDomPointer, true);
      canvasRootRef.addEventListener('pointermove', traceDomPointer, true);
      canvasRootRef.addEventListener('pointerup', traceDomPointer, true);
      canvasRootRef.addEventListener('pointercancel', traceDomPointer, true);
      canvasRootRef.addEventListener('gotpointercapture', traceDomPointer, true);
      canvasRootRef.addEventListener('lostpointercapture', traceDomPointer, true);
    } else {
      canvasRootRef.removeEventListener('pointerdown', traceDomPointer, true);
      canvasRootRef.removeEventListener('pointermove', traceDomPointer, true);
      canvasRootRef.removeEventListener('pointerup', traceDomPointer, true);
      canvasRootRef.removeEventListener('pointercancel', traceDomPointer, true);
      canvasRootRef.removeEventListener('gotpointercapture', traceDomPointer, true);
      canvasRootRef.removeEventListener('lostpointercapture', traceDomPointer, true);
    }
    traceDomListenersAttached = enabled;
  };

  createEffect(() => {
    if (!containerReady()) return;
    setTraceDomListeners(trace() !== null);
  });

  createEffect(() => {
    if (!containerReady()) return;
    const themeService = props.dependencies.themeService;
    releaseThemeChange?.();
    applyThemeToElement(canvasRootRef, themeService.getTheme());
    setThemeRevision((revision) => revision + 1);
    releaseThemeChange = themeService.subscribeThemeChange(
      (theme) => {
        applyThemeToElement(canvasRootRef, theme);
        setThemeRevision((revision) => revision + 1);
      },
    );
  });

  onMount(() => {
    setContainerReady(true);
    keyboardDocument = canvasRootRef.ownerDocument;
    keyboardWindow = keyboardDocument.defaultView;
    keyboardDocument.addEventListener('keydown', handleKeyboardShortcut, true);
    keyboardDocument.addEventListener('keydown', scheduleMaximizedEscapeFallback, true);
    keyboardDocument.addEventListener('keydown', handleMaximizedEscape);
    keyboardDocument.addEventListener('keyup', handleKeyboardRelease, true);
    keyboardDocument.addEventListener('pointerdown', updateKeyboardActivity, true);
    keyboardDocument.addEventListener('focusin', updateKeyboardActivity, true);
    canvasRootRef.addEventListener('dragover', suppressMaximizedCanvasDrop, true);
    canvasRootRef.addEventListener('drop', suppressMaximizedCanvasDrop, true);
    keyboardWindow?.addEventListener('blur', handleWindowBlur);
    canvasRootRef.addEventListener('pointerdown', beginSpacePan, true);
    canvasRootRef.addEventListener('pointermove', moveSpacePan, true);
    canvasRootRef.addEventListener('pointerup', endSpacePan, true);
    canvasRootRef.addEventListener('pointercancel', endSpacePan, true);
    canvasRootRef.addEventListener('lostpointercapture', handleLostSpaceCapture);
  });
  onCleanup(() => {
    keyboardDocument?.removeEventListener('keydown', handleKeyboardShortcut, true);
    keyboardDocument?.removeEventListener('keydown', scheduleMaximizedEscapeFallback, true);
    keyboardDocument?.removeEventListener('keydown', handleMaximizedEscape);
    keyboardDocument?.removeEventListener('keyup', handleKeyboardRelease, true);
    keyboardDocument?.removeEventListener('pointerdown', updateKeyboardActivity, true);
    keyboardDocument?.removeEventListener('focusin', updateKeyboardActivity, true);
    canvasRootRef.removeEventListener('dragover', suppressMaximizedCanvasDrop, true);
    canvasRootRef.removeEventListener('drop', suppressMaximizedCanvasDrop, true);
    keyboardWindow?.removeEventListener('blur', handleWindowBlur);
    keyboardActive = false;
    keyboardDocument = null;
    keyboardWindow = null;
    releaseThemeChange?.();
    releaseThemeChange = null;
    setTraceDomListeners(false);
    canvasRootRef.removeEventListener('pointerdown', beginSpacePan, true);
    canvasRootRef.removeEventListener('pointermove', moveSpacePan, true);
    canvasRootRef.removeEventListener('pointerup', endSpacePan, true);
    canvasRootRef.removeEventListener('pointercancel', endSpacePan, true);
    canvasRootRef.removeEventListener('lostpointercapture', handleLostSpaceCapture);
    finishSpacePan();
    unsubscribeEditor?.();
    unsubscribeEditor = null;
    unsubscribeSelectionStyles?.();
    unsubscribeSelectionStyles = null;
    unsubscribeShell?.();
    unsubscribeShell = null;
    setShellState({ kind: 'canvas', widgetId: null });
    setSelectionStyleState(DETACHED_SELECTION_STYLE_STATE);
    activeRuntime = null;
    void lifecycle.dispose().then(
      () => unregisterHostRetirement?.(),
      () => unregisterHostRetirement?.(),
    );
  });

  const state = () => {
    editorRevision();
    return editor()?.state;
  };

  const applySelectionStyle = (change: TSelectionStyleChange) =>
    activeRuntime?.selectionStyles()?.apply(change) ?? false;
  const toggleGrid = () => {
    const visible = !gridVisible();
    activeRuntime?.setGridVisible(visible);
    setGridVisible(visible);
  };

  const applySelectionColor = (
    propertyId: 'background' | 'foreground',
    swatch: TThemeColorPickerPalette['fillQuick'][number]
      | TThemeColorPickerPalette['strokeQuick'][number],
  ) => {
    const intent = {
      schemaVersion: 1,
      role: propertyId === 'background' ? 'background' : 'ink',
      code: swatch.code,
    } satisfies TCanvasSemanticColorMutationIntent;
    activeRuntime?.selectionStyles()?.apply(
      { propertyId, value: swatch.value },
      { intent },
    );
  };

  const selectedSemanticColor = (
    role: 'background' | 'ink',
  ): TCanvasFillColorCode | TCanvasInkColorCode | null | undefined => {
    const selectedRootIds = selectionStyleState().selectedRootIds;
    const scene = activeRuntime?.engine()?.scene;
    if (scene === undefined || selectedRootIds.length === 0) return undefined;
    let semanticSeen = false;
    let literalSeen = false;
    let shared: TCanvasFillColorCode | TCanvasInkColorCode | undefined;
    for (const id of selectedRootIds) {
      const node = scene.get(id);
      const code = node === null
        ? undefined
        : fnCanvasSemanticStyleIntent(node)?.[role];
      if (code === undefined) {
        literalSeen = true;
        continue;
      }
      semanticSeen = true;
      if (shared !== undefined && shared !== code) return null;
      shared = code;
    }
    if (!semanticSeen) return undefined;
    return literalSeen ? null : shared;
  };

  const beginOpacity = () =>
    activeRuntime?.selectionStyles()?.beginContinuous('opacity');
  const updateOpacity = (value: number) =>
    activeRuntime?.selectionStyles()?.updateContinuous(
      { propertyId: 'opacity', value },
    );
  const endOpacity = () => activeRuntime?.selectionStyles()?.endContinuous();
  const themePalette = () => {
    themeRevision();
    return props.dependencies.themeService.getThemeColorPickerPalette();
  };
  const themeStrokeWidths = () => {
    themeRevision();
    return props.dependencies.themeService.getStrokeWidthOptions();
  };

  return (
    <div
      ref={canvasRootRef}
      data-omnidraw-theme-scope=""
      class="omnidraw-canvas-host"
      classList={{
        'omnidraw-canvas-host--space-held': spaceHeld(),
        'omnidraw-canvas-host--space-dragging': spaceDragging(),
      }}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <div
        ref={containerRef}
        class="omnidraw-canvas-engine-host"
        style={{ position: 'absolute', inset: '0' }}
      />
      <Show when={shellState().kind !== 'maximized-widget'}>
      <FloatingCanvasToolbar
        activeToolId={state()?.activeToolId ?? null}
        canRedo={state()?.canRedo ?? false}
        canUndo={state()?.canUndo ?? false}
        contributions={props.dependencies.toolbarContributions}
        gridVisible={gridVisible()}
        onImportImage={() => activeRuntime?.openImagePicker()}
        onSelectTool={(toolId) => editor()?.setActiveTool(toolId)}
        onToggleGrid={toggleGrid}
        onUndo={() => editor()?.history?.undo()}
        onRedo={() => editor()?.history?.redo()}
        trace={trace()}
        onTraceCopied={() => props.dependencies.notification.showSuccess(
          'Developer trace copied',
          'Paste it directly into a coding-agent chat.',
        )}
        onTraceError={(error) => props.dependencies.notification.showError(
          'Developer trace export failed',
          error instanceof Error ? error.message : String(error),
        )}
      />
      </Show>
      <Show when={shellState().kind !== 'maximized-widget' && fnSelectionStyleMenuVisible(selectionStyleState())}>
        <SelectionStyleMenu
          state={selectionStyleState()}
          palette={themePalette()}
          semanticColors={{
            background: selectedSemanticColor('background') as TCanvasFillColorCode | null | undefined,
            ink: selectedSemanticColor('ink') as TCanvasInkColorCode | null | undefined,
          }}
          strokeWidths={themeStrokeWidths()}
          onApply={applySelectionStyle}
          onSetColor={applySelectionColor}
          onBeginOpacity={beginOpacity}
          onUpdateOpacity={updateOpacity}
          onEndOpacity={endOpacity}
        />
      </Show>
      <Switch>
        <Match when={booting()}>
          <div style={{ position: 'absolute', inset: '0', display: 'grid', 'place-items': 'center' }}>
            Loading canvas…
          </div>
        </Match>
        <Match when={bootError()}>
          {(message) => (
            <div role="alert" style={{
              position: 'absolute',
              inset: '0',
              display: 'grid',
              'place-items': 'center',
              padding: '24px',
            }}>
              Canvas failed to start: {message()}
            </div>
          )}
        </Match>
      </Switch>
    </div>
  );
}
