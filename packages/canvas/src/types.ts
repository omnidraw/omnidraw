import type { DocHandle } from "@automerge/automerge-repo";
import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { ThemeService } from "@vibecanvas/service-theme";
import type { AsyncParallelHook, SyncExitHook, SyncHook } from "@vibecanvas/tapable";
import type { CameraService, CanvasActiveSessionService, CanvasPortalService, ConfirmDialogService, ContextMenuService, CrdtService, ElementService, GroupService, HistoryService, LoggingService, RenderOrderService, SceneService, SelectionService, SessionService, ToolService, WidgetDropPlacementService } from "./services";
import type { TBrowserTenantScope } from "./fn.browser-tenant-scope";
import type {
  TCanvasInputPointerEvent,
  TCanvasInputWheelEvent,
} from "./engine/input/typed";

export type TImageUploadFormat = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
export type TUploadImage = (body: { data: Uint8Array; mime_type: TImageUploadFormat }) => Promise<{ url: string }>;
export type TCloneImage = (body: { url: string }) => Promise<{ url: string }>;

export type TCanvasImagePort = {
  uploadImage(body: { data: Uint8Array; mime_type: TImageUploadFormat }): Promise<{ url: string }>;
  cloneImage(body: { url: string }): Promise<{ url: string }>;
  deleteImage(body: { url: string }): Promise<{ ok: true }>;
};

export type TCanvasToolbarGroup = {
  name: string;
  json?: {
    svgIcon?: string | null;
    lucidIcon?: string | null;
  } | null;
};

export type TCanvasToolbarGroupsPort = {
  list(): Promise<readonly TCanvasToolbarGroup[]>;
  subscribe(listener: () => void): () => void;
};

export interface IRuntimeConfig {
  canvasId: string;
  tenant: TBrowserTenantScope;
  container: HTMLDivElement;
  docHandle: DocHandle<TCanvasDoc>;
  onToggleSidebar: () => void;
  env: Pick<ImportMetaEnv, "DEV">;
  themeService: ThemeService;
  image: TCanvasImagePort;
  toolbarGroups?: TCanvasToolbarGroupsPort;
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

export type TPointerEvent = TCanvasInputPointerEvent;
export type TMouseEvent = TCanvasInputPointerEvent;
export type TWheelEvent = TCanvasInputWheelEvent;
export type TElementPointerEvent = TCanvasInputPointerEvent & {
  hit: NonNullable<TCanvasInputPointerEvent["hit"]>;
};

export type TElementDefinitionInvalidatedEvent = {
  elementIds: readonly string[];
};

export interface IRuntimeServices {
  activeSession: CanvasActiveSessionService;
  camera: CameraService;
  confirmDialog: ConfirmDialogService;
  contextMenu: ContextMenuService;
  crdt: CrdtService;
  history: HistoryService;
  logging: LoggingService;
  portal: CanvasPortalService;
  scene: SceneService;
  renderOrder: RenderOrderService;
  selection: SelectionService;
  theme: ThemeService;
  tool: ToolService;
  element: ElementService;
  session: SessionService;
  group: GroupService;
  widgetPlacement: WidgetDropPlacementService;
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
  elementDefinitionInvalidated: SyncHook<[TElementDefinitionInvalidatedEvent]>;
  elementPointerClick: SyncExitHook<[TElementPointerEvent]>;
  elementPointerDown: SyncExitHook<[TElementPointerEvent]>;
  elementPointerDoubleClick: SyncExitHook<[TElementPointerEvent]>;
}
