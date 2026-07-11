import DOMPurify from "dompurify";
import type { TOrpcSafeClient } from "@vibecanvas/orpc-client";
import * as LucideStatic from "lucide-static";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import type { ToolService } from "../../services/tool/ToolService";
import type { TTool, TToolIcon } from "../../services/tool/types";
import {
  DEFAULT_TOOL_GROUP_DEFINITION,
  TOOLBAR_HEADER_HEIGHT_PX,
  TOOLBAR_MAX_COLUMNS,
  TOOLBAR_TOOL_HEIGHT_PX,
  TOOLBAR_VIEWPORT_GUTTER_PX,
  TOOLBAR_WIDE_TOOL_HEIGHT_PX,
  TOOL_GROUPS_CHANGED_EVENT,
} from "./CONSTANTS";
import { fnBuildToolbarColumns, fnBuildToolbarSlots, type TToolbarGroupSlot, type TToolGroupDefinition } from "./fn.runtime-toolbar";
import "./styles.css";
import { ToolButton } from "./ToolButton";
import { ToolbarLabelPopover } from "./ToolbarLabelPopover";

export type TRuntimeToolbarTool = {
  id: string;
  label: string;
  icon?: TToolIcon;
  shortcuts?: string[];
  active?: boolean;
};

export type TRuntimeToolbarProps = {
  tool: ToolService;
  viewportElement: HTMLElement;
  onToolSelect: (toolId: string) => void;
  apiService?: TOrpcSafeClient;
  groupDefinitions?: Readonly<Record<string, TToolGroupDefinition>>;
};

function sanitizeToolIcon(icon: string) {
  return DOMPurify.sanitize(icon, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["script", "foreignObject"],
    FORBID_ATTR: ["onload", "onclick", "onerror", "style"],
  });
}

