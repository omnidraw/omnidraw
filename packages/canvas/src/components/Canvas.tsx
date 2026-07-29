import type { TSceneNode } from '@omnidraw/cangine';
import type { IStandardCanvasEditor } from '@omnidraw/cangine/editor';
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
import type { ICanvasRuntimeExtension } from '../extension';
import {
  fnBrowserTenantScopeKey,
  type TBrowserTenantScope,
} from '../fn.browser-tenant-scope';
import { buildRuntime, type TCanvasRuntime } from '../runtime';
import type {
  TCanvasDocumentTransport,
} from '../services/CanvasDocumentService';
import type { TCanvasImagePort } from '../types';
import { FloatingCanvasToolbar } from './FloatingCanvasToolbar';
import {
  SelectionStyleMenu,
} from './SelectionStyleMenu';
import {
  fnCanShowSelectionStyleMenu,
  fnLineShapeToSegmentMode,
  fnSelectionStyleState,
  type TSelectionLineShape,
  type TSelectionStylePatch,
} from './SelectionStyleMenu/fn.selection-style';
import {
  txApplySelectionStyle,
} from './SelectionStyleMenu/tx.selection-style';
import { fnCanvasRuntimeActivation } from './fn.canvas-runtime-activation';
import { fnCanvasGridStyle } from './fn.canvas-grid';
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
};

type TCanvasSource = Readonly<{
  key: string;
  canvasId: string;
}>;

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

export function Canvas(props: CanvasPageProps) {
  let canvasRootRef!: HTMLDivElement;
  let containerRef!: HTMLDivElement;
  let activeRuntime: TCanvasRuntime | null = null;
  let unsubscribeEditor: (() => void) | null = null;
  let unsubscribeCamera: (() => void) | null = null;
  let unsubscribeScene: (() => void) | null = null;
  let spacePointerId: number | null = null;
  let spacePointerPosition: Readonly<{ x: number; y: number }> | null = null;
  const [containerReady, setContainerReady] = createSignal(false);
  const [booting, setBooting] = createSignal(true);
  const [bootError, setBootError] = createSignal<string | null>(null);
  const [editor, setEditor] = createSignal<IStandardCanvasEditor | null>(null);
  const [editorRevision, setEditorRevision] = createSignal(0);
  const [cameraRevision, setCameraRevision] = createSignal(0);
  const [sceneRevision, setSceneRevision] = createSignal(0);
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
        image: props.image,
        notification: props.notification,
        themeService: props.themeService,
      }, props.extensions);
      return activeRuntime;
    },
    onBootStart: () => {
      unsubscribeEditor?.();
      unsubscribeEditor = null;
      unsubscribeCamera?.();
      unsubscribeCamera = null;
      unsubscribeScene?.();
      unsubscribeScene = null;
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
      const nextCamera = activeRuntime?.engine()?.camera;
      const nextScene = activeRuntime?.engine()?.scene;
      unsubscribeCamera = nextCamera?.subscribe(() => {
        setCameraRevision((revision) => revision + 1);
      }) ?? null;
      unsubscribeScene = nextScene?.subscribe(() => {
        setSceneRevision((revision) => revision + 1);
      }) ?? null;
      setCameraRevision((revision) => revision + 1);
      setSceneRevision((revision) => revision + 1);
      setBooting(false);
    },
    onBootError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      props.notification.showError('Failed to start canvas', message);
      setBooting(false);
      setBootError(message);
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
      setGridVisible((visible) => !visible);
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
    if (event.code !== 'Space') return;
    setSpaceHeld(false);
    finishSpacePan();
  };

  const handleWindowBlur = () => {
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

  onMount(() => {
    setContainerReady(true);
    document.addEventListener('keydown', handleKeyboardShortcut, true);
    document.addEventListener('keyup', handleKeyboardRelease, true);
    window.addEventListener('blur', handleWindowBlur);
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
    canvasRootRef.removeEventListener('pointerdown', beginSpacePan, true);
    canvasRootRef.removeEventListener('pointermove', moveSpacePan, true);
    canvasRootRef.removeEventListener('pointerup', endSpacePan, true);
    canvasRootRef.removeEventListener('pointercancel', endSpacePan, true);
    canvasRootRef.removeEventListener('lostpointercapture', handleLostSpaceCapture);
    finishSpacePan();
    unsubscribeEditor?.();
    unsubscribeEditor = null;
    unsubscribeCamera?.();
    unsubscribeCamera = null;
    unsubscribeScene?.();
    unsubscribeScene = null;
    activeRuntime = null;
    void lifecycle.dispose();
  });

  const state = () => {
    editorRevision();
    return editor()?.state;
  };

  const gridStyle = () => {
    cameraRevision();
    const camera = activeRuntime?.engine()?.camera;
    if (!camera) {
      return fnCanvasGridStyle({
        origin: { x: 0, y: 0 },
        visible: false,
        zoom: 1,
      });
    }
    return fnCanvasGridStyle({
      origin: camera.worldToViewport({ x: 0, y: 0 }),
      visible: gridVisible(),
      zoom: camera.state.zoom,
    });
  };

  const selectedNodes = (): readonly Readonly<TSceneNode>[] => {
    editorRevision();
    sceneRevision();
    const scene = activeRuntime?.engine()?.scene;
    if (!scene) return [];
    return (state()?.selectedNodeIds ?? [])
      .map((nodeId) => scene.get(nodeId))
      .filter((node): node is Readonly<TSceneNode> => node !== null);
  };

  const applySelectionStyle = (patch: TSelectionStylePatch) => {
    const currentEditor = editor();
    if (!currentEditor) return;
    txApplySelectionStyle(
      { editor: currentEditor },
      {
        nodeIds: currentEditor.state.selectedNodeIds,
        patch,
      },
    );
    currentEditor.refreshSelectionOverlay();
  };

  const setSelectedConnectorLineShape = (
    lineShape: TSelectionLineShape,
  ) => {
    activeRuntime?.setSelectedConnectorSegmentMode(
      fnLineShapeToSegmentMode(lineShape),
    );
  };

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
        background: 'var(--vc-canvas-background, rgba(168, 162, 158, 0.10))',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: '0',
          'pointer-events': 'none',
          'background-image': gridStyle().backgroundImage,
          'background-position': gridStyle().backgroundPosition,
          'background-size': gridStyle().backgroundSize,
          display: gridStyle().display,
        }}
      />
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
        onToggleGrid={() => setGridVisible((visible) => !visible)}
        onToggleSidebar={props.store.onToggleSidebar}
        onUndo={() => editor()?.history?.undo()}
        onRedo={() => editor()?.history?.redo()}
      />
      <Show when={fnCanShowSelectionStyleMenu(selectedNodes())}>
        <SelectionStyleMenu
          state={fnSelectionStyleState(selectedNodes())}
          palette={props.themeService.getThemeColorPickerPalette()}
          strokeWidths={props.themeService.getStrokeWidthOptions()}
          onApply={applySelectionStyle}
          onSetLineShape={setSelectedConnectorLineShape}
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
