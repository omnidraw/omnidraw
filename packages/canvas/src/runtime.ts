import { createRuntime, createServiceRegistry, IServiceRegistry } from "@vibecanvas/runtime";
import { ThemeService } from "@vibecanvas/service-theme";
import { AsyncParallelHook, SyncExitHook, SyncHook } from "@vibecanvas/tapable";
import {
    createCameraControlPlugin, createConfirmDialogPlugin, createContextMenuPlugin, createEventListenerPlugin, createGridPlugin,
    createImagePlugin,
    createPenPlugin,
    createRecorderPlugin,
    createSceneHydratorPlugin,
    createSelectionStyleMenuPlugin,
    createSelectPlugin,
    createShape1dPlugin,
    createShape2dPlugin,
    createTextPlugin,
    createToolbarPlugin, createTransformPlugin, createVisualDebugPlugin
} from "./plugins";
import { CameraService } from "./services/camera/CameraService";
import { CanvasActiveSessionService } from "./services/active-session/CanvasActiveSessionService";
import { ConfirmDialogService } from "./services/confirm-dialog/ConfirmDialogService";
import { ContextMenuService } from "./services/context-menu/ContextMenuService";
import { CrdtService } from "./services/crdt/CrdtService";
import { ElementService } from "./services/element/ElementService";
import { GroupService } from "./services/group/GroupService";
import { HistoryService } from "./services/history/HistoryService";
import { LoggingService } from "./services/logging/LoggingService";
import { CanvasPortalService } from "./services/portal/CanvasPortalService";
import { RenderOrderService } from "./services/render-order/RenderOrderService";
import { SceneService } from "./services/scene/SceneService";
import { SelectionService } from "./services/selection/SelectionService";
import { SessionService } from "./services/session/SessionService";
import { ToolService } from "./services/tool/ToolService";
import { WidgetDropPlacementService } from "./services/widget-placement/WidgetDropPlacementService";
import type { ICanvasRuntimeExtension, TCanvasRuntimePlugin } from "./extension";
import { IRuntimeConfig, IRuntimeHooks } from "./types";
import type { TSceneServiceArgs } from "./services/scene/SceneService";

declare module "@vibecanvas/runtime" {
  interface IServiceMap {
    activeSession: CanvasActiveSessionService;
    camera: CameraService;
    confirmDialog: ConfirmDialogService;
    contextMenu: ContextMenuService;
    crdt: CrdtService;
    history: HistoryService;
    logging: LoggingService;
    portal: CanvasPortalService;
    scene: SceneService;
    renderOrder: RenderOrderService;
    selection: SelectionService;
    theme: ThemeService;
    tool: ToolService;
    element: ElementService;
    session: SessionService;
    group: GroupService;
    widgetPlacement: WidgetDropPlacementService;
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
    elementDefinitionInvalidated: new SyncHook(),
    elementPointerClick: new SyncExitHook(),
    elementPointerDown: new SyncExitHook(),
    elementPointerDoubleClick: new SyncExitHook(),
  };
}

export type TCanvasRuntimeComposition = {
  createScene?(args: TSceneServiceArgs): SceneService;
};

