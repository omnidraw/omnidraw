import { Portal } from "@solidjs/web";
import { MoreHorizontal, Pencil, Trash2 } from "@/shell/framework/components/icons";
import {
  anchoredPopupPortalTarget,
  connectAnchoredPopup,
} from "@/shell/framework/components/ui/anchored-popup";
import { Show, createEffect, createSignal, createUniqueId, onSettled, type Component } from "solid-js";
import styles from "./SidebarItem.module.css";

export type SidebarItemProps = {
  name: string;
  selected?: boolean;
  onClick?: () => void;
  onRename?: (trigger: HTMLButtonElement) => void;
  onDelete?: (trigger: HTMLButtonElement) => void;
};

function eventNode(ownerDocument: Document, target: EventTarget | null): Node | undefined {
  const NodeConstructor = ownerDocument.defaultView?.Node;
  return NodeConstructor !== undefined && target instanceof NodeConstructor ? target : undefined;
}

const SidebarItem: Component<SidebarItemProps> = (props) => {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [pendingAction, setPendingAction] = createSignal<"rename" | "delete" | null>(null);
  let menuTrigger: HTMLButtonElement | undefined;
  let menuContent: HTMLDivElement | undefined;
  let actionQueued = false;
  let menuOpenNow = false;
  let suppressTriggerClick = false;
  let initialMenuFocus: "first" | "last" = "first";
  let menuMountGeneration = 0;
  const menuTriggerId = createUniqueId();
  const menuId = createUniqueId();

  const setMenuVisibility = (open: boolean) => {
    menuOpenNow = open;
    setMenuOpen(open);
  };

  const toggleMenu = () => {
    if (!menuOpenNow) initialMenuFocus = "first";
    setMenuVisibility(!menuOpenNow);
  };

  const menuItems = () => menuContent === undefined
    ? []
    : [...menuContent.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];

  const focusMenuEdge = (edge: "first" | "last") => {
    const items = menuItems();
    items[edge === "first" ? 0 : items.length - 1]?.focus();
  };

  const openMenuFromKeyboard = (edge: "first" | "last") => {
    initialMenuFocus = edge;
    if (menuOpenNow) {
      focusMenuEdge(edge);
      return;
    }
    setMenuVisibility(true);
  };

  onSettled(() => {
    const ownerDocument = menuTrigger?.ownerDocument;
    if (ownerDocument === undefined) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = eventNode(ownerDocument, event.target);
      if (target === undefined) return;
      if (menuTrigger?.contains(target) || menuContent?.contains(target)) return;
      setMenuVisibility(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !menuOpenNow) return;
      event.preventDefault();
      setMenuVisibility(false);
      menuTrigger?.focus();
    };
    ownerDocument.addEventListener("pointerdown", handlePointerDown);
    ownerDocument.addEventListener("keydown", handleKeyDown);
    return () => {
      ownerDocument.removeEventListener("pointerdown", handlePointerDown);
      ownerDocument.removeEventListener("keydown", handleKeyDown);
    };
  });

  createEffect(
    () => ({
      action: pendingAction(),
      menuOpen: menuOpen(),
      onDelete: props.onDelete,
      onRename: props.onRename,
    }),
    ({ action, menuOpen, onDelete, onRename }) => {
      if (menuOpen || action === null || menuTrigger === undefined) return;
      setPendingAction(null);
      actionQueued = false;
      // The trigger is the stable ownership boundary between the non-modal menu
      // and the modal dialog. This also gives both dialogs a reliable focus
      // restoration target when they close.
      menuTrigger.focus();
      if (action === "rename") onRename?.(menuTrigger);
      else onDelete?.(menuTrigger);
    },
  );

  const selectAction = (action: "rename" | "delete") => {
    if (actionQueued) return;
    actionQueued = true;
    setPendingAction(action);
    setMenuVisibility(false);
  };
  const rootClass = () => {
    return [styles.root, props.selected ? styles.rootSelected : ""].filter(Boolean).join(" ");
  };

  const canvasButtonClass = () => {
    return [styles.canvasButton, props.selected ? styles.canvasButtonSelected : ""].filter(Boolean).join(" ");
  };

  const dangerMenuItemClass = `${styles.menuItem} ${styles.menuItemDanger}`;

  const Menu = () => {
    const trigger = menuTrigger;
    if (trigger === undefined) return null;
    const ownerDocument = trigger.ownerDocument;
    let content!: HTMLDivElement;
    onSettled(() => {
      const generation = ++menuMountGeneration;
      menuContent = content;
      const connection = connectAnchoredPopup({
        alignment: "end",
        anchor: trigger,
        popup: content,
      });
      queueMicrotask(() => {
        if (menuOpenNow && menuMountGeneration === generation && menuContent === content) {
          focusMenuEdge(initialMenuFocus);
        }
      });
      return () => {
        connection.disconnect();
        menuMountGeneration += 1;
        if (menuContent === content) menuContent = undefined;
      };
    });
    return <Portal mount={anchoredPopupPortalTarget(trigger)}>
      <div
        ref={content}
        id={menuId}
        class={styles.menuContent}
        role="menu"
        aria-labelledby={menuTriggerId}
        data-anchored-popup="sidebar-item-menu"
        onFocusOut={(event) => {
          const next = eventNode(ownerDocument, event.relatedTarget);
          if (next !== undefined && (content.contains(next) || trigger.contains(next))) return;
          setMenuVisibility(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setMenuVisibility(false);
            trigger.focus();
            return;
          }
          if (event.key === "Tab") {
            setMenuVisibility(false);
            return;
          }
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const items = menuItems();
          if (items.length === 0) return;
          const current = items.indexOf(ownerDocument.activeElement as HTMLButtonElement);
          const next = event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }}
      >
        <button
          type="button"
          role="menuitem"
          tabindex={-1}
          class={styles.menuItem}
          onPointerUp={() => selectAction("rename")}
          onClick={() => selectAction("rename")}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            selectAction("rename");
          }}
        >
          <Pencil size={12} />
          <span>Rename</span>
        </button>
        <button
          type="button"
          role="menuitem"
          tabindex={-1}
          class={dangerMenuItemClass}
          onPointerUp={() => selectAction("delete")}
          onClick={() => selectAction("delete")}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            selectAction("delete");
          }}
        >
          <Trash2 size={12} />
          <span>Delete</span>
        </button>
      </div>
    </Portal>;
  };

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

      <button
          type="button"
          id={menuTriggerId}
          ref={(element) => { menuTrigger = element; }}
          class={styles.menuTrigger}
          aria-label={`Options for ${props.name}`}
          aria-haspopup="menu"
          aria-controls={menuId}
          aria-expanded={menuOpen() ? "true" : "false"}
          data-expanded={menuOpen() ? "" : undefined}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            suppressTriggerClick = true;
            toggleMenu();
          }}
          onClick={() => {
            if (suppressTriggerClick) {
              suppressTriggerClick = false;
              return;
            }
            toggleMenu();
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            openMenuFromKeyboard(event.key === "ArrowDown" ? "first" : "last");
          }}
        >
          <MoreHorizontal size={14} />
        </button>
        <Show when={menuOpen()}>
          <Menu />
        </Show>
    </div>
  );
};

export default SidebarItem;
