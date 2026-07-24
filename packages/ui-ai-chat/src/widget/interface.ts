import type { SyncHook } from "@vibecanvas/tapable";
import type {
  CanvasPortalService,
  ConfirmDialogService,
  ContextMenuService,
  CrdtService,
  ElementService,
  HistoryService,
  RenderOrderService,
  SelectionService,
  TTool,
  TToolPointerEvent,
  TWidgetDropRequest,
  ToolService,
} from "@vibecanvas/canvas/services";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TWidgetBrowserPort } from "../ports";
import type { WidgetUiRuntime } from '../widget-runtime/WidgetUiRuntime';

export interface IWidgetManagerServiceHooks {
  widgetChange: SyncHook<[]>;
}

export interface IWidgetManagerServiceProps {
  crdtService: CrdtService;
  contextMenuService: ContextMenuService;
  historyService?: HistoryService;
  selectionService: SelectionService;
  elementService: ElementService;
  toolService: ToolService;
  portalService: CanvasPortalService;
  renderOrderService: RenderOrderService;
  confirmDialogService: ConfirmDialogService;
  browser: TWidgetBrowserPort;
  product(): TWidgetCanvasProductPort;
  neutralHost?: Readonly<{
    canvasId: string;
    runtime: WidgetUiRuntime;
    deleteDefinition?(args: Readonly<{ definitionId: string }>): Promise<boolean>;
  }>;
}

export type TWidgetCanvasProductCreationCommit = Readonly<{
  belowThreshold: boolean;
  worldBounds: Readonly<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }>;
  current: Readonly<{
    world: Readonly<{ x: number; y: number }>;
  }>;
}>;

export type TWidgetCanvasProductPort = Readonly<{
  interactions: {
    beginCreation(
      event: TToolPointerEvent,
      options: Readonly<{
        thresholdViewport?: number;
        onCommit(event: TWidgetCanvasProductCreationCommit): void;
      }>,
    ): void;
    cancel(): void;
  };
}>;

export type TWidgetRenderArgs = {
  root: HTMLDivElement;
  element: TElement;
  titleBar?: TWidgetTitleBarPortal;
};

export type TWidgetRenderCleanup = () => void;

export type TWidgetTitleBarAction = {
  id: string;
  label: string;
  kind?: "menu" | "minimize" | "maximize" | "restore" | "close" | "custom";
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
  toolId?: string;
  dataType?: "ui-widget";
  cloneable?: boolean;
  tool?: Pick<TTool, "label"> & Partial<Pick<TTool, "group" | "icon" | "priority" | "shortcuts">>
  widgetPlacement?: TWidgetDropRequest;
  getTitle?: (element: TElement) => string;
  initialPayload?: Record<string, any>;
  createInitialPayload?: () => Record<string, any>;
  createClonePayload?: (sourcePayload: Record<string, any>) => Record<string, any>;
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
