import type { IService, IStartableService } from "@vibecanvas/runtime";
import type { IServiceContext, IStoppableService } from "@vibecanvas/runtime/interface.js";
import type { ThemeService } from "@vibecanvas/service-theme";
import Konva from "konva";
import type { CameraService, ContextMenuService, CrdtService, ElementService, LoggingService, SceneService, SelectionService, ToolService } from "..";
import type { IRuntimeConfig, IRuntimeHooks } from "../../types";
import { ELEMENT_DATA_ATTR } from "../../core/CONSTANTS";
import { fnCreateWidgetNode } from "./fn.create-widget-node";
import { fnGetHostThemeColors } from "./fn.get-host-theme-colors";
import { fnToWidgetElement } from "./fn.to-widget-element";
import { fxAttachWidgetListener } from "./fx.attach-widget-listener";
import { fxRegisterWidgetTool } from "./fx.register-tool";
import type { IWidgetConfig, IWidgetManagerServiceHooks, IWidgetManagerServiceProps } from "./interface";
import { txResizeWidgetHost } from "./tx.resize-widget-host";
import { txAttachDomPortal, type TWidgetDomPortalListener } from "./tx.attach-dom-portal";
import { txUpdateWidgetNodeFromElement } from "./tx.update-widget-node-from-element";
import { WIDGET_DOM_PORTAL_SYNC_ATTR, WIDGET_HOST_MIN_HEIGHT, WIDGET_HOST_MIN_WIDTH } from "./CONSTANTS";

type TWidgetDomPortalSync = () => void;


export class WidgetManagerService implements IService<IWidgetManagerServiceHooks>, IStartableService<IRuntimeHooks, IRuntimeConfig>, IStoppableService {
  readonly name = "widget-manager";
  #crdtService: CrdtService;
  #loggingService: LoggingService;
  #themeService: ThemeService;
  #selectionService: SelectionService;
  #contextMenuService: ContextMenuService;
  #elementService: ElementService;
  #toolService: ToolService;
  #sceneService: SceneService;
  #cameraService: CameraService;
  #widgetPortal!: HTMLDivElement;
  // TODO: remove, we want to use elementRegistry.onRemove
  #domPortalCleanups = new Set<TWidgetDomPortalListener>();
  private readonly runtimeHooks!: IRuntimeHooks;


  constructor(props: IWidgetManagerServiceProps) {
    this.#crdtService = props.crdtService;
    this.#loggingService = props.loggingService;
    this.#themeService = props.themeService;
    this.#selectionService = props.selectionService;
    this.#contextMenuService = props.contextMenuService;
    this.#elementService = props.elementService;
    this.#toolService = props.toolService;
    this.#sceneService = props.sceneService;
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
  }

  stop(): void | Promise<void> {
    this.#domPortalCleanups.forEach((cleanup) => cleanup());
    this.#domPortalCleanups.clear();
    this.#widgetPortal.remove()
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
          renderDom: wConfig.renderDom,
        }, {element})
        if (node && onRemove) {
          this.#domPortalCleanups.add(onRemove);
          node.setAttr(WIDGET_DOM_PORTAL_SYNC_ATTR, onRemove.syncDiv);
        }
        // TODO [S49]: add onRemove to some callback later
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
          Group: Konva.Group,
          Rect: Konva.Rect,
        }, {
          node,
          element,
        });
      },
      createDragClone(args) {

        return true
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
          Group: Konva.Group,
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
        Rect: Konva.Rect,
        hooks: this.runtimeHooks,
        selection: this.#selectionService,
        toElement: (candidateNode) => this.#elementService.toElement(candidateNode),
        crdtService: this.#crdtService,
      }, {})
    })

  }

}
