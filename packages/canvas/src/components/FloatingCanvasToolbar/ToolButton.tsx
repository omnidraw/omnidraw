import { For, type Component } from 'solid-js';
import type { TCanvasToolId } from './toolbar.types';

type TToolButtonProps = Readonly<{
  active: boolean;
  Icon: Component<Readonly<{ size?: number }>>;
  label: string;
  shortcuts?: readonly string[];
  toolId: TCanvasToolId;
  onSelect(toolId: TCanvasToolId): void;
}>;

export function ToolButton(props: TToolButtonProps) {
  return (
    <button
      type="button"
      class="vc-toolbar-button"
      classList={{ 'vc-toolbar-button--active': props.active }}
      aria-label={props.label}
      aria-pressed={props.active}
      title={props.label}
      onClick={() => props.onSelect(props.toolId)}
    >
      <span class="vc-toolbar-button__icon">
        <props.Icon size={14} />
      </span>
      <span class="vc-toolbar-button__shortcuts">
        <For each={props.shortcuts}>
          {(shortcut) => <span>{shortcut}</span>}
        </For>
      </span>
    </button>
  );
}
