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
import type {
  TCanvasImagePort,
  TCanvasToolbarGroupsPort,
} from '../types';
import { FloatingCanvasToolbar } from './FloatingCanvasToolbar';
import {
  SelectionStyleMenu,
} from './SelectionStyleMenu';
import {
  fnSelectionStyleState,
  type TSelectionStylePatch,
} from './SelectionStyleMenu/fn.selection-style';
import {
  txApplySelectionStyle,
} from './SelectionStyleMenu/tx.selection-style';
import { fnCanvasRuntimeActivation } from './fn.canvas-runtime-activation';
import { fnCanvasGridStyle } from './fn.canvas-grid';
import { CanvasRuntimeLifecycle } from './CanvasRuntimeLifecycle';

export type TBackendCanvas = TCanvas;

type CanvasPageProps = {
  canvas: TBackendCanvas;
  tenant: TBrowserTenantScope;
  transport: TCanvasDocumentTransport;
  extensions?: readonly ICanvasRuntimeExtension[];
  image: TCanvasImagePort;
  toolbarGroups?: TCanvasToolbarGroupsPort;
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

const TOOL_SHORTCUTS = Object.freeze({
  '1': 'select',
  '2': 'rect',
  '3': 'ellipse',
  '4': 'text',
  '5': 'connector',
  '6': 'arrow',
  '7': 'pen',
  '8': 'eraser',
  a: 'arrow',
  e: 'eraser',
  h: 'hand',
  l: 'connector',
  o: 'ellipse',
  p: 'pen',
  r: 'rect',
  t: 'text',
  w: 'widget',
} as const);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable
    || target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
  );
}

export function Canvas(props: CanvasPageProps) {
  let containerRef!: HTMLDivElement;
  let activeRuntime: TCanvasRuntime | null = null;
  let unsubscribeEditor: (() => void) | null = null;
  let unsubscribeCamera: (() => void) | null = null;
  let unsubscribeScene: (() => void) | null = null;
  const [containerReady, setContainerReady] = createSignal(false);
  const [booting, setBooting] = createSignal(true);
  const [bootError, setBootError] = createSignal<string | null>(null);
  const [editor, setEditor] = createSignal<IStandardCanvasEditor | null>(null);
  const [editorRevision, setEditorRevision] = createSignal(0);
  const [cameraRevision, setCameraRevision] = createSignal(0);
  const [sceneRevision, setSceneRevision] = createSignal(0);
  const [gridVisible, setGridVisible] = createSignal(true);

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
        toolbarGroups: props.toolbarGroups,
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
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && !event.altKey && key === 'b') {
      event.preventDefault();
      props.store.onToggleSidebar();
      return;
    }
    if (
      event.ctrlKey
      || event.metaKey
      || event.altKey
      || isTypingTarget(event.target)
    ) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      editor()?.setActiveTool('select');
      return;
    }
    if (key === 'g') {
      event.preventDefault();
      setGridVisible((visible) => !visible);
      return;
    }
    const toolId = TOOL_SHORTCUTS[key as keyof typeof TOOL_SHORTCUTS];
    if (toolId === undefined) return;
    event.preventDefault();
    editor()?.setActiveTool(toolId);
  };

  onMount(() => {
    setContainerReady(true);
    document.addEventListener('keydown', handleKeyboardShortcut, true);
  });
  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyboardShortcut, true);
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
    const engine = activeRuntime?.engine();
    if (!currentEditor || !engine) return;
    txApplySelectionStyle(
      { engine },
      {
        nodeIds: currentEditor.state.selectedNodeIds,
        patch,
      },
    );
    currentEditor.refreshSelectionOverlay();
  };

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      background: 'var(--vc-canvas-background, rgba(168, 162, 158, 0.10))',
    }}>
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
      <div ref={containerRef} style={{ position: 'absolute', inset: '0' }} />
      <FloatingCanvasToolbar
        activeToolId={state()?.activeToolId ?? null}
        canRedo={state()?.canRedo ?? false}
        canUndo={state()?.canUndo ?? false}
        gridVisible={gridVisible()}
        sidebarVisible={props.store.sidebarVisible()}
        onSelectTool={(toolId) => editor()?.setActiveTool(toolId)}
        onToggleGrid={() => setGridVisible((visible) => !visible)}
        onToggleSidebar={props.store.onToggleSidebar}
        onUndo={() => editor()?.history?.undo()}
        onRedo={() => editor()?.history?.redo()}
      />
      <Show when={(state()?.selectedNodeIds.length ?? 0) > 0}>
        <SelectionStyleMenu
          state={fnSelectionStyleState(selectedNodes())}
          palette={props.themeService.getThemeColorPickerPalette()}
          strokeWidths={props.themeService.getStrokeWidthOptions()}
          onApply={applySelectionStyle}
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
