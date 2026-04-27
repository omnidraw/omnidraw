import type { IPlugin } from "@vibecanvas/runtime";
import { createOrpcWebsocketService, type OrpcWebsocketService } from "@vibecanvas/orpc-client";
import type { TWidgetData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import Konva from "konva";
import SquareTerminal from "lucide-static/icons/square-terminal.svg?raw";
import { ELEMENT_DATA_ATTR } from "../../core/CONSTANTS";
import { isKonvaGroup } from "../../core/GUARDS";
import type {
  CrdtService,
  SceneService,
  ToolService,
  WidgetManagerService,
} from "../../services";
import type { IRuntimeConfig, IRuntimeHooks } from "../../types";
import type { TTerminalWidgetPayload } from "./typed";
import { mountTerminalWidget } from "./widget";

const TERMINAL_WIDGET_KIND = "terminal";

function persistTerminalPayload(args: {
  crdt: CrdtService;
  scene: SceneService;
  elementId: string;
  payload: TTerminalWidgetPayload;
}) {
  const currentElement = args.crdt.doc()?.elements[args.elementId];
  if (!currentElement || currentElement.data.type !== "widget") {
    return;
  }

  const nextData: TWidgetData = {
    ...currentElement.data,
    payload: {
      ...currentElement.data.payload,
      ...args.payload,
    },
  };

  const node = args.scene.staticForegroundLayer.findOne((candidate: Konva.Node) => {
    return isKonvaGroup(candidate) && candidate.id() === args.elementId;
  });
  if (isKonvaGroup(node)) {
    node.setAttr(ELEMENT_DATA_ATTR, nextData);
  }

  args.crdt.build()
    .patchElement(args.elementId, "data", nextData)
    .commit();
}

export function createTerminalPlugin(): IPlugin<{
  crdt: CrdtService;
  scene: SceneService;
  tool: ToolService;
  widgetManager: WidgetManagerService;
}, IRuntimeHooks, IRuntimeConfig> {
  let orpcService: OrpcWebsocketService | null = null;

  return {
    name: "terminal",
    apply(ctx) {
      const crdt = ctx.services.require("crdt");
      const scene = ctx.services.require("scene");
      const tool = ctx.services.require("tool");
      const widgetManager = ctx.services.require("widgetManager");

      orpcService = createOrpcWebsocketService({
        onNotification: (event) => {
          if (event.type === "error") {
            ctx.config.notification?.showError(event.title, event.description);
            return;
          }

          ctx.config.notification?.showInfo(event.title, event.description);
        },
      });

      widgetManager.registerWidget({
        id: TERMINAL_WIDGET_KIND,
        tool: {
          label: "Terminal",
          icon: SquareTerminal,
          shortcuts: ["j"],
          priority: 76,
        },
        initialPayload: {
          activeTabId: null,
          tabs: [],
        } satisfies TTerminalWidgetPayload,
        renderDom: ({ root, element: widgetElement }) => {
          if (!orpcService) return;
          return mountTerminalWidget({
            root,
            element: widgetElement,
            apiService: orpcService.safeClient,
            onPersist: (payload) => persistTerminalPayload({
              crdt,
              scene,
              elementId: widgetElement.id,
              payload,
            }),
          });
        },
      });

      ctx.hooks.destroy.tap(() => {
        tool.unregisterTool(TERMINAL_WIDGET_KIND);
        orpcService?.websocket.close();
        orpcService = null;
      });
    },
  };
}
