import type { TEditorToolId } from '@omnidraw/cangine/editor';
import { For, type Component } from 'solid-js';

type TToolButtonProps = Readonly<{
  active: boolean;
  Icon: Component<Readonly<{ size?: number }>>;
  label: string;
  shortcuts?: readonly string[];
  toolId: TEditorToolId;
  onSelect(toolId: TEditorToolId): void;
}>;

export function ToolButton(props: TToolButtonProps) {
  return (
    <button
      type="button"
      class="omnidraw-toolbar-button"
      classList={{ 'omnidraw-toolbar-button--active': props.active }}
      aria-label={props.label}
      aria-pressed={props.active}
      title={props.label}
      onClick={() => props.onSelect(props.toolId)}
    >
      <span class="omnidraw-toolbar-button__icon">
        <props.Icon size={14} />
      </span>
      <span class="omnidraw-toolbar-button__shortcuts">
        <For each={props.shortcuts}>
          {(shortcut) => <span>{shortcut}</span>}
        </For>
      </span>
    </button>
  );
}
