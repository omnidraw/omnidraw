import type { ThemeService } from "@vibecanvas/service-theme";
import type { SyncHook } from "@vibecanvas/tapable";
import type { ContextMenuService, CrdtService, ElementService, LoggingService, SelectionService, TTool, ToolService } from "..";


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
}

export interface IWidgetConfig {
  id: string;
  tool?: Pick<TTool, "group" | "icon" | "label" | "priority" | "shortcuts" >
  initialPayload?: Record<string, any>;


}
