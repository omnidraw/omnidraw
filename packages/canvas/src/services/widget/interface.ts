import type { ThemeService } from "@vibecanvas/service-theme";
import type { SyncHook } from "@vibecanvas/tapable";
import type {
  CameraService,
  ConfirmDialogService,
  ContextMenuService,
  CrdtService,
  ElementService,
  HistoryService,
  LoggingService,
  RenderOrderService,
  SceneService,
  SelectionService,
  TTool,
  ToolService,
} from "..";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TOrpcSafeClient } from "@vibecanvas/orpc-client";

export interface IWidgetManagerServiceHooks {
  widgetChange: SyncHook<[]>;
}

export interface IWidgetManagerServiceProps {
  crdtService: CrdtService;
  contextMenuService: ContextMenuService;
  historyService?: HistoryService;
  loggingService: LoggingService;
  themeService: ThemeService;
  selectionService: SelectionService;
  elementService: ElementService;
  toolService: ToolService;
  sceneService: SceneService;
  renderOrderService: RenderOrderService;
  cameraService: CameraService;
  confirmDialogService: ConfirmDialogService;
  apiService: TOrpcSafeClient
}

export type TWidgetRenderArgs = {
  root: HTMLDivElement;
  element: TElement;
  titleBar?: TWidgetTitleBarPortal;
};

export type TWidgetRenderCleanup = () => void;

export type TWidgetTitleBarAction = {
  id: string;
  label: string;
};

export type TWidgetTitleBarActionState = {
  pressed?: boolean;
  disabled?: boolean;
  label?: string;
};

export type TWidgetTitleBarPortal = {
  onAction: (id: string, handler: () => void) => () => void;
  setActionState: (id: string, state: TWidgetTitleBarActionState) => void;
};

export interface IWidgetConfig {
  id: string;
  dataType?: "widget" | "ui-widget";
  tool?: Pick<TTool, "group" | "icon" | "label" | "priority" | "shortcuts" >
  initialPayload?: Record<string, any>;
  createInitialPayload?: () => Record<string, any>;
  createClonePayload?: (sourcePayload: Record<string, any>) => Record<string, any>;
  actor?: {
    actorDefinitionName: string;
  };
  titleBarActions?: readonly TWidgetTitleBarAction[];
  renderDom?: (args: TWidgetRenderArgs) => TWidgetRenderCleanup | void;
  sandbox?: IWidgetSandboxConfig;
}

interface IWidgetSandboxConfig {
  arrowjs: {
    "main.ts": string;
    "main.css"?: string;
    [key: string]: string | undefined;
  } | {
    "main.js": string;
    "main.css"?: string;
    [key: string]: string | undefined;
  }
}
