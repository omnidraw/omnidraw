import type {
  IStandardCanvasEditor,
  TSelectionStyleChange,
  TSelectionStyleState,
} from '@omnidraw/cangine/editor';
import type { TCanvas } from '@vibecanvas/service-db/model';
import type { ThemeService } from '@vibecanvas/service-theme';
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
  createReproductionTrace,
} from '../debug-trace/createReproductionTrace';
import {
  REPRODUCTION_TRACE_PASSIVE_INPUT_SAMPLE_RATE,
} from '../debug-trace/CONSTANTS';
import type {
  TReproductionTraceOwner,
} from '../debug-trace/typed';
import type { ICanvasRuntimeExtension } from '../extension';
import {
  fnBrowserTenantScopeKey,
  type TBrowserTenantScope,
} from '../fn.browser-tenant-scope';
import { buildRuntime, type TCanvasRuntime } from '../runtime';
import type {
  TCanvasDocumentTransport,
} from '../services/CanvasDocumentService';
import type {
  TCanvasDiagnostics,
  TCanvasImagePort,
} from '../types';
import { FloatingCanvasToolbar } from './FloatingCanvasToolbar';
import {
  SelectionStyleMenu,
} from './SelectionStyleMenu';
import {
  fnParseCssColor,
  fnSelectionStyleMenuVisible,
} from './SelectionStyleMenu/fn.selection-style-presentation';
import { fnCanvasRuntimeActivation } from './fn.canvas-runtime-activation';
import {
  fnCanBeginSpacePan,
  fnSpacePanScreenDelta,
} from './fn.space-pan';
import { fnCanvasToolShortcut } from './fn.canvas-tool-shortcut';
import { CanvasRuntimeLifecycle } from './CanvasRuntimeLifecycle';
import './Canvas.css';

export type TBackendCanvas = TCanvas;

type CanvasPageProps = {
  canvas: TBackendCanvas;
  tenant: TBrowserTenantScope;
  transport: TCanvasDocumentTransport;
  extensions?: readonly ICanvasRuntimeExtension[];
  image: TCanvasImagePort;
  store: {
    sidebarVisible: () => boolean;
    onToggleSidebar: () => void;
  };
  notification: {
    showSuccess(title: string, description?: string): void;
    showError(title: string, description?: string): void;
    showInfo(title: string, description?: string): void;
  };
  themeService: ThemeService;
  diagnostics?: TCanvasDiagnostics | false;
};

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

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable
    || target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
  );
}

function isNativeSpaceControl(target: EventTarget | null): boolean {
  return (
    isTextEntryTarget(target)
    || target instanceof HTMLButtonElement
    || target instanceof HTMLAnchorElement
  );
}

function isWidgetContentTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element
    && target.closest('[data-vibecanvas-portal-id]') !== null
  );
}

