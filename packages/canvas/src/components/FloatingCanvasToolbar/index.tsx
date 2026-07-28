import ArrowRight from 'lucide-solid/icons/arrow-right';
import Bot from 'lucide-solid/icons/bot';
import Circle from 'lucide-solid/icons/circle';
import Eraser from 'lucide-solid/icons/eraser';
import Grid2x2 from 'lucide-solid/icons/grid-2x2';
import Hand from 'lucide-solid/icons/hand';
import Minus from 'lucide-solid/icons/minus';
import MousePointer2 from 'lucide-solid/icons/mouse-pointer-2';
import PanelLeft from 'lucide-solid/icons/panel-left';
import Pencil from 'lucide-solid/icons/pencil';
import Redo2 from 'lucide-solid/icons/redo-2';
import Square from 'lucide-solid/icons/square';
import Type from 'lucide-solid/icons/type';
import Undo2 from 'lucide-solid/icons/undo-2';
import { For, Show, createSignal } from 'solid-js';
import { ToolButton } from './ToolButton';
import type {
  TCanvasToolDefinition,
  TCanvasToolId,
} from './toolbar.types';
import './styles.css';

const TOOLS: readonly TCanvasToolDefinition[] = Object.freeze([
  { id: 'hand', label: 'Hand', shortcuts: ['H'], Icon: Hand },
  { id: 'widget', label: 'AI Chat', shortcuts: ['C'], Icon: Bot },
  { id: 'select', label: 'Select', shortcuts: ['1', 'Esc'], Icon: MousePointer2 },
  { id: 'rect', label: 'Rectangle', shortcuts: ['2', 'R'], Icon: Square },
  { id: 'ellipse', label: 'Ellipse', shortcuts: ['3', 'O'], Icon: Circle },
  { id: 'text', label: 'Text', shortcuts: ['4', 'T'], Icon: Type },
  { id: 'connector', label: 'Line', shortcuts: ['5', 'L'], Icon: Minus },
  { id: 'arrow', label: 'Arrow', shortcuts: ['6', 'A'], Icon: ArrowRight },
  { id: 'pen', label: 'Pen', shortcuts: ['7', 'P'], Icon: Pencil },
  { id: 'eraser', label: 'Eraser', shortcuts: ['8', 'E'], Icon: Eraser },
]);

type TFloatingCanvasToolbarProps = Readonly<{
  activeToolId: string | null;
  canRedo: boolean;
  canUndo: boolean;
  gridVisible: boolean;
  sidebarVisible: boolean;
  onRedo(): void;
  onSelectTool(toolId: TCanvasToolId): void;
  onToggleGrid(): void;
  onToggleSidebar(): void;
  onUndo(): void;
}>;

export function FloatingCanvasToolbar(props: TFloatingCanvasToolbarProps) {
  const [collapsed, setCollapsed] = createSignal(false);

  return (
    <div
      class="vc-canvas-toolbar-anchor"
      on:pointerdown={(event) => event.stopPropagation()}
      on:pointermove={(event) => event.stopPropagation()}
      on:pointerup={(event) => event.stopPropagation()}
      on:pointercancel={(event) => event.stopPropagation()}
      on:wheel={(event) => event.stopPropagation()}
      on:keydown={(event) => event.stopPropagation()}
      on:keyup={(event) => event.stopPropagation()}
    >
      <div class="vc-canvas-toolbar-panel">
        <button
          type="button"
          class="vc-canvas-toolbar-collapse"
          aria-expanded={!collapsed()}
          title={collapsed() ? 'Expand tools' : 'Collapse tools'}
          onClick={() => setCollapsed((value) => !value)}
        >
          TOOLS
        </button>
        <Show when={!collapsed()}>
          <div class="vc-canvas-toolbar-list">
            <For each={TOOLS}>
              {(tool) => (
                <ToolButton
                  {...tool}
                  active={props.activeToolId === tool.id}
                  toolId={tool.id}
                  onSelect={props.onSelectTool}
                />
              )}
            </For>
            <button
              type="button"
              class="vc-toolbar-button"
              classList={{ 'vc-toolbar-button--active': props.gridVisible }}
              aria-label="Grid"
              aria-pressed={props.gridVisible}
              title="Toggle grid"
              onClick={props.onToggleGrid}
            >
              <span class="vc-toolbar-button__icon"><Grid2x2 size={14} /></span>
              <span class="vc-toolbar-button__shortcuts">
                <span>G</span>
              </span>
            </button>
            <div class="vc-canvas-toolbar-divider" />
            <button
              type="button"
              class="vc-toolbar-button"
              disabled={!props.canUndo}
              aria-label="Undo"
              title="Undo"
              onClick={props.onUndo}
            >
              <span class="vc-toolbar-button__icon"><Undo2 size={14} /></span>
            </button>
            <button
              type="button"
              class="vc-toolbar-button"
              disabled={!props.canRedo}
              aria-label="Redo"
              title="Redo"
              onClick={props.onRedo}
            >
              <span class="vc-toolbar-button__icon"><Redo2 size={14} /></span>
            </button>
          </div>
        </Show>
        <button
          type="button"
          class="vc-canvas-toolbar-sidebar-toggle"
          classList={{ 'vc-canvas-toolbar-sidebar-toggle--alert': !props.sidebarVisible }}
          aria-label="Toggle sidebar"
          title="Toggle sidebar"
          onClick={props.onToggleSidebar}
        >
          <PanelLeft size={14} />
          <span class="vc-canvas-toolbar-sidebar-shortcut">Ctrl+B</span>
        </button>
      </div>
      <Show when={!collapsed()}>
        <div class="vc-canvas-toolbar-hints" aria-hidden="true">
          <span><kbd>Middle</kbd> Pan</span>
          <span><kbd>Space</kbd> Drag</span>
        </div>
      </Show>
    </div>
  );
}
