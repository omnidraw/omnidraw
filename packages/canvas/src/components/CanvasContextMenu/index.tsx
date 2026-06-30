import { ContextMenu } from "@kobalte/core/context-menu";
import "./index.css";
import { For, Show, createEffect, type Accessor } from "solid-js";

export type TCanvasContextMenuItem = {
  id: string;
  label: string;
  disabled?: boolean;
  onSelect: () => void;
};

export function CanvasContextMenu(props: {
  mounted: Accessor<boolean>;
  x: Accessor<number>;
  y: Accessor<number>;
  items: Accessor<TCanvasContextMenuItem[]>;
  openRequestId: Accessor<number>;
  onOpenChange: (open: boolean) => void;
}) {
  let triggerRef: HTMLDivElement | undefined;

  createEffect(() => {
    if (!props.mounted()) return;
    props.openRequestId();

    queueMicrotask(() => {
      if (!props.mounted()) return;
      triggerRef?.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: props.x(),
        clientY: props.y(),
        button: 2,
      }));
    });
  });

  return (
    <Show when={props.mounted()}>
      <ContextMenu
        onOpenChange={props.onOpenChange}
        modal={false}
        forceMount
        gutter={4}
        flip
        shift={0}
        overflowPadding={8}
      >
        <ContextMenu.Trigger
          ref={triggerRef}
          style={{
            position: "fixed",
            left: `${props.x()}px`,
            top: `${props.y()}px`,
            width: "1px",
            height: "1px",
            opacity: "0",
            "pointer-events": "none",
          }}
        />
        <ContextMenu.Portal>
          <ContextMenu.Content class="vc-context-menu">
            <For each={props.items()}>
              {(item) => (
                <ContextMenu.Item
                  disabled={item.disabled}
                  onSelect={() => item.onSelect()}
                  class="vc-context-menu-item"
                >
                  <ContextMenu.ItemLabel>{item.label}</ContextMenu.ItemLabel>
                </ContextMenu.Item>
              )}
            </For>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu>
    </Show>
  );
}
