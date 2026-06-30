import type { DocHandle } from "@automerge/automerge-repo";
import type { TOrpcSafeClient } from "@vibecanvas/orpc-client";
import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { ThemeService } from "@vibecanvas/service-theme";
import type { AsyncParallelHook, SyncExitHook, SyncHook } from "@vibecanvas/tapable";
import type Konva from "konva";
import type { Group } from "konva/lib/Group";
import type { KonvaEventObject } from "konva/lib/Node";
import type { Shape, ShapeConfig } from "konva/lib/Shape";
import type { CameraService, ContextMenuService, CrdtService, ElementService, GroupService, HistoryService, LoggingService, RenderOrderService, SceneService, SelectionService, SessionService, ToolService, WidgetManagerService } from "./services";

export type TImageUploadFormat = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
export type TUploadImage = (body: { data: Uint8Array; mime_type: TImageUploadFormat }) => Promise<{ url: string }>;
export type TCloneImage = (body: { url: string }) => Promise<{ url: string }>;

export interface IRuntimeConfig {
  canvasId: string;
  container: HTMLDivElement;
  docHandle: DocHandle<TCanvasDoc>;
  onToggleSidebar: () => void;
  env: Pick<ImportMetaEnv, "DEV">;
  themeService: ThemeService;
  apiService: TOrpcSafeClient;
  notification?: {
    showSuccess(title: string, description?: string): void;
    showError(title: string, description?: string): void;
    showInfo(title: string, description?: string): void;
  };
}


export type TRenderOrderSnapshot = {
  parentId: string;
  items: Array<{
    id: string;
    zIndex: string;
    kind: "element" | "group";
  }>;
};

export type TPointerEvent = Konva.KonvaEventObject<PointerEvent>;
export type TMouseEvent = Konva.KonvaEventObject<MouseEvent>;
export type TWheelEvent = Konva.KonvaEventObject<WheelEvent>;

export type TElementPointerEvent = KonvaEventObject<PointerEvent, Shape<ShapeConfig> | Group>;

export type TWidgetRegistryEvent = {
  kind: string;
};

export interface IRuntimeServices {
  camera: CameraService;
  contextMenu: ContextMenuService;
  crdt: CrdtService;
  history: HistoryService;
  logging: LoggingService;
  scene: SceneService;
  renderOrder: RenderOrderService;
  selection: SelectionService;
  theme: ThemeService;
  tool: ToolService;
  element: ElementService;
  session: SessionService;
  widgetManager: WidgetManagerService;
  group: GroupService;
}

export interface IRuntimeHooks {
  /**
   * Called at the initialization stage.
   */
  init: SyncHook<[]>;
  /**
   * Called at the initialization stage.
   */
  initAsync: AsyncParallelHook<[]>;
  /**
   * Called at the destruction stage.
   */
  destroy: SyncHook<[]>;
  pointerDown: SyncHook<[TPointerEvent]>;
  pointerUp: SyncHook<[TPointerEvent]>;
  pointerOut: SyncHook<[TPointerEvent]>;
  pointerOver: SyncHook<[TPointerEvent]>;
  pointerMove: SyncHook<[TMouseEvent]>;
  pointerWheel: SyncHook<[TWheelEvent]>;
  pointerCancel: SyncHook<[TPointerEvent]>;
  keydown: SyncHook<[KeyboardEvent]>;
  keyup: SyncHook<[KeyboardEvent]>;
  gridVisible: SyncHook<[boolean]>;
  toolSelect: SyncHook<[string]>;
  widgetRegister: SyncHook<[TWidgetRegistryEvent]>;
  elementPointerClick: SyncExitHook<[TElementPointerEvent]>;
  elementPointerDown: SyncExitHook<[TElementPointerEvent]>;
  elementPointerDoubleClick: SyncExitHook<[TElementPointerEvent]>;
}
