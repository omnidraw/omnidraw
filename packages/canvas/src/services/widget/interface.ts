import type { ThemeService } from "@vibecanvas/service-theme";
import type { SyncHook } from "@vibecanvas/tapable";
import type {
  CameraService,
  ContextMenuService,
  CrdtService,
  ElementService,
  LoggingService,
  RenderOrderService,
  SceneService,
  SelectionService,
  TTool,
  ToolService,
} from "..";


export interface IWidgetManagerServiceHooks {
  widgetChange: SyncHook<[]>;
}

export interface IWidgetManagerServiceProps {
  crdtService: CrdtService;
  contextMenuService: ContextMenuService;
  loggingService: LoggingService;
  themeService: ThemeService;
  selectionService: SelectionService;
  elementService: ElementService;
  toolService: ToolService;
  sceneService: SceneService;
  renderOrderService: RenderOrderService;
  cameraService: CameraService;
}

export interface IWidgetConfig {
  id: string;
  tool?: Pick<TTool, "group" | "icon" | "label" | "priority" | "shortcuts" >
  initialPayload?: Record<string, any>;


}
