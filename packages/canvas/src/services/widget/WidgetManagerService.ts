import type { IService, IStartableService } from "@vibecanvas/runtime";
import type { IServiceContext } from "@vibecanvas/runtime/interface.js";
import type { ThemeService } from "@vibecanvas/service-theme";
import Konva from "konva";
import type { ContextMenuService, CrdtService, ElementService, LoggingService, SelectionService, ToolService } from "..";
import type { IRuntimeConfig, IRuntimeHooks } from "../../types";
import { ELEMENT_DATA_ATTR } from "../../core/CONSTANTS";
import { fnCreateWidgetNode } from "./fn.create-widget-node";
import { fnGetHostThemeColors } from "./fn.get-host-theme-colors";
import { fnToWidgetElement } from "./fn.to-widget-element";
import { fxAttachWidgetListener } from "./fx.attach-widget-listener";
import { fxRegisterWidgetTool } from "./fx.register-tool";
import type { IWidgetConfig, IWidgetManagerServiceHooks, IWidgetManagerServiceProps } from "./interface";


export class WidgetManagerService implements IService<IWidgetManagerServiceHooks>, IStartableService<IRuntimeHooks, IRuntimeConfig> {
  readonly name = "widget-manager";
  #crdtService: CrdtService;
  #loggingService: LoggingService;
  #themeService: ThemeService;
  #selectionService: SelectionService;
  #contextMenuService: ContextMenuService;
  #elementService: ElementService;
  #toolService: ToolService;
  private readonly runtimeHooks!: IRuntimeHooks;


  constructor(props: IWidgetManagerServiceProps) {
    this.#crdtService = props.crdtService;
    this.#loggingService = props.loggingService;
    this.#themeService = props.themeService;
    this.#selectionService = props.selectionService;
    this.#contextMenuService = props.contextMenuService;
    this.#elementService = props.elementService;
    this.#toolService = props.toolService;

    console.log('WidgetManagerService constructor', props)
  }

  start(ctx: IServiceContext<IRuntimeHooks, IRuntimeConfig>): void | Promise<void> {
    // @ts-expect-error this is safe, start runs before any other method
    this.runtimeHooks = ctx.hooks;
    this.setupExampleWidget();
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
        return node
      },
      createDragClone(args) {

        return true
      },

      attachListeners: (node) => fxAttachWidgetListener({
        node,
        Circle: Konva.Circle,
        Group: Konva.Group,
        Rect: Konva.Rect,
        hooks: this.runtimeHooks,
        selection: this.#selectionService,

      }, {})
    })

  }

  setupExampleWidget() {
    const widgetConfig: IWidgetConfig = {
      id: "example",
      tool: {
        label: "Example",
        shortcuts: ['m']

      }
    }

    this.registerWidget(widgetConfig);
  }
}
