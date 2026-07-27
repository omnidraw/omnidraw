import type { IStandardCanvasEditor } from '@omnidraw/cangine/editor';
import type { TCanvas } from '@vibecanvas/service-db/model';
import type { ThemeService } from '@vibecanvas/service-theme';
import {
  For,
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
import { fnCanvasRuntimeActivation } from './fn.canvas-runtime-activation';
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

const TOOLS = [
  ['select', 'Select'],
  ['hand', 'Hand'],
  ['rect', 'Rectangle'],
  ['ellipse', 'Ellipse'],
  ['pen', 'Pen'],
  ['text', 'Text'],
  ['connector', 'Connector'],
  ['arrow', 'Arrow'],
] as const;

export function Canvas(props: CanvasPageProps) {
  let containerRef!: HTMLDivElement;
  let activeRuntime: TCanvasRuntime | null = null;
  let unsubscribeEditor: (() => void) | null = null;
  const [containerReady, setContainerReady] = createSignal(false);
  const [booting, setBooting] = createSignal(true);
  const [bootError, setBootError] = createSignal<string | null>(null);
  const [editor, setEditor] = createSignal<IStandardCanvasEditor | null>(null);
  const [editorRevision, setEditorRevision] = createSignal(0);

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

  onMount(() => setContainerReady(true));
  onCleanup(() => {
    unsubscribeEditor?.();
    unsubscribeEditor = null;
    activeRuntime = null;
    void lifecycle.dispose();
  });

  const execute = (commandId: string) => {
    const current = editor();
    if (!current) return;
    void current.executeCommand(commandId).catch((error) => {
      props.notification.showError(
        'Canvas action failed',
        error instanceof Error ? error.message : String(error),
      );
    });
  };

  const state = () => {
    editorRevision();
    return editor()?.state;
  };

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      background: 'var(--vc-canvas-background, rgba(168, 162, 158, 0.10))',
    }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: '0' }} />
      <div style={{
        position: 'absolute',
        top: '12px',
        left: '12px',
        display: 'flex',
        gap: '4px',
        padding: '6px',
        'border-radius': '8px',
        border: '1px solid var(--border)',
        background: 'var(--popover)',
        'box-shadow': '0 8px 24px rgba(0,0,0,.12)',
      }}>
        <button type="button" title="Toggle sidebar" onClick={props.store.onToggleSidebar}>☰</button>
        <For each={TOOLS}>
          {([id, label]) => (
            <button
              type="button"
              title={label}
              aria-pressed={state()?.activeToolId === id}
              onClick={() => editor()?.setActiveTool(id)}
            >
              {label}
            </button>
          )}
        </For>
        <button
          type="button"
          disabled={!state()?.canUndo}
          onClick={() => editor()?.history?.undo()}
        >
          Undo
        </button>
        <button
          type="button"
          disabled={!state()?.canRedo}
          onClick={() => editor()?.history?.redo()}
        >
          Redo
        </button>
        <Show when={(state()?.selectedNodeIds.length ?? 0) > 0}>
          <button type="button" onClick={() => execute('editor.selection.group')}>Group</button>
          <button type="button" onClick={() => execute('editor.selection.ungroup')}>Ungroup</button>
          <button type="button" onClick={() => execute('editor.selection.duplicate')}>Clone</button>
          <button type="button" onClick={() => execute('editor.selection.delete')}>Delete</button>
        </Show>
      </div>
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
