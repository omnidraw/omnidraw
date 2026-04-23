import type { IService, IStartableService } from "@vibecanvas/runtime";
import type { IServiceContext } from "@vibecanvas/runtime/interface.js";
import type { ThemeService } from "@vibecanvas/service-theme";
import Konva from "konva";
import type { CanvasRegistryService, ContextMenuService, CrdtService, ElementService, LoggingService, SelectionService, ToolService } from "..";
import type { IRuntimeConfig, IRuntimeHooks } from "../../types";
import { WIDGET_HOST_ELEMENT_DATA_ATTR } from "./CONSTANTS";
import { fnCreateWidgetNode } from "./fn.create-widget-node";
import { fnGetHostThemeColors } from "./fn.get-host-theme-colors";
import { fnToWidgetElement } from "./fn.to-widget-element";
import { fxAttachWidgetListener } from "./fx.attach-widget-listener";
import { fxRegisterWidgetTool } from "./fx.register-tool";
import type { IWidgetConfig, IWidgetManagerServiceHooks, IWidgetManagerServiceProps } from "./interface";


export class WidgetManagerService implements IService<IWidgetManagerServiceHooks>, IStartableService<IRuntimeHooks, IRuntimeConfig> {
  readonly name = "widget-manager";
  private crdtService: CrdtService;
  private loggingService: LoggingService;
  private themeService: ThemeService;
  private canvasRegistry: CanvasRegistryService;
  private selectionService: SelectionService;
  private contextMenuService: ContextMenuService;
  private elementService: ElementService;
  private toolService: ToolService;
  private readonly runtimeHooks!: IRuntimeHooks;


  constructor(props: IWidgetManagerServiceProps) {
    this.crdtService = props.crdtService;
    this.loggingService = props.loggingService;
    this.themeService = props.themeService;
    this.selectionService = props.selectionService;
    this.contextMenuService = props.contextMenuService;
    this.elementService = props.elementService;
    this.toolService = props.toolService;

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
        editorService: this.editorService,
        konva: Konva,
        themeService: this.themeService,
        crypto
      }, { widgetConfig: wConfig })
    }

    this.canvasRegistry.registerElement({
      id: wConfig.id,
      toElement: fnToWidgetElement,
      matchesNode: (node) => node.getAttr(WIDGET_HOST_ELEMENT_DATA_ATTR)?.type === 'widget',
      matchesElement: (element) => element.data.type === "widget" && element.data.kind === wConfig.id,

      createNode: (element) => {
        const colors = fnGetHostThemeColors(this.themeService)
        const node = fnCreateWidgetNode(Konva, colors, element)
        return node
      },
      createDragClone(args) {

        return true
      },
      attachListeners: (node) => fxAttachWidgetListener({ node, editorService: this.editorService, selectionService: this.selectionService,  }, {})
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