function isSvgIcon(icon: string) {
  return /^\s*(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/.test(icon);
}

function getShortcutParts(shortcuts: string[] | undefined) {
  if (!shortcuts || shortcuts.length === 0) {
    return { shortcut: undefined, letterShortcut: undefined };
  }

  const letterShortcut = shortcuts.find((shortcut) => shortcut.length <= 3 && /^[a-zA-Z]+$/.test(shortcut));
  const shortcut = shortcuts.find((candidate) => candidate !== letterShortcut) ?? shortcuts[0];

  return {
    shortcut: shortcut === letterShortcut ? undefined : shortcut,
    letterShortcut,
  };
}

function ToolIcon(props: { icon?: TToolIcon; fallback: string }) {
  return props.icon
    ? isSvgIcon(props.icon)
      ? <span class="vc-toolbar-button__icon" innerHTML={sanitizeToolIcon(props.icon)} aria-hidden="true" />
      : <span class="vc-toolbar-button__icon" aria-hidden="true">{props.icon}</span>
    : <span class="vc-runtime-toolbar-fallback-label" aria-hidden="true">{props.fallback.slice(0, 2)}</span>;
}

function RuntimeToolButton(props: {
  tool: TTool;
  activeToolId: string;
  onSelect: (toolId: string) => void;
  role?: "menuitem";
  labelPlacement?: "left" | "top";
}) {
  const shortcutParts = createMemo(() => getShortcutParts(props.tool.shortcuts));

  return (
    <ToolbarLabelPopover label={props.tool.label} placement={props.labelPlacement}>
      <ToolButton
        icon={<ToolIcon icon={props.tool.icon} fallback={props.tool.id} />}
        shortcut={shortcutParts().shortcut}
        letterShortcut={shortcutParts().letterShortcut}
        ariaLabel={props.tool.label}
        role={props.role}
        isActive={props.activeToolId === props.tool.id || Boolean(props.tool.active)}
        onClick={() => props.onSelect(props.tool.id)}
      />
    </ToolbarLabelPopover>
  );
}

function RuntimeToolGroup(props: {
  slot: TToolbarGroupSlot;
  activeToolId: string;
  viewportElement: HTMLElement;
  onSelect: (toolId: string) => void;
}) {
  let anchorElement: HTMLDivElement | undefined;
  let groupButton: HTMLButtonElement | undefined;
  let flyoutElement: HTMLDivElement | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let wasOpenBeforePointerDown = false;
  const [isOpen, setIsOpen] = createSignal(false);
  const [flyoutPosition, setFlyoutPosition] = createSignal({ left: 0, top: 0, maxWidth: 0 });

  const cancelClose = () => {
    if (closeTimer !== undefined) {
      clearTimeout(closeTimer);
      closeTimer = undefined;
    }
  };

  const updateFlyoutPosition = () => {
    if (!anchorElement) {
      return;
    }

    const anchorRect = anchorElement.getBoundingClientRect();
    const viewportRect = props.viewportElement.getBoundingClientRect();
    setFlyoutPosition({
      left: anchorRect.left - viewportRect.left,
      top: Math.max(0, anchorRect.top - viewportRect.top),
      maxWidth: Math.max(TOOLBAR_TOOL_HEIGHT_PX, anchorRect.left - viewportRect.left),
    });
  };

  const openFlyout = () => {
    cancelClose();
    updateFlyoutPosition();
    setIsOpen(true);
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimer = setTimeout(() => {
      closeTimer = undefined;
      const activeElement = props.viewportElement.ownerDocument.activeElement;
      const hasFocus = Boolean(
        activeElement
        && (anchorElement?.contains(activeElement) || flyoutElement?.contains(activeElement)),
      );
      const hasPointer = Boolean(
        anchorElement?.matches(":hover") || flyoutElement?.matches(":hover"),
      );
      if (!hasFocus && !hasPointer) {
        setIsOpen(false);
      }
    }, 0);
  };

  const closeFlyout = () => {
    cancelClose();
    setIsOpen(false);
  };

  const selectMember = (toolId: string) => {
    props.onSelect(toolId);
    groupButton?.focus();
    closeFlyout();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    groupButton?.focus();
    closeFlyout();
  };

  createEffect(() => {
    if (isOpen()) {
      updateFlyoutPosition();
    }
  });

  onCleanup(cancelClose);

  return (
    <div
      ref={anchorElement}
      class="vc-runtime-toolbar-group"
      onPointerEnter={openFlyout}
      onPointerLeave={scheduleClose}
      onFocusIn={openFlyout}
      onFocusOut={scheduleClose}
      onKeyDown={onKeyDown}
    >
      <button
        ref={groupButton}
        type="button"
        class="vc-toolbar-button vc-runtime-toolbar-group__button"
        classList={{ "vc-toolbar-button--active": props.slot.active }}
        aria-label={props.slot.label}
        aria-haspopup="menu"
        aria-expanded={isOpen()}
        onPointerDown={() => {
          wasOpenBeforePointerDown = isOpen();
        }}
        onClick={(event) => {
          updateFlyoutPosition();
          if (event.detail === 0) {
            setIsOpen((value) => !value);
            return;
          }
          setIsOpen(!wasOpenBeforePointerDown);
        }}
      >
        <ToolIcon icon={props.slot.icon} fallback={props.slot.group} />
      </button>

      <Show when={isOpen()}>
        <Portal mount={props.viewportElement}>
          <div
            ref={flyoutElement}
            class="vc-runtime-toolbar-group__flyout"
            role="menu"
            aria-label={props.slot.label}
            style={{
              left: `${flyoutPosition().left}px`,
              top: `${flyoutPosition().top}px`,
              "max-width": `${flyoutPosition().maxWidth}px`,
            }}
            onPointerEnter={cancelClose}
            onPointerLeave={scheduleClose}
            onFocusIn={cancelClose}
            onFocusOut={scheduleClose}
            onKeyDown={onKeyDown}
          >
            <For each={props.slot.tools}>
              {(tool) => (
                <div class="vc-runtime-toolbar-group__member" role="none">
                  <RuntimeToolButton
                    tool={tool}
                    activeToolId={props.activeToolId}
                    onSelect={selectMember}
                    role="menuitem"
                    labelPlacement="top"
                  />
                </div>
              )}
            </For>
          </div>
        </Portal>
      </Show>
    </div>
  );
}

export function RuntimeToolbar(props: TRuntimeToolbarProps) {
  const [isCollapsed, setIsCollapsed] = createSignal(false);
  const [tools, setTools] = createSignal(props.tool.getTools());
  const [activeToolId, setActiveToolId] = createSignal(props.tool.activeToolId);
  const [viewportHeight, setViewportHeight] = createSignal(props.viewportElement.clientHeight);
  const [groupDefinitions, setGroupDefinitions] = createSignal<Readonly<Record<string, TToolGroupDefinition>>>(props.groupDefinitions ?? {});

  const slots = createMemo(() => fnBuildToolbarSlots({
    tools: tools(),
    activeToolId: activeToolId(),
    definitions: groupDefinitions(),
    toolHeight: TOOLBAR_TOOL_HEIGHT_PX,
    wideToolHeight: TOOLBAR_WIDE_TOOL_HEIGHT_PX,
  }));
  const availableListHeight = createMemo(() => {
    return Math.max(
      TOOLBAR_TOOL_HEIGHT_PX,
      viewportHeight() - (TOOLBAR_VIEWPORT_GUTTER_PX * 2) - TOOLBAR_HEADER_HEIGHT_PX,
    );
  });
  const layout = createMemo(() => fnBuildToolbarColumns({
    slots: slots(),
    availableHeight: availableListHeight(),
    maxColumns: TOOLBAR_MAX_COLUMNS,
  }));

  const offToolsChange = props.tool.hooks.toolsChange.tap(() => {
    setTools(props.tool.getTools());
  });
  const offActiveToolChange = props.tool.hooks.activeToolChange.tap((toolId) => {
    setActiveToolId(toolId);
  });

  let resizeObserver: ResizeObserver | undefined;
  const loadGroupDefinitions = async () => {
    const toolGroupApi = props.apiService?.api.tool?.groups;
    if (!toolGroupApi) return;

    const [err, groups] = await toolGroupApi.list();
    if (err) return;
    const definitions: Record<string, TToolGroupDefinition> = {};
    for (const group of groups) {
      const icon = group.json?.svgIcon?.trim()
        || (group.json?.lucidIcon ? (LucideStatic as Record<string, string>)[group.json.lucidIcon] : undefined)
        || DEFAULT_TOOL_GROUP_DEFINITION.icon;
      definitions[group.name] = { icon, label: group.name };
    }
    setGroupDefinitions(definitions);
  };
  const handleToolGroupsChanged = () => {
    void loadGroupDefinitions();
  };

  onMount(() => {
    void loadGroupDefinitions();
    props.viewportElement.ownerDocument.defaultView?.addEventListener(TOOL_GROUPS_CHANGED_EVENT, handleToolGroupsChanged);
    setViewportHeight(props.viewportElement.clientHeight);
    resizeObserver = new ResizeObserver(() => {
      setViewportHeight(props.viewportElement.clientHeight);
    });
    resizeObserver.observe(props.viewportElement);
  });

  onCleanup(() => {
    props.viewportElement.ownerDocument.defaultView?.removeEventListener(TOOL_GROUPS_CHANGED_EVENT, handleToolGroupsChanged);
    resizeObserver?.disconnect();
    offToolsChange();
    offActiveToolChange();
  });

  return (
    <div class="vc-canvas-toolbar-anchor">
      <div class="vc-runtime-toolbar-panel">
        <button
          type="button"
          onClick={() => setIsCollapsed((value) => !value)}
          class="vc-runtime-toolbar-collapse"
          aria-expanded={!isCollapsed()}
        >
          TOOLS
        </button>
        <Show when={!isCollapsed()}>
          <div
            class="vc-runtime-toolbar-list"
            classList={{ "vc-runtime-toolbar-list--scroll": layout().needsScroll }}
            style={{ "max-height": `${availableListHeight()}px` }}
          >
            <For each={layout().columns}>
              {(column) => (
                <div class="vc-runtime-toolbar-column">
                  <For each={column}>
                    {(slot) => (
                      <Show
                        when={slot.type === "group" ? slot : undefined}
                        fallback={slot.type === "tool" ? (
                          <RuntimeToolButton
                            tool={slot.tool}
                            activeToolId={activeToolId()}
                            onSelect={props.onToolSelect}
                          />
                        ) : null}
                      >
                        {(groupSlot) => (
                          <ToolbarLabelPopover label={groupSlot().label} placement="top">
                            <RuntimeToolGroup
                              slot={groupSlot()}
                              activeToolId={activeToolId()}
                              viewportElement={props.viewportElement}
                              onSelect={props.onToolSelect}
                            />
                          </ToolbarLabelPopover>
                        )}
                      </Show>
                    )}
                  </For>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      <div class="vc-runtime-toolbar-hints">
        <div class="vc-runtime-toolbar-hint">
          <kbd class="vc-runtime-toolbar-keycap">Middle</kbd>
          <span>Pan</span>
        </div>
        <div class="vc-runtime-toolbar-hint">
          <kbd class="vc-runtime-toolbar-keycap">Space</kbd>
          <span>Drag</span>
        </div>
      </div>
    </div>
  );
}
