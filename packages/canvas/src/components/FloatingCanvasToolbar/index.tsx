import ArrowRight from 'lucide-solid/icons/arrow-right';
import Circle from 'lucide-solid/icons/circle';
import Eraser from 'lucide-solid/icons/eraser';
import Grid2x2 from 'lucide-solid/icons/grid-2x2';
import Hand from 'lucide-solid/icons/hand';
import ImageIcon from 'lucide-solid/icons/image';
import Minus from 'lucide-solid/icons/minus';
import MousePointer2 from 'lucide-solid/icons/mouse-pointer-2';
import Pencil from 'lucide-solid/icons/pencil';
import Redo2 from 'lucide-solid/icons/redo-2';
import Square from 'lucide-solid/icons/square';
import Type from 'lucide-solid/icons/type';
import Undo2 from 'lucide-solid/icons/undo-2';
import { For, Show, createSignal } from 'solid-js';
import { ToolButton } from './ToolButton';
import { DeveloperTraceControl } from './DeveloperTraceControl';
import type {
  TReproductionTraceOwner,
} from '../../debug-trace/typed';
import type {
  TCanvasToolbarActionContribution,
  TCanvasToolbarContribution,
  TCanvasToolDefinition,
} from './toolbar.types';
import type { TEditorToolId } from '@omnidraw/cangine/editor';

const HAND_TOOL = Object.freeze({
  id: 'hand',
  label: 'Hand',
  shortcuts: ['H'],
  Icon: Hand,
}) satisfies TCanvasToolDefinition;

const TOOLS: readonly TCanvasToolDefinition[] = Object.freeze([
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
  contributions?: readonly TCanvasToolbarContribution[];
  gridVisible: boolean;
  onRedo(): void;
  onImportImage(): void;
  onSelectTool(toolId: TEditorToolId): void;
  onToggleGrid(): void;
  onUndo(): void;
  trace?: TReproductionTraceOwner | null;
  onTraceCopied?(): void;
  onTraceError?(error: unknown): void;
}>;

type TToolbarActionButtonProps = Readonly<{
  contribution: TCanvasToolbarActionContribution;
  persistent?: boolean;
}>;

function ToolbarActionButton(props: TToolbarActionButtonProps) {
  return (
    <button
      type="button"
      class="omnidraw-toolbar-button"
      classList={{
        'omnidraw-canvas-toolbar-persistent-action': props.persistent === true,
        'omnidraw-toolbar-button--active': props.contribution.active?.() ?? false,
        'omnidraw-toolbar-button--attention': props.contribution.attention?.() ?? false,
      }}
      aria-label={props.contribution.label}
      aria-pressed={props.contribution.active?.()}
      title={props.contribution.label}
      onClick={props.contribution.onActivate}
    >
      <span class="omnidraw-toolbar-button__icon">
        <props.contribution.Icon size={14} />
      </span>
      <span class="omnidraw-toolbar-button__shortcuts">
        <For each={props.contribution.shortcuts}>
          {(shortcut) => <span>{shortcut.label}</span>}
        </For>
      </span>
    </button>
  );
}

export function FloatingCanvasToolbar(props: TFloatingCanvasToolbarProps) {
  const [collapsed, setCollapsed] = createSignal(false);
  const toolContributions = () => (props.contributions ?? []).filter(
    (contribution) => contribution.kind === 'tool',
  );
  const toolActionContributions = () => (props.contributions ?? []).filter(
    (contribution): contribution is TCanvasToolbarActionContribution => (
      contribution.kind === 'action'
      && contribution.placement !== 'persistent'
    ),
  );
  const persistentContributions = () => (props.contributions ?? []).filter(
    (contribution): contribution is TCanvasToolbarActionContribution => (
      contribution.kind === 'action'
      && contribution.placement === 'persistent'
    ),
  );

  return (
    <div
      class="omnidraw-canvas-toolbar-anchor"
      on:pointerdown={(event) => event.stopPropagation()}
      on:pointermove={(event) => event.stopPropagation()}
      on:pointerup={(event) => event.stopPropagation()}
      on:pointercancel={(event) => event.stopPropagation()}
      on:wheel={(event) => event.stopPropagation()}
      on:keydown={(event) => event.stopPropagation()}
      on:keyup={(event) => event.stopPropagation()}
    >
      <div class="omnidraw-canvas-toolbar-panel">
        <button
          type="button"
          class="omnidraw-canvas-toolbar-collapse"
          aria-expanded={!collapsed()}
          title={collapsed() ? 'Expand tools' : 'Collapse tools'}
          onClick={() => setCollapsed((value) => !value)}
        >
          TOOLS
        </button>
        <Show when={!collapsed()}>
          <div class="omnidraw-canvas-toolbar-list">
            <ToolButton
              {...HAND_TOOL}
              active={props.activeToolId === HAND_TOOL.id}
              toolId={HAND_TOOL.id}
              onSelect={props.onSelectTool}
            />
            <For each={toolContributions()}>
              {(contribution) => (
                <ToolButton
                  Icon={contribution.Icon}
                  active={props.activeToolId === contribution.toolId}
                  label={contribution.label}
                  shortcuts={contribution.shortcuts?.map(
                    (shortcut) => shortcut.label,
                  )}
                  toolId={contribution.toolId}
                  onSelect={props.onSelectTool}
                />
              )}
            </For>
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
              class="omnidraw-toolbar-button"
              aria-label="Import image"
              title="Import image"
              onClick={props.onImportImage}
            >
              <span class="omnidraw-toolbar-button__icon"><ImageIcon size={14} /></span>
            </button>
            <button
              type="button"
              class="omnidraw-toolbar-button"
              classList={{ 'omnidraw-toolbar-button--active': props.gridVisible }}
              aria-label="Grid"
              aria-pressed={props.gridVisible}
              title="Toggle grid"
              onClick={props.onToggleGrid}
            >
              <span class="omnidraw-toolbar-button__icon"><Grid2x2 size={14} /></span>
              <span class="omnidraw-toolbar-button__shortcuts">
                <span>G</span>
              </span>
            </button>
            <For each={toolActionContributions()}>
              {(contribution) => (
                <ToolbarActionButton contribution={contribution} />
              )}
            </For>
            <div class="omnidraw-canvas-toolbar-divider" />
            <button
              type="button"
              class="omnidraw-toolbar-button"
              disabled={!props.canUndo}
              aria-label="Undo"
              title="Undo"
              onClick={props.onUndo}
            >
              <span class="omnidraw-toolbar-button__icon"><Undo2 size={14} /></span>
            </button>
            <button
              type="button"
              class="omnidraw-toolbar-button"
              disabled={!props.canRedo}
              aria-label="Redo"
              title="Redo"
              onClick={props.onRedo}
            >
              <span class="omnidraw-toolbar-button__icon"><Redo2 size={14} /></span>
            </button>
            <Show when={props.trace}>
              {(trace) => (
                <DeveloperTraceControl
                  trace={trace()}
                  onCopied={() => props.onTraceCopied?.()}
                  onError={(error) => props.onTraceError?.(error)}
                />
              )}
            </Show>
          </div>
        </Show>
        <For each={persistentContributions()}>
          {(contribution) => (
            <ToolbarActionButton contribution={contribution} persistent />
          )}
        </For>
      </div>
      <Show when={!collapsed()}>
        <div class="omnidraw-canvas-toolbar-hints" aria-hidden="true">
          <span><kbd>Middle</kbd> Pan</span>
          <span><kbd>Space</kbd> Drag</span>
        </div>
      </Show>
    </div>
  );
}
