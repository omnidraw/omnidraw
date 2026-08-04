import type {
  TJsonValue,
  TSceneNode,
  TVec2,
} from "@omnidraw/cangine";
import type {
  TCanvasFillColorCode,
  TCanvasInkColorCode,
} from "@omnidraw/theme-contract";

/** The canvas metadata required by the portable canvas kernel. */
export type TCanvasDescriptor = Readonly<{
  id: string;
}>;

export type TCanvasItemId = TSceneNode["id"];
export type TCanvasRevision = number;
export type TCanvasItemRevision = number;
export type TCanvasJsonPath = readonly (string | number)[];

/** One concrete, host-selected local resource choice for a placed widget. */
export type TCanvasWidgetResourceBindingV1 = Readonly<{
  resourceId: string;
  allowRead: boolean;
  allowWrite: boolean;
}>;

export type TCanvasWidgetExtensionV1 =
  | Readonly<{
      schemaVersion: 1;
      type: "ui-widget";
      kind: string;
      payload?: TJsonValue;
      uiProps?: TJsonValue;
    }>
  | Readonly<{
      schemaVersion: 1;
      type: "widget-instance";
      instanceId: string;
      widgetKey: string;
      resourceBindings?: Readonly<
        Record<string, TCanvasWidgetResourceBindingV1>
      >;
      uiProps?: TJsonValue;
    }>;

export type TCanvasAuthoringExtensionV1 = Readonly<{
  schemaVersion: 1;
  locked?: boolean;
  penSource?: Readonly<{
    points: readonly TVec2[];
    pressures: readonly number[];
    simulatePressure: boolean;
  }>;
}>;

export type TCanvasImageExtensionV1 = Readonly<{
  schemaVersion: 1;
  url: string;
  mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
}>;

/** Viewer-theme-adaptive authoring intent with concrete Cangine paint fallback. */
export type TCanvasSemanticStyleExtensionV1 = Readonly<{
  schemaVersion: 1;
  background?: TCanvasFillColorCode;
  ink?: TCanvasInkColorCode;
}>;

/** One complete authored Cangine node and its database concurrency metadata. */
export type TCanvasItemSnapshot = Readonly<{
  id: TCanvasItemId;
  item: TSceneNode;
  itemRevision: TCanvasItemRevision;
  createdAtSec: string;
  updatedAtSec: string;
}>;

export type TCanvasSnapshot = Readonly<{
  canvasId: string;
  revision: TCanvasRevision;
  items: readonly TCanvasItemSnapshot[];
}>;

export type TCanvasItemPatch =
  | Readonly<{
      type: "set";
      path: TCanvasJsonPath;
      value: TJsonValue;
    }>
  | Readonly<{
      type: "remove";
      path: TCanvasJsonPath;
    }>;

export type TCanvasOperation =
  | Readonly<{
      type: "insert";
      item: TSceneNode;
    }>
  | Readonly<{
      type: "patch";
      itemId: TCanvasItemId;
      patches: readonly TCanvasItemPatch[];
    }>
  | Readonly<{
      type: "replace";
      item: TSceneNode;
    }>
  | Readonly<{
      type: "delete";
      itemId: TCanvasItemId;
    }>
  | Readonly<{
      type: "reparent";
      itemId: TCanvasItemId;
      parentId: TCanvasItemId | null;
      orderKey?: string;
    }>
  | Readonly<{
      type: "reorder";
      itemId: TCanvasItemId;
      orderKey: string;
    }>;

export type TCanvasPrecondition =
  | Readonly<{
      type: "item-absent";
      itemId: TCanvasItemId;
    }>
  | Readonly<{
      type: "item-revision";
      itemId: TCanvasItemId;
      itemRevision: TCanvasItemRevision;
    }>
  | Readonly<{
      type: "path-absent";
      itemId: TCanvasItemId;
      path: TCanvasJsonPath;
    }>
  | Readonly<{
      type: "path-value";
      itemId: TCanvasItemId;
      path: TCanvasJsonPath;
      value: TJsonValue;
    }>;

export type TCanvasCommand = Readonly<{
  commandId: string;
  canvasId: string;
  baseRevision: TCanvasRevision;
  operations: readonly TCanvasOperation[];
  preconditions: readonly TCanvasPrecondition[];
}>;

export type TCanvasItemsChangedEvent = Readonly<{
  type: "items-changed";
  canvasId: string;
  commandId: string;
  revision: TCanvasRevision;
  changedItems: readonly TCanvasItemSnapshot[];
  deletedItemIds: readonly TCanvasItemId[];
}>;

export type TCanvasResyncRequiredEvent = Readonly<{
  type: "resync-required";
  canvasId: string;
  revision: TCanvasRevision;
}>;

export type TCanvasEvent =
  | TCanvasItemsChangedEvent
  | TCanvasResyncRequiredEvent;

/**
 * Protocol-neutral access to one authoritative canvas document.
 *
 * Every async iterator produced by `subscribe` must implement prompt
 * cancellation: calling `AsyncIterator.return()` closes its underlying
 * stream and settles any pending `next()` call without waiting for another
 * canvas event. Consumers call `return()` when replacing or disposing a
 * document runtime.
 */
export type TCanvasDocumentTransport = Readonly<{
  getSnapshot(args: Readonly<{ canvasId: string }>): Promise<TCanvasSnapshot>;
  execute(command: TCanvasCommand): Promise<TCanvasItemsChangedEvent>;
  subscribe(args: Readonly<{
    canvasId: string;
    afterRevision: number;
  }>): AsyncIterable<TCanvasEvent>;
}>;

export type TCanvasItemQueryFilter =
  | Readonly<{ type: "all" }>
  | Readonly<{ type: "ids"; ids: readonly TCanvasItemId[] }>
  | Readonly<{ type: "kind"; kind: TSceneNode["kind"] }>
  | Readonly<{ type: "parent"; parentId: TCanvasItemId | null }>
  | Readonly<{ type: "widget-instance"; instanceId: string }>
  | Readonly<{
      type: "widget-key";
      widgetKey: string;
    }>;

export type TCanvasItemQueryCursor =
  | Readonly<{ type: "id"; id: TCanvasItemId }>
  | Readonly<{
      type: "parent-order";
      orderKey: string;
      id: TCanvasItemId;
    }>
  | Readonly<{
      type: "widget-identity";
      instanceId: string;
      id: TCanvasItemId;
    }>;

export type TCanvasItemQuery = Readonly<{
  canvasId: string;
  filter: TCanvasItemQueryFilter;
  limit?: number;
  cursor?: TCanvasItemQueryCursor;
}>;

export type TCanvasItemPage = Readonly<{
  items: readonly TCanvasItemSnapshot[];
  nextCursor: TCanvasItemQueryCursor | null;
}>;

export type TCanvasContractIssue = Readonly<{
  code: string;
  path: string;
  message: string;
  itemId?: string;
}>;

export type TCanvasContractValidation = Readonly<{
  valid: boolean;
  issues: readonly TCanvasContractIssue[];
}>;
