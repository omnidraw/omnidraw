import type { IService, IStartableService } from "@vibecanvas/runtime";
import type { IServiceContext, IStoppableService } from "@vibecanvas/runtime/interface.js";
import type { TUiWidgetData, TWidgetData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { ThemeService } from "@vibecanvas/service-theme";
import Konva from "konva";
import type { CameraService, ContextMenuService, CrdtService, ElementService, HistoryService, LoggingService, RenderOrderService, SceneService, SelectionService, ToolService } from "..";
import { ELEMENT_DATA_ATTR, VC_ON_REMOVE_ATTR } from "../../core/CONSTANTS";
import type { IRuntimeConfig, IRuntimeHooks } from "../../types";
import {
    WIDGET_DOM_PORTAL_SYNC_ATTR,
    WIDGET_HOST_BODY_ID,
    WIDGET_HOST_BORDER_ID,
    WIDGET_HOST_DIVIDER_ID,
    WIDGET_HOST_HEADER_HEIGHT,
    WIDGET_HOST_HEADER_ID,
    WIDGET_HOST_MIN_HEIGHT,
    WIDGET_HOST_MIN_WIDTH,
    WIDGET_HOST_WINDOW_CORNER_RADIUS,
    WIDGET_WINDOW_CONTAINED,
    WIDGET_WINDOW_FULLSCREEN,
} from "./CONSTANTS";
import { fnCreateWidgetNode } from "./fn.create-widget-node";
import { fnGetHostThemeColors } from "./fn.get-host-theme-colors";
import { fnToWidgetElement } from "./fn.to-widget-element";
import { fxAttachWidgetListener } from "./fx.attach-widget-listener";
import { fxRegisterWidgetTool } from "./fx.register-tool";
import type { IWidgetConfig, IWidgetManagerServiceHooks, IWidgetManagerServiceProps } from "./interface";
import { txAttachDomPortal } from "./attach-dom-portal";
import { txCreateWidgetCloneDrag } from "./tx.create-widget-clone-drag";
import { txResizeWidgetHost } from "./tx.resize-widget-host";
import { txUpdateWidgetNodeFromElement } from "./tx.update-widget-node-from-element";
import type { TOrpcSafeClient } from "@vibecanvas/orpc-client";
import type { TActorEvent } from "@vibecanvas/api-actors/contract";

type TWidgetDomPortalSync = () => void;
type TNodeOnRemove = (args: { node: unknown }) => void;

export type TWidgetActorEvent = TActorEvent;

type TWidgetActorEventHandler = (event: TWidgetActorEvent) => void;

export class WidgetManagerService implements IService<IWidgetManagerServiceHooks>, IStartableService<IRuntimeHooks, IRuntimeConfig>, IStoppableService {
  readonly name = "widget-manager";
  #crdtService: CrdtService;
  #historyService?: HistoryService;
  #loggingService: LoggingService;
  #themeService: ThemeService;
  #selectionService: SelectionService;
  #contextMenuService: ContextMenuService;
  #elementService: ElementService;
  #toolService: ToolService;
  #sceneService: SceneService;
  #renderOrderService: RenderOrderService;
  #cameraService: CameraService;
  #widgetPortal!: HTMLDivElement;
  #removeSelectionChangeListener?: () => boolean;
  #apiService: TOrpcSafeClient;
  #actorEventSubscribers = new Map<string, Set<TWidgetActorEventHandler>>();
  #isActorEventListenerRunning = false;

  private readonly runtimeHooks!: IRuntimeHooks;


  constructor(props: IWidgetManagerServiceProps) {
    this.#crdtService = props.crdtService;
    this.#historyService = props.historyService;
    this.#loggingService = props.loggingService;
    this.#themeService = props.themeService;
    this.#selectionService = props.selectionService;
    this.#contextMenuService = props.contextMenuService;
    this.#elementService = props.elementService;
    this.#toolService = props.toolService;
    this.#sceneService = props.sceneService;
    this.#renderOrderService = props.renderOrderService;
    this.#cameraService = props.cameraService;
    this.#apiService = props.apiService
  }

  start(ctx: IServiceContext<IRuntimeHooks, IRuntimeConfig>): void | Promise<void> {
    // @ts-expect-error this is safe, start runs before any other method
    this.runtimeHooks = ctx.hooks;
    this.#widgetPortal = document.createElement("div");
    this.#widgetPortal.style = "position: absolute; inset: 0; pointer-events: none;";
    this.#sceneService.stage.container().appendChild(this.#widgetPortal);
    // this.#domPortal.style =
    this.#widgetPortal.id = "widget-portal";

    this.#isActorEventListenerRunning = true;
    void this.#listenToActorEvents();
  }

  stop(): void | Promise<void> {
    this.#isActorEventListenerRunning = false;
    this.#actorEventSubscribers.clear();
    this.#removeSelectionChangeListener?.();
    this.#removeSelectionChangeListener = undefined;
    this.#contextMenuService.close();
    this.#widgetPortal.remove()
  }


  async #listenToActorEvents() {
    const [err, it] = await this.#apiService.api.actors.events({});
    if (err) {
      console.error(err);
      return;
    }

    for await (const event of it) {
      if (!this.#isActorEventListenerRunning) break;
      this.#routeActorEvent(event as TWidgetActorEvent);
    }
  }

  #routeActorEvent(event: TWidgetActorEvent) {
    const subscribers = this.#actorEventSubscribers.get(event.actorId);
    if (!subscribers) return;

    subscribers.forEach((handler) => handler(event));
  }

  subscribeActorInstanceEvents(actorInstanceId: string, handler: TWidgetActorEventHandler) {
    let subscribers = this.#actorEventSubscribers.get(actorInstanceId);
    if (!subscribers) {
      subscribers = new Set();
      this.#actorEventSubscribers.set(actorInstanceId, subscribers);
    }

    subscribers.add(handler);

    return () => {
      subscribers.delete(handler);
      if (subscribers.size === 0) {
        this.#actorEventSubscribers.delete(actorInstanceId);
      }
    };
  }

  #findWidgetNodeById(id: string) {
    const node = this.#sceneService.staticForegroundLayer.findOne((candidate: Konva.Node) => {
      return candidate instanceof Konva.Group && candidate.id() === id;
    });

    return node instanceof Konva.Group ? node : null;
  }

  #removeWidgetNode(node: Konva.Node, args: { recordHistory: boolean }) {
    const element = this.#elementService.toElement(node);
    if (!element || (element.data.type !== "widget" && element.data.type !== "ui-widget")) {
      return false;
    }

    this.#contextMenuService.close();
    const commitResult = this.#elementService.removeElement(node, this.#crdtService.build()).commit();
    this.#selectionService.clear();
    this.#sceneService.staticForegroundLayer.batchDraw();

    if (!args.recordHistory || !this.#historyService) {
      return true;
    }

    this.#historyService.record({
      label: "remove-widget",
      undo: () => {
        commitResult.rollback();
        const restoredNode = this.#elementService.createNodeFromElement(element);
        if (!(restoredNode instanceof Konva.Group)) {
          return;
        }

        this.#sceneService.staticForegroundLayer.add(restoredNode);
        this.#elementService.updateElement(element);
        this.#renderOrderService.sortChildren(this.#sceneService.staticForegroundLayer);
        this.#selectionService.setSelection([restoredNode]);
        this.#selectionService.setFocusedNode(restoredNode);
        this.#sceneService.staticForegroundLayer.batchDraw();
      },
      redo: () => {
        const redoNode = this.#findWidgetNodeById(element.id);
        if (redoNode) {
          this.#removeWidgetNode(redoNode, { recordHistory: false });
          return;
        }

        this.#crdtService.applyOps({ ops: commitResult.redoOps });
        this.#selectionService.clear();
        this.#sceneService.staticForegroundLayer.batchDraw();
      },
    });

    return true;
  }

  #syncWidgetDomPortal(node: Konva.Node) {
    const syncWidgetDomPortal = node.getAttr(WIDGET_DOM_PORTAL_SYNC_ATTR) as TWidgetDomPortalSync | undefined;
    syncWidgetDomPortal?.();
  }

  #setWidgetExpanded(node: Konva.Group, expanded: boolean) {
    const body = node.findOne(`#${WIDGET_HOST_BODY_ID}`);
    if (body instanceof Konva.Rect) {
      body.visible(expanded);
      body.listening(expanded);
    }

    const border = node.findOne(`#${WIDGET_HOST_BORDER_ID}`);
    if (border instanceof Konva.Rect) {
      border.height(expanded ? node.height() : WIDGET_HOST_HEADER_HEIGHT);
    }

    const divider = node.findOne(`#${WIDGET_HOST_DIVIDER_ID}`);
    if (divider instanceof Konva.Rect) {
      divider.visible(expanded);
      divider.listening(false);
    }

    const header = node.findOne(`#${WIDGET_HOST_HEADER_ID}`);
    if (header instanceof Konva.Rect) {
      header.cornerRadius([WIDGET_HOST_WINDOW_CORNER_RADIUS, WIDGET_HOST_WINDOW_CORNER_RADIUS, 0, 0]);
    }

    const widgetData = node.getAttr(ELEMENT_DATA_ATTR) as TUiWidgetData | TWidgetData | undefined;
    if (widgetData?.type === "widget" || widgetData?.type === "ui-widget") {
      node.setAttr(ELEMENT_DATA_ATTR, {
        ...widgetData,
        expanded,
      });
    }

    this.#syncWidgetDomPortal(node);
    node.getLayer()?.batchDraw();
  }

  #setWidgetWindowMode(node: Konva.Group, windowMode: typeof WIDGET_WINDOW_CONTAINED | typeof WIDGET_WINDOW_FULLSCREEN) {
    if (windowMode === WIDGET_WINDOW_FULLSCREEN) {
      if (this.#selectionService.selection.length > 0) {
        this.#selectionService.setSelection([]);
      }

      if (this.#selectionService.focusedId !== node.id()) {
        this.#selectionService.setFocusedId(node.id());
      }
    }

    const widgetData = node.getAttr(ELEMENT_DATA_ATTR) as TUiWidgetData | TWidgetData | undefined;
    if (widgetData?.type === "widget" || widgetData?.type === "ui-widget") {
      node.setAttr(ELEMENT_DATA_ATTR, {
        ...widgetData,
        window: windowMode,
      });
    }

    this.#syncWidgetDomPortal(node);
    node.getLayer()?.batchDraw();
  }

  #openWidgetHeaderMenu(args: {
    node: Konva.Group;
    anchor: {
      x: number;
      y: number;
    };
  }) {
    const widgetData = args.node.getAttr(ELEMENT_DATA_ATTR) as TUiWidgetData | TWidgetData | undefined;
    if (widgetData?.type !== "widget" && widgetData?.type !== "ui-widget") {
      return;
    }

    this.#selectionService.setSelection([args.node]);
    this.#contextMenuService.openWithActionsAt({
      x: args.anchor.x,
      y: args.anchor.y,
      actions: [
        {
          id: "widget-toggle-expanded",
          label: widgetData.expanded === false ? "Restore" : "Minimize",
          priority: 10,
          onSelect: () => {
            this.#contextMenuService.close();
            this.#setWidgetExpanded(args.node, widgetData.expanded === false);
          },
        },
        {
          id: "widget-toggle-fullscreen",
          label: widgetData.window === WIDGET_WINDOW_FULLSCREEN ? "Exit fullscreen" : "Fullscreen",
          priority: 20,
          onSelect: () => {
            this.#contextMenuService.close();
            this.#setWidgetWindowMode(
              args.node,
              widgetData.window === WIDGET_WINDOW_FULLSCREEN
                ? WIDGET_WINDOW_CONTAINED
                : WIDGET_WINDOW_FULLSCREEN,
            );
          },
        },
        {
          id: "widget-delete",
          label: "Delete widget",
          priority: 30,
          onSelect: () => {
            this.#removeWidgetNode(args.node, { recordHistory: true });
          },
        },
      ],
    });
  }

  registerWidget(wConfig: IWidgetConfig) {
    this.#toolService.unregisterTool(wConfig.id);
    this.#elementService.unregisterElement(wConfig.id);

    if (wConfig.tool) {
      fxRegisterWidgetTool({
        toolService: this.#toolService,
        konva: Konva,
        themeService: this.#themeService,
        crypto
      }, { widgetConfig: wConfig })
    }

    this.#elementService.registerElement({
      id: wConfig.id,
      toElement: fnToWidgetElement,
      matchesNode: (node) => {
        const type = node.getAttr(ELEMENT_DATA_ATTR)?.type;
        return type === 'widget' || type === 'ui-widget';
      },
      matchesElement: (element) => (element.data.type === "widget" || element.data.type === "ui-widget") && element.data.kind === wConfig.id,
      createNode: (element) => {
        const colors = fnGetHostThemeColors(this.#themeService)
        const node = fnCreateWidgetNode(Konva, colors, element, { label: wConfig.tool?.label })
        const onRemove = txAttachDomPortal({
          node,
          widgetPortal: this.#widgetPortal,
          document,
          widgetServie: this,
          cameraService: this.#cameraService,
          selectionService: this.#selectionService,
          widgetConfig: wConfig,
          apiService: this.#apiService
        }, {element})
        if (node && onRemove) {
          node.setAttr(WIDGET_DOM_PORTAL_SYNC_ATTR, onRemove.syncDiv);
          const existingOnRemove = node.getAttr(VC_ON_REMOVE_ATTR) as TNodeOnRemove | undefined;
          node.setAttr(VC_ON_REMOVE_ATTR, (removeArgs: { node: unknown }) => {
            existingOnRemove?.(removeArgs);
            onRemove();
          });
        }
        return node
      },
      onDelete: (element) => {
        if (element.data.type !== "widget" || element.data.kind !== wConfig.id) {
          return {};
        }

        return {};
      },
      updateElement: (element) => {
        if ((element.data.type !== "widget" && element.data.type !== "ui-widget") || element.data.kind !== wConfig.id) {
          return false;
        }

        const node = this.#sceneService.staticForegroundLayer.findOne((candidate: Konva.Node) => {
          return candidate.id() === element.id;
        });
        if (!node) {
          return false;
        }

        const colors = fnGetHostThemeColors(this.#themeService);
        const didUpdate = txUpdateWidgetNodeFromElement({
          Circle: Konva.Circle,
          Group: Konva.Group,
          Line: Konva.Line,
          Rect: Konva.Rect,
          Text: Konva.Text,
        }, {
          node,
          element,
          label: wConfig.tool?.label,
          labelFill: colors.headerTitleFill,
        });
        return didUpdate;
      },
      createDragClone: ({ node }) => {
        if (!this.#historyService) {
          return false;
        }

        return txCreateWidgetCloneDrag({
          Group: Konva.Group,
          crdt: this.#crdtService,
          element: this.#elementService,
          history: this.#historyService,
          renderOrder: this.#renderOrderService,
          scene: this.#sceneService,
          selection: this.#selectionService,
          createId: () => crypto.randomUUID(),
          createNode: (candidateElement) => {
            const candidateNode = this.#elementService.createNodeFromElement(candidateElement);
            return candidateNode instanceof Konva.Group ? candidateNode : null;
          },
          now: () => Date.now(),
          clone: <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T,
          setupNode: (candidateNode) => {
            return fxAttachWidgetListener({
              node: candidateNode,
              Circle: Konva.Circle,
              Group: Konva.Group,
              Line: Konva.Line,
              Rect: Konva.Rect,
              hooks: this.runtimeHooks,
              selection: this.#selectionService,
              toElement: (candidate) => this.#elementService.toElement(candidate),
              crdtService: this.#crdtService,
              startDragClone: (cloneArgs) => this.#elementService.createDragClone(cloneArgs),
              removeWidget: (removeNode) => this.#removeWidgetNode(removeNode, { recordHistory: true }),
              openWidgetMenu: (menuArgs) => this.#openWidgetHeaderMenu(menuArgs),
              closeWidgetMenu: () => this.#contextMenuService.close(),
              setTimer: (callback, timeout) => window.setInterval(callback, timeout),
              clearTimer: (timer) => window.clearInterval(timer as ReturnType<typeof window.setInterval>),
            }, {})
          },
        }, { node });
      },
      getTransformOptions(args) {
        return {
          flipEnabled: false,
          keepRatio: false,
          boundBoxFunc: (oldBox, newBox) => {
            if (newBox.width < WIDGET_HOST_MIN_WIDTH || newBox.height < WIDGET_HOST_MIN_HEIGHT) {
              return oldBox;
            }

            return newBox;
          },
        }
      },
      onResize: ({ node, element, anchors }) => {
        if (element.data.type !== "widget" && element.data.type !== "ui-widget") return;

        txResizeWidgetHost({
          Circle: Konva.Circle,
          Group: Konva.Group,
          Line: Konva.Line,
          Rect: Konva.Rect,
          Text: Konva.Text,
        }, {
          node,
          anchors,
        });
        const syncWidgetDomPortal = node.getAttr(WIDGET_DOM_PORTAL_SYNC_ATTR) as TWidgetDomPortalSync | undefined;
        syncWidgetDomPortal?.();

        return {
          cancel: true,
          crdt: false,
        };
      },

      attachListeners: (node) => fxAttachWidgetListener({
        node,
        Circle: Konva.Circle,
        Group: Konva.Group,
        Line: Konva.Line,
        Rect: Konva.Rect,
        hooks: this.runtimeHooks,
        selection: this.#selectionService,
        toElement: (candidateNode) => this.#elementService.toElement(candidateNode),
        crdtService: this.#crdtService,
        startDragClone: (args) => this.#elementService.createDragClone(args),
        removeWidget: (removeNode) => this.#removeWidgetNode(removeNode, { recordHistory: true }),
        openWidgetMenu: (args) => this.#openWidgetHeaderMenu(args),
        closeWidgetMenu: () => this.#contextMenuService.close(),
        setTimer: (callback, timeout) => window.setInterval(callback, timeout),
        clearTimer: (timer) => window.clearInterval(timer as ReturnType<typeof window.setInterval>),
      }, {})
    })

  }

}
