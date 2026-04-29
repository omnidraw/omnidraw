import type { IService, IStartableService } from "@vibecanvas/runtime";
import type { IServiceContext, IStoppableService } from "@vibecanvas/runtime/interface.js";
import type { TElementData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { ThemeService } from "@vibecanvas/service-theme";
import Konva from "konva";
import type { CameraService, ContextMenuService, CrdtService, ElementService, HistoryService, LoggingService, RenderOrderService, SceneService, SelectionService, ToolService } from "..";
import { ELEMENT_DATA_ATTR, VC_ON_REMOVE_ATTR } from "../../core/CONSTANTS";
import type { IRuntimeConfig, IRuntimeHooks } from "../../types";
import {
    WIDGET_CONNECTION_INPUT_HANDLE_ID_PREFIX,
    WIDGET_CONNECTION_LINE_ID_PREFIX,
    WIDGET_CONNECTION_OUTPUT_HANDLE_ID_PREFIX,
    WIDGET_DOM_PORTAL_SYNC_ATTR,
    WIDGET_HOST_MIN_HEIGHT,
    WIDGET_HOST_MIN_WIDTH,
} from "./CONSTANTS";
import { fnCreateWidgetNode } from "./fn.create-widget-node";
import { fnGetHostThemeColors } from "./fn.get-host-theme-colors";
import { fnToWidgetElement } from "./fn.to-widget-element";
import { fxAttachWidgetListener } from "./fx.attach-widget-listener";
import { fxRegisterWidgetTool } from "./fx.register-tool";
import type { IWidgetConfig, IWidgetManagerServiceHooks, IWidgetManagerServiceProps } from "./interface";
import { txAttachDomPortal, type TWidgetDomPortalListener } from "./tx.attach-dom-portal";
import { txCreateWidgetCloneDrag } from "./tx.create-widget-clone-drag";
import { txResizeWidgetHost } from "./tx.resize-widget-host";
import { txSyncWidgetConnections } from "./tx.sync-widget-connections";
import { txUpdateWidgetNodeFromElement } from "./tx.update-widget-node-from-element";

type TWidgetDomPortalSync = () => void;
type TNodeOnRemove = (args: { node: unknown }) => void;


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
  // TODO: remove, we want to use elementRegistry.onRemove
  #domPortalCleanups = new Set<TWidgetDomPortalListener>();
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
  }

  start(ctx: IServiceContext<IRuntimeHooks, IRuntimeConfig>): void | Promise<void> {
    // @ts-expect-error this is safe, start runs before any other method
    this.runtimeHooks = ctx.hooks;
    this.#widgetPortal = document.createElement("div");
    this.#widgetPortal.style = "position: absolute; inset: 0; pointer-events: none;";
    this.#sceneService.stage.container().appendChild(this.#widgetPortal);
    // this.#domPortal.style =
    this.#widgetPortal.id = "widget-portal";
    this.#removeSelectionChangeListener = this.#selectionService.hooks.change.tap(() => {
      this.#syncRenderedWidgetConnections();
    });
  }

  stop(): void | Promise<void> {
    this.#removeSelectionChangeListener?.();
    this.#removeSelectionChangeListener = undefined;
    this.#domPortalCleanups.forEach((cleanup) => cleanup());
    this.#domPortalCleanups.clear();
    this.#widgetPortal.remove()
  }

  #syncRenderedWidgetConnections() {
    const widget = this.#sceneService.staticForegroundLayer.findOne((candidate: Konva.Node) => {
      return candidate instanceof Konva.Group && candidate.getAttr(ELEMENT_DATA_ATTR)?.type === "widget";
    });
    if (!(widget instanceof Konva.Group)) {
      return false;
    }

    return txSyncWidgetConnections({
      Circle: Konva.Circle,
      Group: Konva.Group,
      Line: Konva.Line,
      selection: this.#selectionService,
    }, { node: widget });
  }

  #removeRenderedWidgetConnection(connectionId: string, args: { sourceWidgetId?: string; targetWidgetId?: string }) {
    this.#sceneService.staticForegroundLayer.findOne(`#${WIDGET_CONNECTION_LINE_ID_PREFIX}-${connectionId}`)?.destroy();
    if (this.#selectionService.selectedConnectionId === connectionId) {
      this.#selectionService.setSelectedConnectionId(null);
    }

    if (args.sourceWidgetId) {
      this.#findWidgetNodeById(args.sourceWidgetId)
        ?.findOne(`#${WIDGET_CONNECTION_OUTPUT_HANDLE_ID_PREFIX}-${connectionId}`)
        ?.destroy();
    }

    if (args.targetWidgetId) {
      this.#findWidgetNodeById(args.targetWidgetId)
        ?.findOne(`#${WIDGET_CONNECTION_INPUT_HANDLE_ID_PREFIX}-${connectionId}`)
        ?.destroy();
    }
  }

  #removeRenderedWidgetConnections(node: Konva.Group) {
    const widgetData = node.getAttr(ELEMENT_DATA_ATTR) as TElementData;
    if (widgetData?.type !== "widget") {
      return;
    }

    widgetData.connections?.inputs?.forEach((connection) => {
      this.#removeRenderedWidgetConnection(connection.id, {
        sourceWidgetId: connection.sourceWidgetId,
      });
    });

    widgetData.connections?.outputs?.forEach((connection) => {
      this.#removeRenderedWidgetConnection(connection.id, {
        targetWidgetId: connection.targetWidgetId,
      });
    });

    this.#sceneService.staticForegroundLayer.batchDraw();
  }

  #findWidgetNodeById(id: string) {
    const node = this.#sceneService.staticForegroundLayer.findOne((candidate: Konva.Node) => {
      return candidate instanceof Konva.Group && candidate.id() === id;
    });

    return node instanceof Konva.Group ? node : null;
  }

  #removeWidgetNode(node: Konva.Node, args: { recordHistory: boolean }) {
    const element = this.#elementService.toElement(node);
    if (!element || element.data.type !== "widget") {
      return false;
    }

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

  registerWidget(wConfig: IWidgetConfig) {
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
      matchesNode: (node) => node.getAttr(ELEMENT_DATA_ATTR)?.type === 'widget',
      matchesElement: (element) => element.data.type === "widget" && element.data.kind === wConfig.id,
      createNode: (element) => {
        const colors = fnGetHostThemeColors(this.#themeService)
        const node = fnCreateWidgetNode(Konva, colors, element)
        const onRemove = txAttachDomPortal({
          node,
          widgetPortal: this.#widgetPortal,
          document,
          widgetServie: this,
          cameraService: this.#cameraService,
          selectionService: this.#selectionService,
          widgetConfig: wConfig,
        }, {element})
        if (node && onRemove) {
          const removeDomPortal = (() => {
            onRemove();
            this.#domPortalCleanups.delete(removeDomPortal);
          }) as TWidgetDomPortalListener;
          removeDomPortal.syncDiv = onRemove.syncDiv;

          this.#domPortalCleanups.add(removeDomPortal);
          node.setAttr(WIDGET_DOM_PORTAL_SYNC_ATTR, removeDomPortal.syncDiv);
          const existingOnRemove = node.getAttr(VC_ON_REMOVE_ATTR) as TNodeOnRemove | undefined;
          node.setAttr(VC_ON_REMOVE_ATTR, (removeArgs: { node: unknown }) => {
            existingOnRemove?.(removeArgs);
            this.#removeRenderedWidgetConnections(node);
            removeDomPortal();
          });
        }
        return node
      },
      updateElement: (element) => {
        if (element.data.type !== "widget" || element.data.kind !== wConfig.id) {
          return false;
        }

        const node = this.#sceneService.staticForegroundLayer.findOne((candidate: Konva.Node) => {
          return candidate.id() === element.id;
        });
        if (!node) {
          return false;
        }

        return txUpdateWidgetNodeFromElement({
          Circle: Konva.Circle,
          Group: Konva.Group,
          Line: Konva.Line,
          Rect: Konva.Rect,
        }, {
          node,
          element,
        });
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
              createConnectionId: () => crypto.randomUUID(),
              syncConnections: (connectionNode, syncArgs) => txSyncWidgetConnections({
                Circle: Konva.Circle,
                Group: Konva.Group,
                Line: Konva.Line,
                selection: this.#selectionService,
              }, { node: connectionNode, ...syncArgs }),
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
        if (element.data.type !== "widget") return;

        txResizeWidgetHost({
          Circle: Konva.Circle,
          Group: Konva.Group,
          Line: Konva.Line,
          Rect: Konva.Rect,
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
        createConnectionId: () => crypto.randomUUID(),
        syncConnections: (connectionNode, syncArgs) => txSyncWidgetConnections({
          Circle: Konva.Circle,
          Group: Konva.Group,
          Line: Konva.Line,
          selection: this.#selectionService,
        }, { node: connectionNode, ...syncArgs }),
      }, {})
    })

  }

}
