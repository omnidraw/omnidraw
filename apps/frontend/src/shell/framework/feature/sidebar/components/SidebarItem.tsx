import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import MoreHorizontal from "lucide-solid/icons/more-horizontal";
import Pencil from "lucide-solid/icons/pencil";
import Trash2 from "lucide-solid/icons/trash-2";
import { createEffect, createSignal, type Component } from "solid-js";
import styles from "./SidebarItem.module.css";

export type SidebarItemProps = {
  name: string;
  selected?: boolean;
  onClick?: () => void;
  onRename?: (trigger: HTMLButtonElement) => void;
  onDelete?: (trigger: HTMLButtonElement) => void;
};

const SidebarItem: Component<SidebarItemProps> = (props) => {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [pendingAction, setPendingAction] = createSignal<"rename" | "delete" | null>(null);
  let menuTrigger: HTMLButtonElement | undefined;

  createEffect(() => {
    const action = pendingAction();
    if (menuOpen() || action === null || menuTrigger === undefined) return;
    setPendingAction(null);
    // The trigger is the stable ownership boundary between the non-modal menu
    // and the modal dialog. This also gives both dialogs a reliable focus
    // restoration target when they close.
    menuTrigger.focus();
    if (action === "rename") props.onRename?.(menuTrigger);
    else props.onDelete?.(menuTrigger);
  });

  const selectAction = (action: "rename" | "delete") => {
    if (pendingAction() !== null) return;
    setPendingAction(action);
    setMenuOpen(false);
  };
  const rootClass = () => {
    return [styles.root, props.selected ? styles.rootSelected : ""].filter(Boolean).join(" ");
  };

  const canvasButtonClass = () => {
    return [styles.canvasButton, props.selected ? styles.canvasButtonSelected : ""].filter(Boolean).join(" ");
  };

  const dangerMenuItemClass = `${styles.menuItem} ${styles.menuItemDanger}`;

  return (
    <div class={rootClass()}>
      <button
        type="button"
        class={canvasButtonClass()}
        aria-current={props.selected ? "page" : undefined}
        onClick={() => props.onClick?.()}
      >
        <span class={styles.label} title={props.name}>{props.name}</span>
      </button>

      <DropdownMenu modal={false} open={menuOpen()} onOpenChange={setMenuOpen}>
        <DropdownMenu.Trigger
          ref={(element) => { menuTrigger = element; }}
          class={styles.menuTrigger}
          aria-label={`Options for ${props.name}`}
        >
          <MoreHorizontal size={14} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class={styles.menuContent}>
            <DropdownMenu.Item
              class={styles.menuItem}
              onSelect={() => selectAction("rename")}
            >
              <Pencil size={12} />
              <DropdownMenu.ItemLabel>Rename</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              class={dangerMenuItemClass}
              onSelect={() => selectAction("delete")}
            >
              <Trash2 size={12} />
              <DropdownMenu.ItemLabel>Delete</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  );
};

export default SidebarItem;
