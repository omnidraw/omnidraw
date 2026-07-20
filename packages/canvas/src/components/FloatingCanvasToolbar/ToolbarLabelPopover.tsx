import { Popover } from "@kobalte/core/popover";
import type { ParentProps } from "solid-js";
import { createSignal, onCleanup } from "solid-js";

type TToolbarLabelPlacement = "left" | "top";

type TToolbarLabelPopoverProps = ParentProps<{
  label: string;
  placement?: TToolbarLabelPlacement;
  onAddToCanvas?: () => void;
}>;

const TOOLBAR_LABEL_OPEN_DELAY_MS = 300;

export function ToolbarLabelPopover(props: TToolbarLabelPopoverProps) {
  let anchorElement: HTMLDivElement | undefined;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const [isOpen, setIsOpen] = createSignal(false);

  const cancelOpen = () => {
    if (openTimer === undefined) {
      return;
    }

    clearTimeout(openTimer);
    openTimer = undefined;
  };

  const openAfterDelay = () => {
    if (closeTimer !== undefined) {
      clearTimeout(closeTimer);
      closeTimer = undefined;
    }
    cancelOpen();
    openTimer = setTimeout(() => {
      openTimer = undefined;
      setIsOpen(true);
    }, TOOLBAR_LABEL_OPEN_DELAY_MS);
  };

  const close = () => {
    cancelOpen();
    if (!props.onAddToCanvas) {
      setIsOpen(false);
      return;
    }
    if (closeTimer !== undefined) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      closeTimer = undefined;
      setIsOpen(false);
    }, 0);
  };

  const cancelClose = () => {
    if (closeTimer === undefined) return;
    clearTimeout(closeTimer);
    closeTimer = undefined;
  };

  onCleanup(() => {
    cancelOpen();
    cancelClose();
  });

  return (
    <Popover
      open={isOpen()}
      onOpenChange={setIsOpen}
      anchorRef={() => anchorElement}
      placement={props.placement ?? "left"}
      gutter={8}
      flip
      slide
      overflowPadding={8}
      modal={false}
      preventScroll={false}
    >
      <div
        ref={anchorElement}
        class="vc-toolbar-label-anchor"
        onPointerEnter={openAfterDelay}
        onPointerLeave={close}
        onFocusIn={() => {
          cancelOpen();
          setIsOpen(true);
        }}
        onFocusOut={close}
      >
        {props.children}
      </div>
      <Popover.Portal>
        <Popover.Content class="vc-toolbar-label-popover" onPointerEnter={cancelClose} onPointerLeave={close}>
          <Popover.Title class="vc-toolbar-label-popover__text">{props.label}</Popover.Title>
          {props.onAddToCanvas ? (
            <button
              type="button"
              class="vc-toolbar-label-popover__action"
              onClick={() => {
                props.onAddToCanvas?.();
                setIsOpen(false);
              }}
            >
              Add to canvas
            </button>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
