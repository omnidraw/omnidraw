import type { ThemeService } from "@vibecanvas/service-theme";
import type { SyncHook } from "@vibecanvas/tapable";
import type {
  CameraService,
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
import type { ActorConnectionService } from "../actor-connection/ActorConnectionService";
import type { TElement, TJsonValue } from "@vibecanvas/service-automerge/types/canvas-doc.types";

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
  actorConnectionService?: ActorConnectionService;
}

export type TWidgetRenderArgs = {
  root: HTMLDivElement;
  element: TElement;
};

export type TWidgetRenderCleanup = () => void;

export interface IWidgetConfig {
  id: string;
  dataType?: "widget" | "ui-widget";
  tool?: Pick<TTool, "group" | "icon" | "label" | "priority" | "shortcuts" >
  initialPayload?: Record<string, any>;
  actor?: {
    actorDefinitionId: string;
    actorRevisionId: string;
    actorSlug: string;
    actorName: string;
    actorVersion: string;
    uiKind?: string;
    uiBundleFileId?: string | null;
    uiManifest?: Record<string, TJsonValue>;
    initialActorInput?: Record<string, TJsonValue>;
    uiProps?: Record<string, TJsonValue>;
  };
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
