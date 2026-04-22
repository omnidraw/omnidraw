import type { DocHandle } from "@automerge/automerge-repo";
import { createRuntime, createServiceRegistry, IServiceRegistry } from "@vibecanvas/runtime";
import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ThemeService } from "@vibecanvas/service-theme";
import { AsyncParallelHook, SyncExitHook, SyncHook } from "@vibecanvas/tapable";
import {
  createCameraControlPlugin, createContextMenuPlugin, createEventListenerPlugin, createGridPlugin,
  createHistoryControlPlugin,
  createPenPlugin,
  createRecorderPlugin, createRenderOrderPlugin, createSceneHydratorPlugin,
  createSelectPlugin,
  createToolbarPlugin, createTransformPlugin, createVisualDebugPlugin
} from "./plugins";
import {
  CameraService,
  CanvasRegistryService,
  ContextMenuService, CrdtService, EditorService,
  ElementService,
  GroupService,
  HistoryService,
  LoggingService, RenderOrderService, SceneService, SelectionService,
  SessionService,
  ToolService,
  WidgetManagerService,
} from "./services";
import { IRuntimeConfig, IRuntimeHooks } from "./types";


declare module "@vibecanvas/runtime" {
  interface IServiceMap {
    camera: CameraService;
    contextMenu: ContextMenuService;
    crdt: CrdtService;
    editor: EditorService;
    history: HistoryService;
    logging: LoggingService;
    scene: SceneService;
    renderOrder: RenderOrderService;
    selection: SelectionService;
    theme: ThemeService;
    canvasRegistry: CanvasRegistryService;
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
    elementPointerClick: new SyncExitHook(),
    elementPointerDown: new SyncExitHook(),
    elementPointerDoubleClick: new SyncExitHook(),
  };
}

function createServices(config: {
  container: HTMLDivElement;
  docHandle: DocHandle<TCanvasDoc>;
  themeService: ThemeService;
}): IServiceRegistry {
  const services = createServiceRegistry();
  const element = new ElementService();
  const sessionService = new SessionService();
  const scene = new SceneService({ container: config.container, });
  const camera = new CameraService({ scene });
  const canvasRegistry = new CanvasRegistryService();
  const contextMenu = new ContextMenuService();
  const history = new HistoryService();
  const selection = new SelectionService();
  const crdt = new CrdtService({ docHandle: config.docHandle });
  const tool = new ToolService(scene, element, crdt, selection);
  const logging = new LoggingService();
  const editor = new EditorService(scene, canvasRegistry, crdt, selection);
  const widgetManager = new WidgetManagerService({
    crdtService: crdt,
    contextMenuService: contextMenu,
    loggingService: logging,
    editorService: editor,
    themeService: config.themeService,
    canvasRegistryService: canvasRegistry,
    selectionService: selection,
  });

  const renderOrder = new RenderOrderService({
    crdt,
    history,
    scene,
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
  // services.provide("canvasRegistry", 30, canvasRegistry);
  services.provide("contextMenu", 40, contextMenu);
  services.provide("history", 50, history);
  services.provide("selection", 60, selection);
  services.provide("crdt", 70, crdt);
  services.provide("logging", 80, logging);
  services.provide("tool", 90, tool);
  // services.provide("editor", 90, editor);
  services.provide("renderOrder", 100, renderOrder);
  services.provide("theme", 110, config.themeService);
  // services.provide("widgetManager", 120, widgetManager);
  services.provide("session", 130, sessionService)

  return services;
}

export function buildRuntime(config: IRuntimeConfig) {
  const plugins: Array<import("@vibecanvas/runtime").IPlugin<any, IRuntimeHooks, IRuntimeConfig>> = [
    createEventListenerPlugin(),
    createGridPlugin(),
    createToolbarPlugin(),
    // createSelectionStyleMenuPlugin(),
    createContextMenuPlugin(),
    createHistoryControlPlugin(),
    createRenderOrderPlugin(),
    createSelectPlugin(),
    createTransformPlugin(),
    // createShape1dPlugin(),
    // createShape2dPlugin(),
    createPenPlugin(),
    // createTextPlugin(),
    // createImagePlugin(),
    // createGroupPlugin(),
    createSceneHydratorPlugin(),
    createVisualDebugPlugin(),
    createCameraControlPlugin(),
    // createHostedComponentPlugin(),
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
