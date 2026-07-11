import { Popover } from "@kobalte/core/popover";
import type { ParentProps } from "solid-js";
import { createSignal, onCleanup } from "solid-js";

type TToolbarLabelPlacement = "left" | "top";

type TToolbarLabelPopoverProps = ParentProps<{
  label: string;
  placement?: TToolbarLabelPlacement;
}>;

const TOOLBAR_LABEL_OPEN_DELAY_MS = 300;

export function ToolbarLabelPopover(props: TToolbarLabelPopoverProps) {
  let anchorElement: HTMLDivElement | undefined;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  const [isOpen, setIsOpen] = createSignal(false);

  const cancelOpen = () => {
    if (openTimer === undefined) {
      return;
    }

    clearTimeout(openTimer);
    openTimer = undefined;
  };

  const openAfterDelay = () => {
    cancelOpen();
    openTimer = setTimeout(() => {
      openTimer = undefined;
      setIsOpen(true);
    }, TOOLBAR_LABEL_OPEN_DELAY_MS);
  };

  const close = () => {
    cancelOpen();
    setIsOpen(false);
  };

  onCleanup(cancelOpen);

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
        <Popover.Content class="vc-toolbar-label-popover">
          <Popover.Title class="vc-toolbar-label-popover__text">{props.label}</Popover.Title>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
