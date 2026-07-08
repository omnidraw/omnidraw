import DOMPurify from "dompurify";
import { For, createSignal, onCleanup } from "solid-js";
import type { ToolService } from "../../services/tool/ToolService";
import type { TToolIcon } from "../../services/tool/types";
import "./styles.css";
import { ToolButton } from "./ToolButton";

export type TRuntimeToolbarTool = {
  id: string;
  label: string;
  icon?: TToolIcon;
  shortcuts?: string[];
  active?: boolean;
};

export type TRuntimeToolbarProps = {
  tool: ToolService;
  onToolSelect: (toolId: string) => void;
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

export function RuntimeToolbar(props: TRuntimeToolbarProps) {
  const [isCollapsed, setIsCollapsed] = createSignal(false);
  const [tools, setTools] = createSignal(props.tool.getTools());
  const [activeToolId, setActiveToolId] = createSignal(props.tool.activeToolId);

  const offToolsChange = props.tool.hooks.toolsChange.tap(() => {
    setTools(props.tool.getTools());
  });

  const offActiveToolChange = props.tool.hooks.activeToolChange.tap((toolId) => {
    setActiveToolId(toolId);
  });

  onCleanup(() => {
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
        >
          TOOLS
        </button>
        {isCollapsed() ? null : (
          <div class="vc-runtime-toolbar-list">
            <For each={tools()}>
              {(tool) => {
                const shortcutParts = getShortcutParts(tool.shortcuts);
                const icon = tool.icon;
                return (
                  <ToolButton
                    icon={icon
                      ? isSvgIcon(icon)
                        ? <span class="vc-toolbar-button__icon" innerHTML={sanitizeToolIcon(icon)} />
                        : <span class="vc-toolbar-button__icon">{icon}</span>
                      : <span class="vc-runtime-toolbar-fallback-label">{tool.id.slice(0, 2)}</span>}
                    shortcut={shortcutParts.shortcut}
                    letterShortcut={shortcutParts.letterShortcut}
                    isActive={activeToolId() === tool.id || Boolean(tool.active)}
                    onClick={() => props.onToolSelect(tool.id)}
                  />
                );
              }}
            </For>
          </div>
        )}
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
