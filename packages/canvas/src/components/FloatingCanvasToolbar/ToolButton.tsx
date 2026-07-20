/**
 * ToolButton Component
 * Individual tool button in the floating toolbar
 */

import type { JSX } from "solid-js";
import "./styles.css";

interface ToolButtonProps {
  icon: JSX.Element;
  shortcut?: string;
  letterShortcut?: string;
  isActive: boolean;
  onClick: () => void;
  onPointerDown?: (event: PointerEvent) => void;
  ariaLabel?: string;
  ariaHasPopup?: "menu";
  ariaExpanded?: boolean;
  role?: "menuitem";
}

export function ToolButton(props: ToolButtonProps) {
  const hasWideShortcut = () => Boolean(props.shortcut && props.shortcut.length > 3);

  return (
    <button
      type="button"
      onClick={props.onClick}
      onPointerDown={props.onPointerDown}
      aria-label={props.ariaLabel}
      aria-haspopup={props.ariaHasPopup}
      aria-expanded={props.ariaExpanded}
      role={props.role}
      class="vc-toolbar-button"
      classList={{
        "vc-toolbar-button--active": props.isActive,
        "vc-toolbar-button--has-wide-shortcut": hasWideShortcut(),
      }}
    >
      {props.icon}
      {props.letterShortcut && (
        <span
          class="vc-toolbar-button__shortcut vc-toolbar-button__shortcut--left"
          classList={{
            "vc-toolbar-button__shortcut--active": props.isActive,
            "vc-toolbar-button__shortcut--muted": !props.isActive,
          }}
        >
          {props.letterShortcut}
        </span>
      )}
      {props.shortcut && (
        <span
          class="vc-toolbar-button__shortcut vc-toolbar-button__shortcut--right"
          classList={{
            "vc-toolbar-button__shortcut--active": props.isActive,
            "vc-toolbar-button__shortcut--muted": !props.isActive,
            "vc-toolbar-button__shortcut--wide": hasWideShortcut(),
          }}
        >
          {props.shortcut}
        </span>
      )}
    </button>
  );
}
