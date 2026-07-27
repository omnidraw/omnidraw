/**
 * FloatingDrawingToolbar Component
 * Excalidraw-style floating toolbar at top center of canvas
 * Presentational floating toolbar for a single canvas
 */

import Hand from "lucide-solid/icons/hand";
import MousePointer2 from "lucide-solid/icons/mouse-pointer-2";
import Square from "lucide-solid/icons/square";
import Diamond from "lucide-solid/icons/diamond";
import Circle from "lucide-solid/icons/circle";
import ArrowRight from "lucide-solid/icons/arrow-right";
import Minus from "lucide-solid/icons/minus";
import Pencil from "lucide-solid/icons/pencil";
import Type from "lucide-solid/icons/type";
import Image from "lucide-solid/icons/image";
import Globe from "lucide-solid/icons/globe";
import Grid2x2 from "lucide-solid/icons/grid-2x2";
import PanelLeft from "lucide-solid/icons/panel-left";
import { Tooltip } from "@kobalte/core/tooltip";
import "./styles.css";
import { For, Show, createMemo, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import { ToolButton } from "./ToolButton";
import { TOOLS, type TTool } from "./toolbar.types";

interface IFloatingCanvasToolbarProps {
  activeTool: () => TTool;
  gridVisible: () => boolean;
  sidebarVisible: () => boolean;
  onToolSelect: (tool: TTool) => void;
  onToggleGrid: () => void;
  onToggleSidebar: () => void;
}

const TOOL_ICONS: Record<TTool, () => JSX.Element> = {
  hand: () => <Hand size={14} />,
  select: () => <MousePointer2 size={14} />,
  rect: () => <Square size={14} />,
  diamond: () => <Diamond size={14} />,
  ellipse: () => <Circle size={14} />,
  arrow: () => <ArrowRight size={14} />,
  line: () => <Minus size={14} />,
  pen: () => <Pencil size={14} />,
  text: () => <Type size={14} />,
  image: () => <Image size={14} />,
  browser: () => <Globe size={14} />,
};

// Detect Mac for keyboard shortcut display
const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export function FloatingCanvasToolbar(props: IFloatingCanvasToolbarProps) {
  const activeTool = createMemo(() => props.activeTool());
  const isGridVisible = createMemo(() => props.gridVisible());
  const isSidebarVisible = createMemo(() => props.sidebarVisible());
  const [isCollapsed, setIsCollapsed] = createSignal(false);

  const toggleCollapsed = () => {
    setIsCollapsed((v) => !v);
  };

  return (
    <div
      class="vc-canvas-toolbar-anchor"
      on:pointerdown={(event) => event.stopPropagation()}
      on:pointermove={(event) => event.stopPropagation()}
      on:pointerup={(event) => event.stopPropagation()}
      on:pointercancel={(event) => event.stopPropagation()}
      on:wheel={(event) => event.stopPropagation()}
      on:keydown={(event) => event.stopPropagation()}
      on:keyup={(event) => event.stopPropagation()}
    >
      {/* Main toolbar */}
      <div class="vc-canvas-toolbar-panel">
        {/* Collapsible toolbar header */}
        <Tooltip openDelay={400} closeDelay={0} placement="left">
          <Tooltip.Trigger
            as="button"
            type="button"
            onClick={toggleCollapsed}
            class="vc-canvas-toolbar-collapse"
          >
            TOOLS
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content class="vc-canvas-toolbar-tooltip">
              {isCollapsed() ? "Expand tools" : "Collapse tools"}
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip>

        {/* Tool buttons - hidden when collapsed */}
        <Show when={!isCollapsed()}>
          <div class="vc-canvas-toolbar-list">
            <For each={TOOLS}>
              {({ tool, shortcut, letterShortcut }) => (
                <ToolButton
                  icon={TOOL_ICONS[tool]()}
                  shortcut={shortcut}
                  letterShortcut={letterShortcut}
                  isActive={activeTool() === tool}
                  onClick={() => props.onToolSelect(tool)}
                />
              )}
            </For>
            <ToolButton
              icon={<Grid2x2 size={14} />}
              letterShortcut="g"
              isActive={isGridVisible()}
              onClick={props.onToggleGrid}
            />
          </div>
        </Show>

        {/* Sidebar toggle - always visible */}
        <button
          type="button"
          onClick={props.onToggleSidebar}
          class="vc-canvas-toolbar-sidebar-toggle"
          classList={{ "vc-canvas-toolbar-sidebar-toggle--alert": !isSidebarVisible() }}
        >
          <PanelLeft size={14} />
          <span
            class="vc-canvas-toolbar-sidebar-shortcut"
            classList={{
              "vc-canvas-toolbar-sidebar-shortcut--alert": !isSidebarVisible(),
              "vc-canvas-toolbar-sidebar-shortcut--muted": isSidebarVisible(),
            }}
          >
            {isMac ? "⌘b" : "^b"}
          </span>
        </button>
      </div>

      {/* Help text for panning */}
      <div class="vc-canvas-toolbar-hints">
        <div class="vc-canvas-toolbar-hint">
          <kbd class="vc-canvas-toolbar-keycap">Middle</kbd>
          <span>Pan</span>
        </div>
        <div class="vc-canvas-toolbar-hint">
          <kbd class="vc-canvas-toolbar-keycap">Space</kbd>
          <span>Drag</span>
        </div>
      </div>
    </div>
  );
}
