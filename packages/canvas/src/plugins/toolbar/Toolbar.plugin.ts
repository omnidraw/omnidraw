import type { IPlugin } from "@vibecanvas/runtime";
import Hand from "lucide-static/icons/hand.svg?raw";
import MousePointer2 from "lucide-static/icons/mouse-pointer-2.svg?raw";
import SidebarOpen from "lucide-static/icons/sidebar-open.svg?raw";
import { createComponent } from "solid-js";
import { render } from "solid-js/web";
import { RuntimeToolbar } from "../../components/FloatingCanvasToolbar/RuntimeToolbar";
import type { ToolService, TTool } from "../../services";
import type { SceneService } from "../../services/scene/SceneService";
import { CanvasMode } from "../../services/selection/CONSTANTS";
import type { SelectionService } from "../../services/selection/SelectionService";
import type { IRuntimeConfig, IRuntimeHooks, IRuntimeServices } from "../../types";
import { txSelectTool } from "./tx.select-tool";

function getModeFromTool(tool: TTool | undefined) {
  if (!tool) {
    return CanvasMode.SELECT;
  }

  if (tool.behavior.type !== "mode") {
    return CanvasMode.SELECT;
  }

  switch (tool.behavior.mode) {
    case "select":
      return CanvasMode.SELECT;
    case "hand":
      return CanvasMode.HAND;
    case "draw-create":
      return CanvasMode.DRAW_CREATE;
    case "click-create":
      return CanvasMode.CLICK_CREATE;
    default:
      return CanvasMode.SELECT;
  }
}

function fnNormalizeShortcut(shortcut: string) {
  return shortcut.trim().toLowerCase();
}

function txSyncCursor(
  render: SceneService,
  selection: SelectionService,
  transformCursor: string | null,
) {
  switch (selection.mode) {
    case CanvasMode.HAND:
      render.container.style.cursor = "grab";
      return;
    case CanvasMode.DRAW_CREATE:
      render.container.style.cursor = "crosshair";
      return;
    case CanvasMode.CLICK_CREATE:
      render.container.style.cursor = "pointer";
      return;
    case CanvasMode.SELECT:
    default:
      render.container.style.cursor = transformCursor ?? "default";
      return;
  }
}


function fnGetShortcutToolId(toolService: ToolService, event: KeyboardEvent) {
  if (event.altKey) {
    return null;
  }

  const prefix = [event.metaKey ? "meta" : "", event.ctrlKey ? "ctrl" : "", event.shiftKey ? "shift" : ""]
    .filter(Boolean)
    .join("+");
  const key = event.key === " " ? "space" : event.key;
  const normalizedKey = fnNormalizeShortcut(key);
  const candidate = prefix ? `${prefix}+${normalizedKey}` : normalizedKey;

  for (const tool of toolService.getTools()) {
    for (const shortcut of tool.shortcuts ?? []) {
      if (fnNormalizeShortcut(shortcut) === candidate) {
        return tool.id;
      }
    }
  }

  return null;
}

function mountToolbar(args: {
  toolbarGroups: IRuntimeConfig["toolbarGroups"];
  scene: SceneService;
  tool: ToolService;
  widgetPlacement: IRuntimeServices["widgetPlacement"];
  onToolSelect: (toolId: string) => void;
}) {
  const mountElement = args.scene.container.ownerDocument.createElement("div");
  mountElement.id = "toolbar";
  args.scene.container.appendChild(mountElement);

  const disposeRender = render(() => {
    return createComponent(RuntimeToolbar, {
      tool: args.tool,
      toolbarGroups: args.toolbarGroups,
      widgetPlacement: args.widgetPlacement,
      viewportElement: args.scene.container,
      onToolSelect: args.onToolSelect,
    });
  }, mountElement);

  return {
    mountElement,
    dispose() {
      disposeRender();
      mountElement.remove();
    },
  };
}

