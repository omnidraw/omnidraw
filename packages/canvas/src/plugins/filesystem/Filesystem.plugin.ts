import type { IPlugin } from "@vibecanvas/runtime";
import { createOrpcWebsocketService, type OrpcWebsocketService } from "@vibecanvas/orpc-client";
import type { TWidgetData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import Konva from "konva";
import FolderCode from "lucide-static/icons/folder-code.svg?raw";
import { ELEMENT_DATA_ATTR } from "../../core/CONSTANTS";
import { isKonvaGroup } from "../../core/GUARDS";
import type {
  CrdtService,
  SceneService,
  ToolService,
  WidgetManagerService,
} from "../../services";
import type { IRuntimeConfig, IRuntimeHooks } from "../../types";
import type { TFilesystemWidgetPayload } from "./typed";
import { mountFilesystemWidget } from "./widget";

const FILESYSTEM_WIDGET_KIND = "filesystem";

function persistFilesystemPayload(args: {
  crdt: CrdtService;
  scene: SceneService;
  elementId: string;
  payload: TFilesystemWidgetPayload;
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

export function createFilesystemPlugin(): IPlugin<{
  crdt: CrdtService;
  scene: SceneService;
  tool: ToolService;
  widgetManager: WidgetManagerService;
}, IRuntimeHooks, IRuntimeConfig> {
  let orpcService: OrpcWebsocketService | null = null;

  return {
    name: "filesystem",
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
        id: FILESYSTEM_WIDGET_KIND,
        tool: {
          label: "Filesystem",
          icon: FolderCode,
          shortcuts: ["f"],
          priority: 75,
        },
        initialPayload: {
          openTabPaths: [],
          activePath: null,
        } satisfies TFilesystemWidgetPayload,
        renderDom: ({ root, element: widgetElement }) => {
          if (!orpcService) return;
          return mountFilesystemWidget({
            root,
            element: widgetElement,
            apiService: orpcService.safeClient,
            onPersist: (payload) => persistFilesystemPayload({
              crdt,
              scene,
              elementId: widgetElement.id,
              payload,
            }),
          });
        },
      });

      ctx.hooks.destroy.tap(() => {
        tool.unregisterTool(FILESYSTEM_WIDGET_KIND);
        orpcService?.websocket.close();
        orpcService = null;
      });
    },
  };
}