function createServices(
  config: Pick<
    IRuntimeConfig,
    "canvasId" | "container" | "docHandle" | "notification" | "themeService"
  >,
  composition: TCanvasRuntimeComposition,
): IServiceRegistry {
  const services = createServiceRegistry();
  const crdt = new CrdtService({ docHandle: config.docHandle });
  const activeSession = new CanvasActiveSessionService({ crdt });
  const element = new ElementService();
  const sessionService = new SessionService();
  const selection = new SelectionService();
  const history = new HistoryService();
  const portal = new CanvasPortalService(crdt);
  const sceneArgs: TSceneServiceArgs = {
    container: config.container,
    crdt,
    theme: config.themeService,
    selection,
    history,
    element,
    portal,
    ...(config.notification === undefined
      ? {}
      : { notification: config.notification }),
  };
  const scene = composition.createScene?.(sceneArgs)
    ?? new SceneService(sceneArgs);
  const camera = new CameraService({ scene });
  const confirmDialog = new ConfirmDialogService();
  const contextMenu = new ContextMenuService();
  const tool = new ToolService();
  const widgetPlacement = new WidgetDropPlacementService({ camera, scene });
  const logging = new LoggingService();
  const renderOrder = new RenderOrderService({
    crdt,
    history,
    contextMenu,
  });
  const group = new GroupService({
    contextMenu,
    crdt,
    history,
    selection,
    createId: () => crypto.randomUUID(),
    now: () => Date.now(),
  });

  services.provide("scene", 10, scene);
  services.provide("camera", 20, camera);
  services.provide("confirmDialog", 25, confirmDialog);
  services.provide("element", 30, element);
  services.provide("group", 230, group);
  services.provide("contextMenu", 40, contextMenu);
  services.provide("history", 50, history);
  services.provide("selection", 60, selection);
  services.provide("crdt", 70, crdt);
  services.provide("activeSession", 75, activeSession);
  services.provide("logging", 80, logging);
  services.provide("portal", 85, portal);
  services.provide("tool", 90, tool);
  services.provide("renderOrder", 100, renderOrder);
  services.provide("widgetPlacement", 105, widgetPlacement);
  services.provide("theme", 110, config.themeService);
  services.provide("session", 130, sessionService)

  return services;
}

export function buildRuntime(
  config: IRuntimeConfig,
  extensions: readonly ICanvasRuntimeExtension[] = [],
  composition: TCanvasRuntimeComposition = {},
) {
  const hooks = createHooks();
  const services = createServices(config, composition);
  const extensionInstalls = extensions.map((extension) => extension.install({
    config,
    hooks,
    services: {
      activeSession: services.require("activeSession"),
      camera: services.require("camera"),
      confirmDialog: services.require("confirmDialog"),
      contextMenu: services.require("contextMenu"),
      crdt: services.require("crdt"),
      history: services.require("history"),
      logging: services.require("logging"),
      portal: services.require("portal"),
      scene: services.require("scene"),
      renderOrder: services.require("renderOrder"),
      selection: services.require("selection"),
      theme: services.require("theme"),
      tool: services.require("tool"),
      element: services.require("element"),
      session: services.require("session"),
      group: services.require("group"),
      widgetPlacement: services.require("widgetPlacement"),
    },
  }));

  extensionInstalls.forEach((install) => {
    install.services?.forEach((registration) => {
      services.provide(registration.name as never, registration.startOrder, registration.service as never);
    });
  });

  const pluginsBeforeHydration: TCanvasRuntimePlugin[] = [
    createEventListenerPlugin(),
    createConfirmDialogPlugin(),
    createGridPlugin(),
    createToolbarPlugin(),
    createSelectionStyleMenuPlugin(),
    createContextMenuPlugin(),
    createSelectPlugin(),
    createTransformPlugin(),
    createShape1dPlugin(),
    createShape2dPlugin(),
    createPenPlugin(),
    createTextPlugin(),
    createImagePlugin(),
  ];
  const extensionPlugins = extensionInstalls.flatMap((install) => [...(install.plugins ?? [])]);
  const plugins: TCanvasRuntimePlugin[] = [
    ...pluginsBeforeHydration,
    ...extensionPlugins,
    createSceneHydratorPlugin(),
    createVisualDebugPlugin(),
    createCameraControlPlugin(),
  ];

  if (config.env.DEV) {
    plugins.splice(5, 0, createRecorderPlugin());
  }

  return createRuntime<IRuntimeHooks, IRuntimeConfig>({
    config,
    hooks,
    plugins,
    services,
    boot: async ({ services, hooks }) => {
      hooks.init.call();
      await hooks.initAsync.promise();
    },
    shutdown: async ({ services, hooks }) => {
      hooks.destroy.call();
      for (const install of [...extensionInstalls].reverse()) {
        await install.dispose?.();
      }
    },
  })
}