/**
 * Registers base tools and renders toolbar UI from editor tool registry.
 * Toolbar should stay dumb and only reflect registered tool state.
 */
export function createToolbarPlugin(): IPlugin<IRuntimeServices, IRuntimeHooks, IRuntimeConfig> {
  let toolbarMount: ReturnType<typeof mountToolbar> | null = null;
  let toolBeforeSpaceHold: string | null = null;

  return {
    name: "toolbar",
    apply(ctx) {
      const tool = ctx.services.require("tool");
      const scene = ctx.services.require("scene");
      const selection = ctx.services.require("selection");
      const widgetPlacement = ctx.services.require("widgetPlacement");
      let transformCursor: string | null = null;
      let unsubscribeTransformHover: (() => void) | null = null;

      tool.registerTool({
        id: "sidebar",
        label: "Sidebar",
        icon: SidebarOpen,
        shortcuts: ["ctrl+b"],
        priority: 10001,
        behavior: { type: "action" },
        onSelect: ctx.config.onToggleSidebar,
      });
      tool.registerTool({
        id: "hand",
        label: "Hand",
        icon: Hand,
        shortcuts: ["h"],
        priority: 0,
        behavior: { type: "mode", mode: "hand" },
      });
      tool.registerTool({
        id: "select",
        label: "Select",
        icon: MousePointer2,
        shortcuts: ["1", "escape"],
        priority: 10,
        behavior: { type: "mode", mode: "select" },
      });

      selection.setMode(getModeFromTool(tool.getTool(tool.activeToolId)));

      ctx.hooks.init.tap(() => {
        toolbarMount = mountToolbar({
          toolbarGroups: ctx.config.toolbarGroups,
          scene,
          tool,
          widgetPlacement,
          onToolSelect: (toolId) => {
            txSelectTool({ toolService: tool }, { toolId });
          },
        });
        unsubscribeTransformHover = scene.product.transforms.subscribeHover(
          (hover) => {
            transformCursor = hover?.cursor ?? null;
            txSyncCursor(scene, selection, transformCursor);
          },
        );
        txSyncCursor(scene, selection, transformCursor);
      });

      tool.hooks.activeToolChange.tap((toolId) => {
        selection.setMode(getModeFromTool(tool.getTool(toolId)));
        txSyncCursor(scene, selection, transformCursor);
        ctx.hooks.toolSelect.call(toolId);
      });

      ctx.hooks.keydown.tap((event) => {
        if (event.key === " ") {
          if (selection.selection.length > 0) {
            return false;
          }

          event.preventDefault();
          if (toolBeforeSpaceHold === null) {
            toolBeforeSpaceHold = tool.activeToolId;
            if (tool.activeToolId !== "hand") {
              txSelectTool({ toolService: tool }, { toolId: "hand" });
            }
          }
          return true;
        }

        const toolId = fnGetShortcutToolId(tool, event);
        if (!toolId) {
          return false;
        }

        const shortcutTool = tool.getTool(toolId);
        if (shortcutTool?.behavior.type === "mode" && toolId !== "hand") {
          selection.setSelection([]);
        }
        txSelectTool({ toolService: tool }, { toolId });
        return true;
      });

      ctx.hooks.keyup.tap((event) => {
        if (event.key !== " ") {
          return false;
        }

        if (toolBeforeSpaceHold === null) {
          return false;
        }

        event.preventDefault();
        txSelectTool({ toolService: tool }, { toolId: toolBeforeSpaceHold });
        toolBeforeSpaceHold = null;
        return true;
      });

      ctx.hooks.destroy.tap(() => {
        toolBeforeSpaceHold = null;
        tool.unregisterTool("sidebar");
        tool.unregisterTool("hand");
        tool.unregisterTool("select");
        unsubscribeTransformHover?.();
        unsubscribeTransformHover = null;
        transformCursor = null;
        scene.container.style.cursor = "";
        toolbarMount?.dispose();
        toolbarMount = null;
      });
    },
  };
}
