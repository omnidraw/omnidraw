import { createRuntime, createServiceRegistry, IServiceRegistry } from "@vibecanvas/runtime";
import { ThemeService } from "@vibecanvas/service-theme";
import { AsyncParallelHook, SyncExitHook, SyncHook } from "@vibecanvas/tapable";
import {
    createCameraControlPlugin, createContextMenuPlugin, createEventListenerPlugin, createFilesystemPlugin, createGridPlugin,
    createHistoryControlPlugin,
    createImagePlugin,
    createPenPlugin,
    createRecorderPlugin,
    createSceneHydratorPlugin,
    createSelectionStyleMenuPlugin,
    createSelectPlugin,
    createShape1dPlugin,
    createShape2dPlugin,
    createTerminalPlugin,
    createTextPlugin,
    createToolbarPlugin, createTransformPlugin, createVisualDebugPlugin,
    createWidgetPlugin
} from "./plugins";
import { ActorConnectionService } from "./services/actor-connection/ActorConnectionService";
import { CameraService } from "./services/camera/CameraService";
import { ContextMenuService } from "./services/context-menu/ContextMenuService";
import { CrdtService } from "./services/crdt/CrdtService";
import { ElementService } from "./services/element/ElementService";
import { GroupService } from "./services/group/GroupService";
import { HistoryService } from "./services/history/HistoryService";
import { LoggingService } from "./services/logging/LoggingService";
import { RenderOrderService } from "./services/render-order/RenderOrderService";
import { SceneService } from "./services/scene/SceneService";
import { SelectionService } from "./services/selection/SelectionService";
import { SessionService } from "./services/session/SessionService";
import { ToolService } from "./services/tool/ToolService";
import { WidgetManagerService } from "./services/widget/WidgetManagerService";
import { IRuntimeConfig, IRuntimeHooks } from "./types";

declare module "@vibecanvas/runtime" {
  interface IServiceMap {
    actorConnection: ActorConnectionService;
    camera: CameraService;
    contextMenu: ContextMenuService;
    crdt: CrdtService;
    history: HistoryService;
    logging: LoggingService;
    scene: SceneService;
    renderOrder: RenderOrderService;
    selection: SelectionService;
    theme: ThemeService;
    tool: ToolService;
    element: ElementService;
    session: SessionService;
    widgetManager: WidgetManagerService;
    group: GroupService;
  }
}

function createHooks(): IRuntimeHooks {
  return {
    init: new SyncHook(),
    initAsync: new AsyncParallelHook(),
    destroy: new SyncHook(),
    pointerDown: new SyncHook(),
    pointerUp: new SyncHook(),
    pointerOut: new SyncHook(),
    pointerOver: new SyncHook(),
    pointerMove: new SyncHook(),
    pointerWheel: new SyncHook(),
    pointerCancel: new SyncHook(),
    keydown: new SyncHook(),
    keyup: new SyncHook(),
    gridVisible: new SyncHook(),
    toolSelect: new SyncHook(),
    widgetRegister: new SyncHook(),
    elementPointerClick: new SyncExitHook(),
    elementPointerDown: new SyncExitHook(),
    elementPointerDoubleClick: new SyncExitHook(),
  };
}

function createServices(config: Pick<IRuntimeConfig, "apiService" | "canvasId" | "container" | "docHandle" | "notification" | "themeService">): IServiceRegistry {
  const services = createServiceRegistry();
  const crdt = new CrdtService({ docHandle: config.docHandle });
  const element = new ElementService();
  const sessionService = new SessionService();
  const scene = new SceneService({ container: config.container, });
  const camera = new CameraService({ scene });
  const contextMenu = new ContextMenuService();
  const history = new HistoryService();
  const selection = new SelectionService();
  const tool = new ToolService(scene, element, crdt, selection);
  const logging = new LoggingService();
  const actorConnection = new ActorConnectionService({
    apiService: config.apiService,
    canvasId: config.canvasId,
    contextMenu,
    scene,
    selection,
    notifyError: config.notification?.showError,
  });
  const renderOrder = new RenderOrderService({
    crdt,
    history,
    scene,
    contextMenu,
  });
  const widgetManager = new WidgetManagerService({
    crdtService: crdt,
    contextMenuService: contextMenu,
    historyService: history,
    loggingService: logging,
    themeService: config.themeService,
    selectionService: selection,
    elementService: element,
    toolService: tool,
    sceneService: scene,
    renderOrderService: renderOrder,
    cameraService: camera,
    actorConnectionService: actorConnection,
  });
  const group = new GroupService(
    camera,
    element,
    contextMenu,
    crdt,
    history,
    logging,
    scene,
    renderOrder,
    selection,
    config.themeService,
  );

  services.provide("scene", 10, scene);
  services.provide("camera", 20, camera);
  services.provide("element", 30, element);
  services.provide("group", 230, group);
  services.provide("contextMenu", 40, contextMenu);
  services.provide("history", 50, history);
  services.provide("selection", 60, selection);
  services.provide("actorConnection", 65, actorConnection);
  services.provide("crdt", 70, crdt);
  services.provide("logging", 80, logging);
  services.provide("tool", 90, tool);
  services.provide("renderOrder", 100, renderOrder);
  services.provide("theme", 110, config.themeService);
  services.provide("widgetManager", 120, widgetManager);
  services.provide("session", 130, sessionService)

  return services;
}

export function buildRuntime(config: IRuntimeConfig) {
  const plugins: Array<import("@vibecanvas/runtime").IPlugin<any, IRuntimeHooks, IRuntimeConfig>> = [
    createEventListenerPlugin(),
    createGridPlugin(),
    createToolbarPlugin(),
    createSelectionStyleMenuPlugin(),
    createContextMenuPlugin(),
    createHistoryControlPlugin(),
    createSelectPlugin(),
    createTransformPlugin(),
    createShape1dPlugin(),
    createShape2dPlugin(),
    createPenPlugin(),
    createTextPlugin(),
    createImagePlugin(),
    createFilesystemPlugin(),
    createTerminalPlugin(),
    createSceneHydratorPlugin(),
    createVisualDebugPlugin(),
    createCameraControlPlugin(),
    createWidgetPlugin(),
  ];

  if (config.env.DEV) {
    plugins.splice(5, 0, createRecorderPlugin());
  }

  return createRuntime<IRuntimeHooks, IRuntimeConfig>({
    config,
    hooks: createHooks(),
    plugins,
    services: createServices(config),
    boot: async ({ services, hooks }) => {
      hooks.init.call();
      await hooks.initAsync.promise();
    },
    shutdown: async ({ services, hooks }) => {
      hooks.destroy.call();
    },
  })
}
