import type { IPlugin } from "@vibecanvas/runtime";
import { createOrpcWebsocketService, type OrpcWebsocketService } from "@vibecanvas/orpc-client";
import type { TElement, TWidgetData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { ThemeService } from "@vibecanvas/service-theme";
import Konva from "konva";
import { ELEMENT_DATA_ATTR } from "../../core/CONSTANTS";
import { isKonvaGroup } from "../../core/GUARDS";
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
import type { IRuntimeConfig, IRuntimeHooks } from "../../types";
import { WIDGET_WINDOW_CONTAINED } from "../../services/widget/CONSTANTS";
import { showFilesystemRootDialog } from "./RootPathDialog";
import type { TFilesystemWidgetPayload } from "./typed";
import { mountFilesystemWidget } from "./widget";

const FILESYSTEM_WIDGET_KIND = "filesystem";
const FILESYSTEM_WIDGET_WIDTH = 860;
const FILESYSTEM_WIDGET_HEIGHT = 560;

function createWidgetElement(args: {
  id: string;
  rootPath: string;
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
      kind: FILESYSTEM_WIDGET_KIND,
      expanded: true,
      window: WIDGET_WINDOW_CONTAINED,
      w: FILESYSTEM_WIDGET_WIDTH,
      h: FILESYSTEM_WIDGET_HEIGHT,
      payload: {
        rootPath: args.rootPath,
        openTabPaths: [],
        activePath: null,
      } satisfies TFilesystemWidgetPayload,
    },
    style: {},
  };
}

function getViewportCenter(args: { camera: CameraService; scene: SceneService }) {
  const rect = args.scene.container.getBoundingClientRect();
  return {
    x: (rect.width / 2 - args.camera.x) / args.camera.zoom - FILESYSTEM_WIDGET_WIDTH / 2,
    y: (rect.height / 2 - args.camera.y) / args.camera.zoom - FILESYSTEM_WIDGET_HEIGHT / 2,
  };
}

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
    name: "filesystem",
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
        id: FILESYSTEM_WIDGET_KIND,
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

      const createFilesystemWidget = async () => {
        if (!orpcService) return;

        const rootPath = await showFilesystemRootDialog({
          container: scene.container,
          apiService: orpcService.safeClient,
        });
        if (!rootPath) return;

        const center = getViewportCenter({ camera, scene });
        const timestamp = Date.now();
        const widgetElement = createWidgetElement({
          id: crypto.randomUUID(),
          rootPath,
          x: center.x,
          y: center.y,
          now: timestamp,
        });
        const node = element.createNodeFromElement(widgetElement);
        if (!isKonvaGroup(node)) {
          ctx.config.notification?.showError("Failed to create filesystem widget");
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
        id: FILESYSTEM_WIDGET_KIND,
        label: "Filesystem",
        shortcuts: ["f"],
        priority: 75,
        behavior: { type: "action" },
        onSelect: () => {
          void createFilesystemWidget();
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
