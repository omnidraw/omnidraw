import type { IPlugin } from "@vibecanvas/runtime";
import { createOrpcWebsocketService, type OrpcWebsocketService } from "@vibecanvas/orpc-client";
import type { TElement, TWidgetData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { ThemeService } from "@vibecanvas/service-theme";
import Konva from "konva";
import SquareTerminal from "lucide-static/icons/square-terminal.svg?raw";
import type {
  CameraService,
  CrdtService,
  ElementService,
  RenderOrderService,
  SceneService,
  SelectionService,
  ToolService,
  WidgetManagerService,
} from "../../services";
import { ELEMENT_DATA_ATTR } from "../../core/CONSTANTS";
import { WIDGET_WINDOW_CONTAINED } from "../../services/widget/CONSTANTS";
import type { IRuntimeConfig, IRuntimeHooks } from "../../types";
import { isKonvaGroup } from "../../core/GUARDS";
import { showTerminalCwdDialog } from "./CwdDialog";
import type { TTerminalWidgetPayload } from "./typed";
import { mountTerminalWidget } from "./widget";

const TERMINAL_WIDGET_KIND = "terminal";
const TERMINAL_WIDGET_WIDTH = 900;
const TERMINAL_WIDGET_HEIGHT = 560;

function createWidgetElement(args: {
  id: string;
  tabId: string;
  workingDirectory: string;
  x: number;
  y: number;
  now: number;
}): TElement {
  return {
    id: args.id,
    x: args.x,
    y: args.y,
    rotation: 0,
    zIndex: "",
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: args.now,
    updatedAt: args.now,
    data: {
      type: "widget",
      kind: TERMINAL_WIDGET_KIND,
      expanded: true,
      window: WIDGET_WINDOW_CONTAINED,
      w: TERMINAL_WIDGET_WIDTH,
      h: TERMINAL_WIDGET_HEIGHT,
      payload: {
        workingDirectory: args.workingDirectory,
        title: "Terminal",
        activeTabId: args.tabId,
        tabs: [{
          id: args.tabId,
          title: args.workingDirectory,
          workingDirectory: args.workingDirectory,
        }],
      } satisfies TTerminalWidgetPayload,
    },
    style: {},
  };
}

function getViewportCenter(args: { camera: CameraService; scene: SceneService }) {
  const rect = args.scene.container.getBoundingClientRect();
  return {
    x: (rect.width / 2 - args.camera.x) / args.camera.zoom - TERMINAL_WIDGET_WIDTH / 2,
    y: (rect.height / 2 - args.camera.y) / args.camera.zoom - TERMINAL_WIDGET_HEIGHT / 2,
  };
}

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
  camera: CameraService;
  crdt: CrdtService;
  element: ElementService;
  renderOrder: RenderOrderService;
  scene: SceneService;
  selection: SelectionService;
  theme: ThemeService;
  tool: ToolService;
  widgetManager: WidgetManagerService;
}, IRuntimeHooks, IRuntimeConfig> {
  let orpcService: OrpcWebsocketService | null = null;

  return {
    name: "terminal",
    apply(ctx) {
      const camera = ctx.services.require("camera");
      const crdt = ctx.services.require("crdt");
      const element = ctx.services.require("element");
      const renderOrder = ctx.services.require("renderOrder");
      const scene = ctx.services.require("scene");
      const selection = ctx.services.require("selection");
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

      const createTerminalWidget = async () => {
        if (!orpcService) return;

        const workingDirectory = await showTerminalCwdDialog({
          container: scene.container,
          apiService: orpcService.safeClient,
        });
        if (!workingDirectory) return;

        const center = getViewportCenter({ camera, scene });
        const timestamp = Date.now();
        const widgetId = crypto.randomUUID();
        const widgetElement = createWidgetElement({
          id: widgetId,
          tabId: crypto.randomUUID(),
          workingDirectory,
          x: center.x,
          y: center.y,
          now: timestamp,
        });
        const node = element.createNodeFromElement(widgetElement);
        if (!isKonvaGroup(node)) {
          ctx.config.notification?.showError("Failed to create terminal widget");
          return;
        }

        scene.staticForegroundLayer.add(node);
        renderOrder.assignOrderOnInsert({
          parent: scene.staticForegroundLayer,
          nodes: [node],
          position: "front",
        });

        const serializedElement = element.toElement(node) ?? widgetElement;
        crdt.build()
          .patchElement(serializedElement.id, serializedElement)
          .commit();

        selection.setSelection([node]);
        selection.setFocusedNode(node);
        scene.staticForegroundLayer.batchDraw();
        tool.setActiveTool("select");
      };

      tool.registerTool({
        id: TERMINAL_WIDGET_KIND,
        label: "Terminal",
        icon: SquareTerminal,
        shortcuts: ["j"],
        priority: 76,
        behavior: { type: "action" },
        onSelect: () => {
          void createTerminalWidget();
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
