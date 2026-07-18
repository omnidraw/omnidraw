import type { IPlugin } from "@vibecanvas/runtime";
import type { TElement, TUiWidgetData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TOrpcSafeClient } from "@vibecanvas/orpc-client";
import type Konva from "konva";
import SquareTerminal from "lucide-static/icons/square-terminal.svg?raw";
import { ELEMENT_DATA_ATTR } from "../../core/CONSTANTS";
import { isKonvaGroup } from "../../core/GUARDS";
import type {
  CrdtService,
  SceneService
} from "../../services";
import type { IRuntimeConfig, IRuntimeHooks, IRuntimeServices } from "../../types";
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
  if (!currentElement || currentElement.data.type !== "ui-widget") {
    return;
  }

  const nextData: TUiWidgetData = {
    ...currentElement.data,
    payload: {
      ...(currentElement.data.payload ?? {}),
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

export function createTerminalPlugin(portal: {
  apiService: TOrpcSafeClient;
  widgetHost: {
    registerWidget(config: {
      id: string;
      dataType: "ui-widget";
      tool: { label: string; icon: string; shortcuts: string[]; priority: number };
      initialPayload: Record<string, unknown>;
      renderDom(args: { root: HTMLDivElement; element: TElement }): (() => void) | void;
    }): void;
  };
}): IPlugin<IRuntimeServices, IRuntimeHooks, IRuntimeConfig> {

  return {
    name: "terminal",
    apply(ctx) {
      const crdt = ctx.services.require("crdt");
      const scene = ctx.services.require("scene");
      const tool = ctx.services.require("tool");
      const widgetManager = portal.widgetHost;

      widgetManager.registerWidget({
        id: TERMINAL_WIDGET_KIND,
        dataType: "ui-widget",
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
          return mountTerminalWidget({
            root,
            element: widgetElement,
            apiService: portal.apiService,
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
      });
    },
  };
}