function semanticTraceTarget(
  target: EventTarget | null,
): Readonly<Record<string, string | null>> {
  if (!(target instanceof Element)) {
    return { kind: target === null ? 'none' : 'event-target', role: null };
  }
  const semantic = target.closest<HTMLElement>(
    '[data-vibecanvas-portal-id], [data-vibecanvas-widget-id], [data-canvas-node-id], [role]',
  ) ?? target;
  return {
    kind: semantic.tagName.toLowerCase(),
    role: semantic.getAttribute('role'),
    portalId: semantic.getAttribute('data-vibecanvas-portal-id'),
    widgetId: semantic.getAttribute('data-vibecanvas-widget-id'),
    nodeId: semantic.getAttribute('data-canvas-node-id'),
  };
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

export function Canvas(props: CanvasPageProps) {
  let canvasRootRef!: HTMLDivElement;
  let containerRef!: HTMLDivElement;
  let activeRuntime: TCanvasRuntime | null = null;
  let unsubscribeEditor: (() => void) | null = null;
  let unsubscribeSelectionStyles: (() => void) | null = null;
  let spacePointerId: number | null = null;
  let spacePointerPosition: Readonly<{ x: number; y: number }> | null = null;
  const pointerGestureIds = new Map<number, string>();
  const passivePointerMoveCounts = new Map<number, number>();
  const trace: TReproductionTraceOwner | null = (
    props.diagnostics !== false
    && props.diagnostics?.reproductionTrace === true
  )
    ? createReproductionTrace({
        environment: () => ({
          applicationVersion: props.diagnostics === false
            ? 'unknown'
            : props.diagnostics?.applicationVersion ?? 'unknown',
          buildMode: props.diagnostics === false
            ? 'unknown'
            : props.diagnostics?.buildMode ?? 'development',
          canvasId: props.canvas.id,
          cangineVersion: props.diagnostics === false
            ? 'unknown'
            : props.diagnostics?.cangineVersion ?? 'unknown',
          browser: navigator.userAgent.slice(0, 256),
          platform: navigator.platform || 'unknown',
          viewport: {
            width: canvasRootRef?.clientWidth ?? window.innerWidth,
            height: canvasRootRef?.clientHeight ?? window.innerHeight,
          },
          devicePixelRatio: window.devicePixelRatio,
        }),
        monotonicNow: () => performance.now(),
        wallClockNow: () => new Date(),
        defer: (callback) => queueMicrotask(callback),
        schedule: (callback, delayMs) => {
          const timeout = window.setTimeout(callback, delayMs);
          return () => window.clearTimeout(timeout);
        },
        writeClipboard: (text) => navigator.clipboard.writeText(text),
        createObjectUrl: ({ mimeType, text }) => URL.createObjectURL(
          new Blob([text], { type: mimeType }),
        ),
        revokeObjectUrl: (url) => URL.revokeObjectURL(url),
        download: ({ filename, url }) => {
          const anchor = document.createElement('a');
          anchor.download = filename;
          anchor.href = url;
          anchor.click();
          anchor.remove();
        },
      })
    : null;
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

  const source = (): TCanvasSource => ({
    key: `${fnBrowserTenantScopeKey(props.tenant)}:${props.canvas.id}`,
    canvasId: props.canvas.id,
  });

  const lifecycle = new CanvasRuntimeLifecycle<TCanvasSource>({
    createRuntime: (next) => {
      activeRuntime = buildRuntime({
        canvasId: next.canvasId,
        tenant: props.tenant,
        container: containerRef,
        transport: props.transport,
        createId: () => crypto.randomUUID(),
        onToggleSidebar: props.store.onToggleSidebar,
        initialGridVisible: gridVisible(),
        image: props.image,
        notification: props.notification,
        themeService: props.themeService,
        trace,
      }, props.extensions);
      return activeRuntime;
    },
    onBootStart: () => {
      trace?.emit({
        channel: 'system',
        type: 'runtime-replacement-started',
        priority: 'critical',
      });
      unsubscribeEditor?.();
      unsubscribeEditor = null;
      unsubscribeSelectionStyles?.();
      unsubscribeSelectionStyles = null;
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
      setBooting(false);
      trace?.emit({
        channel: 'system',
        type: 'runtime-ready',
        priority: 'critical',
        correlation: { canvasId: props.canvas.id },
      });
    },
    onBootError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      props.notification.showError('Failed to start canvas', message);
      setSelectionStyleState(DETACHED_SELECTION_STYLE_STATE);
      setBooting(false);
      setBootError(message);
      trace?.emit({
        channel: 'system',
        type: 'runtime-failed',
        priority: 'critical',
        correlation: { canvasId: props.canvas.id },
        data: { error: { name: 'Error', message } },
      });
    },
    onShutdownError: (error) => {
      props.notification.showError(
        'Failed to stop canvas',
        error instanceof Error ? error.message : String(error),
      );
    },
  });

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

  const handleKeyboardShortcut = (event: KeyboardEvent) => {
    const traceControlTarget = (
      event.target instanceof Element
      && event.target.closest('.vc-trace-control') !== null
    );
    if (trace !== null && !traceControlTarget) {
      const identity = traceKeyboardIdentity(event);
      trace.emit({
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
    if (
      (
        activeRuntime?.widgetContentFocused() === true
        && isWidgetContentTarget(event.target)
      )
      || isTextEntryTarget(event.target)
    ) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && !event.altKey && key === 'b') {
      event.preventDefault();
      event.stopPropagation();
      props.store.onToggleSidebar();
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
    const traceControlTarget = (
      event.target instanceof Element
      && event.target.closest('.vc-trace-control') !== null
    );
    if (trace !== null && !traceControlTarget) {
      const identity = traceKeyboardIdentity(event);
      trace.emit({
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
    trace?.emit({
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
      insideCanvasSurface: target instanceof Node && containerRef.contains(target),
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
    if (
      event.target instanceof Element
      && event.target.closest('.vc-trace-control') !== null
    ) return;
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
    trace?.emit({
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
          target instanceof HTMLElement
          && target.hasPointerCapture(event.pointerId)
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

  onMount(() => {
    setContainerReady(true);
    document.addEventListener('keydown', handleKeyboardShortcut, true);
    document.addEventListener('keyup', handleKeyboardRelease, true);
    window.addEventListener('blur', handleWindowBlur);
    if (trace !== null) {
      canvasRootRef.addEventListener('pointerdown', traceDomPointer, true);
      canvasRootRef.addEventListener('pointermove', traceDomPointer, true);
      canvasRootRef.addEventListener('pointerup', traceDomPointer, true);
      canvasRootRef.addEventListener('pointercancel', traceDomPointer, true);
      canvasRootRef.addEventListener('gotpointercapture', traceDomPointer, true);
      canvasRootRef.addEventListener('lostpointercapture', traceDomPointer, true);
    }
    canvasRootRef.addEventListener('pointerdown', beginSpacePan, true);
    canvasRootRef.addEventListener('pointermove', moveSpacePan, true);
    canvasRootRef.addEventListener('pointerup', endSpacePan, true);
    canvasRootRef.addEventListener('pointercancel', endSpacePan, true);
    canvasRootRef.addEventListener('lostpointercapture', handleLostSpaceCapture);
  });
  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyboardShortcut, true);
    document.removeEventListener('keyup', handleKeyboardRelease, true);
    window.removeEventListener('blur', handleWindowBlur);
    if (trace !== null) {
      canvasRootRef.removeEventListener('pointerdown', traceDomPointer, true);
      canvasRootRef.removeEventListener('pointermove', traceDomPointer, true);
      canvasRootRef.removeEventListener('pointerup', traceDomPointer, true);
      canvasRootRef.removeEventListener('pointercancel', traceDomPointer, true);
      canvasRootRef.removeEventListener('gotpointercapture', traceDomPointer, true);
      canvasRootRef.removeEventListener('lostpointercapture', traceDomPointer, true);
    }
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
    setSelectionStyleState(DETACHED_SELECTION_STYLE_STATE);
    activeRuntime = null;
    void lifecycle.dispose();
    trace?.dispose();
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
    value: string,
  ) => {
    const color = fnParseCssColor(value);
    if (color !== null) applySelectionStyle({ propertyId, value: color });
  };

  const beginOpacity = () =>
    activeRuntime?.selectionStyles()?.beginContinuous('opacity');
  const updateOpacity = (value: number) =>
    activeRuntime?.selectionStyles()?.updateContinuous(
      { propertyId: 'opacity', value },
    );
  const endOpacity = () => activeRuntime?.selectionStyles()?.endContinuous();

  return (
    <div
      ref={canvasRootRef}
      class="vc-canvas-host"
      classList={{
        'vc-canvas-host--space-held': spaceHeld(),
        'vc-canvas-host--space-dragging': spaceDragging(),
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
        class="vc-canvas-engine-host"
        style={{ position: 'absolute', inset: '0' }}
      />
      <FloatingCanvasToolbar
        activeToolId={state()?.activeToolId ?? null}
        canRedo={state()?.canRedo ?? false}
        canUndo={state()?.canUndo ?? false}
        gridVisible={gridVisible()}
        sidebarVisible={props.store.sidebarVisible()}
        onImportImage={() => activeRuntime?.openImagePicker()}
        onSelectTool={(toolId) => editor()?.setActiveTool(toolId)}
        onToggleGrid={toggleGrid}
        onToggleSidebar={props.store.onToggleSidebar}
        onUndo={() => editor()?.history?.undo()}
        onRedo={() => editor()?.history?.redo()}
        trace={trace}
        onTraceCopied={() => props.notification.showSuccess(
          'Developer trace copied',
          'Paste it directly into a coding-agent chat.',
        )}
        onTraceError={(error) => props.notification.showError(
          'Developer trace export failed',
          error instanceof Error ? error.message : String(error),
        )}
      />
      <Show when={fnSelectionStyleMenuVisible(selectionStyleState())}>
        <SelectionStyleMenu
          state={selectionStyleState()}
          palette={props.themeService.getThemeColorPickerPalette()}
          strokeWidths={props.themeService.getStrokeWidthOptions()}
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
