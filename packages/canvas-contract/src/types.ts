/** JSON values accepted by every serialized Canvas contract boundary. */
export type TJsonPrimitive = string | number | boolean | null;
export type TJsonValue = TJsonPrimitive | TJsonValue[] | TJsonObject;
export type TJsonObject = { [key: string]: TJsonValue };

export type TCanvasItemId = string;
export type TCanvasResourceId = string;
export type TCanvasRevision = number;
export type TCanvasItemRevision = number;
export type TCanvasJsonPath = readonly (string | number)[];

export interface TVec2 {
  x: number;
  y: number;
}

export interface TSize2 {
  width: number;
  height: number;
}

export interface TInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface TRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TColor =
  | { space: "srgb"; r: number; g: number; b: number; a: number }
  | { space: "display-p3"; r: number; g: number; b: number; a: number };

export interface TTransform2D {
  position: TVec2;
  rotation: number;
  scale: TVec2;
  skew: TVec2;
  origin: TVec2;
}

export type TVisibility = "visible" | "hidden" | "inherited";
export type TPointerEvents = "auto" | "none" | "bounds-only" | "painted";
export type TBlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "difference"
  | "exclusion";

export interface TAccessibilityNode {
  role?: string;
  label?: string;
  description?: string;
  tabIndex?: number;
  hidden?: boolean;
}

export interface TCornerRadius {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

export type TPathCommand =
  | { type: "M"; to: TVec2 }
  | { type: "L"; to: TVec2 }
  | { type: "Q"; control: TVec2; to: TVec2 }
  | { type: "C"; control1: TVec2; control2: TVec2; to: TVec2 }
  | {
      type: "A";
      radius: TVec2;
      xAxisRotation: number;
      largeArc: boolean;
      sweep: boolean;
      to: TVec2;
    }
  | { type: "Z" };

export interface TPathData {
  commands: TPathCommand[];
  fillRule?: "nonzero" | "evenodd";
}

export type TClipDefinition =
  | { type: "rect"; rect: TRect; radius?: TCornerRadius }
  | { type: "path"; path: TPathData }
  | { type: "node"; nodeId: TCanvasItemId };

export type TEffect =
  | {
      type: "shadow";
      color: TColor;
      offset: TVec2;
      blur: number;
      spread?: number;
      inset?: boolean;
    }
  | { type: "blur"; radius: number }
  | { type: "color-matrix"; matrix: readonly number[] };

export interface TSolidPaint {
  type: "solid";
  color: TColor;
}

export interface TGradientStop {
  offset: number;
  color: TColor;
}

export interface TLinearGradientPaint {
  type: "linear-gradient";
  from: TVec2;
  to: TVec2;
  stops: TGradientStop[];
  space?: "local" | "world";
}

export interface TRadialGradientPaint {
  type: "radial-gradient";
  center: TVec2;
  radius: number;
  focalPoint?: TVec2;
  stops: TGradientStop[];
  space?: "local" | "world";
}

export interface TImagePatternPaint {
  type: "image-pattern";
  resourceId: TCanvasResourceId;
  transform?: TTransform2D;
  repeat?: "repeat" | "repeat-x" | "repeat-y" | "no-repeat";
}

export type TPaint =
  | TSolidPaint
  | TLinearGradientPaint
  | TRadialGradientPaint
  | TImagePatternPaint;

export interface TStrokeStyle {
  paint: TPaint;
  width: number;
  alignment?: "center" | "inside" | "outside";
  cap?: "butt" | "round" | "square";
  join?: "miter" | "round" | "bevel";
  miterLimit?: number;
  dash?: number[];
  dashOffset?: number;
}

/** Fields shared by every authored Canvas node. */
export interface TCanvasNodeBase {
  id: TCanvasItemId;
  parentId: TCanvasItemId | null;
  orderKey: string;
  transform: TTransform2D;
  visibility?: TVisibility;
  opacity?: number;
  blendMode?: TBlendMode;
  pointerEvents?: TPointerEvents;
  clip?: TClipDefinition;
  effects?: TEffect[];
  accessibility?: TAccessibilityNode;
  metadata?: TJsonObject;
  extensions?: Record<string, TJsonValue>;
}

export type TGroupLayout =
  | { type: "free" }
  | {
      type: "stack";
      axis: "horizontal" | "vertical";
      gap: number;
      padding: TInsets;
      align: "start" | "center" | "end" | "stretch";
    };

export interface TGroupNode extends TCanvasNodeBase {
  kind: "group";
  layout?: TGroupLayout;
  isolateBlend?: boolean;
}

export interface TRectNode extends TCanvasNodeBase {
  kind: "rect";
  size: TSize2;
  radius?: number | TCornerRadius;
  fill?: TPaint;
  stroke?: TStrokeStyle;
}

export interface TEllipseNode extends TCanvasNodeBase {
  kind: "ellipse";
  size: TSize2;
  fill?: TPaint;
  stroke?: TStrokeStyle;
}

export interface TPolygonNode extends TCanvasNodeBase {
  kind: "polygon";
  points: TVec2[];
  closed: boolean;
  fill?: TPaint;
  stroke?: TStrokeStyle;
  fillRule?: "nonzero" | "evenodd";
}

export interface TPathNode extends TCanvasNodeBase {
  kind: "path";
  path: TPathData;
  fill?: TPaint;
  stroke?: TStrokeStyle;
}

export interface TImageNode extends TCanvasNodeBase {
  kind: "image";
  resourceId: TCanvasResourceId;
  size: TSize2;
  fit?: "fill" | "contain" | "cover" | "none" | "scale-down";
  position?: TVec2;
  smoothing?: "auto" | "pixelated";
  crop?: TRect;
  tint?: TColor;
}

export type TNamedAnchor =
  | "auto"
  | "center"
  | "top"
  | "right"
  | "bottom"
  | "left"
  | "top-left"
  | "top-right"
  | "bottom-right"
  | "bottom-left";

export type TConnectorEndpoint =
  | { type: "point"; point: TVec2 }
  | {
      type: "node";
      nodeId: TCanvasItemId;
      anchor: TNamedAnchor | { name: string };
      /** Stable target-local normalized attachment point. */
      attachment?: {
        mode: "inside" | "orbit";
        fixedPoint: TVec2;
      };
      offset?: TVec2;
      gap?: number;
    };

export type TConnectorRouting =
  | { type: "straight" }
  | {
      type: "orthogonal";
      cornerRadius?: number;
      preferredAxis?: "horizontal" | "vertical";
      obstaclePadding?: number;
    }
  | { type: "quadratic"; control?: TVec2 }
  | { type: "bezier"; control1?: TVec2; control2?: TVec2 }
  | { type: "manual"; path: TPathData };

export interface TConnectorMarker {
  shape: "none" | "arrow" | "triangle" | "circle" | "diamond" | "bar";
  size: number;
  filled?: boolean;
}

export interface TConnectorFixedSegment {
  id: string;
  start: TVec2;
  end: TVec2;
}

export interface TConnectorNode extends TCanvasNodeBase {
  kind: "connector";
  from: TConnectorEndpoint;
  to: TConnectorEndpoint;
  routing: TConnectorRouting;
  waypoints?: TVec2[];
  /** Connector-local axis-aligned segments pinned by elbow editing. */
  fixedSegments?: TConnectorFixedSegment[];
  stroke: TStrokeStyle;
  startMarker?: TConnectorMarker;
  endMarker?: TConnectorMarker;
  avoidNodeIds?: TCanvasItemId[];
  labelNodeId?: TCanvasItemId;
}

export type TWidgetHeaderContent =
  | { type: "text"; text: string }
  | { type: "icon"; resourceId: TCanvasResourceId };

export interface TWidgetDropdownItem {
  id: string;
  text: string;
  disabled?: boolean;
}

export type TWidgetHeaderItem =
  | {
      type: "button";
      id: string;
      label: string;
      content: TWidgetHeaderContent;
      disabled?: boolean;
    }
  | {
      type: "dropdown";
      id: string;
      label: string;
      content: TWidgetHeaderContent;
      items: TWidgetDropdownItem[];
      disabled?: boolean;
    };

export interface TWidgetFrameNode extends TCanvasNodeBase {
  kind: "widget-frame";
  size: TSize2;
  title?: string;
  titleBarColor?: TColor;
  headerItems?: TWidgetHeaderItem[];
  collapsed?: boolean;
  resizable?: boolean;
  minSize?: TSize2;
  maxSize?: TSize2;
}

export interface TTextStyle {
  fontFamilies: string[];
  fontSize: number;
  fontWeight?: number;
  fontStyle?: "normal" | "italic" | "oblique";
  fontStretch?: number;
  letterSpacing?: number;
  wordSpacing?: number;
  lineHeight?: number;
  fill: TPaint;
  stroke?: TStrokeStyle;
  decoration?: "none" | "underline" | "line-through" | "overline";
  language?: string;
  features?: Record<string, boolean | number>;
}

export interface TTextRun {
  text: string;
  style?: Partial<TTextStyle>;
  metadata?: TJsonObject;
}

export type TTextLayoutMode =
  | { type: "auto-width"; maxWidth?: number }
  | { type: "auto-height"; width: number }
  | {
      type: "fixed";
      size: TSize2;
      overflow?: "clip" | "ellipsis" | "visible";
    };

export interface TTextNode extends TCanvasNodeBase {
  kind: "text";
  runs: TTextRun[];
  style: TTextStyle;
  layout: TTextLayoutMode;
  align?: "left" | "center" | "right" | "justify";
  verticalAlign?: "top" | "middle" | "bottom";
  direction?: "auto" | "ltr" | "rtl";
  wrap?: "word" | "character" | "none";
  selectable?: boolean;
}

/**
 * Complete durable authored-node union. Runtime layers, backgrounds, portals,
 * and renderer-owned 3D view references are intentionally not serializable.
 */
export type TCanvasSceneNode =
  | TGroupNode
  | TRectNode
  | TEllipseNode
  | TPolygonNode
  | TPathNode
  | TImageNode
  | TConnectorNode
  | TWidgetFrameNode
  | TTextNode;

/** Renderer adapters may use this structural alias without owning the model. */
export type TSceneNode = TCanvasSceneNode;
export type TCanvasAuthoredNodeKind = TCanvasSceneNode["kind"];

export type TCanvasFillColorCode =
  | "transparent"
  | "neutral"
  | "red"
  | "yellow"
  | "green"
  | "blue";
export type TCanvasInkColorCode = Exclude<TCanvasFillColorCode, "transparent">;

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
      type: "widget-instance" | "widget-preview";
      instanceId: string;
      widgetKey: string;
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

export type TCanvasSemanticStyleExtensionV1 = Readonly<{
  schemaVersion: 1;
  background?: TCanvasFillColorCode;
  ink?: TCanvasInkColorCode;
}>;

/** Minimal metadata needed to address a document. */
export type TCanvasDescriptor = Readonly<{ id: string }>;

export type TCanvasItemSnapshot = Readonly<{
  id: TCanvasItemId;
  item: TCanvasSceneNode;
  itemRevision: TCanvasItemRevision;
  createdAtSec: string;
  updatedAtSec: string;
}>;

/** The versioned serialized boundary for one complete Canvas document. */
export type TCanvasDocument = Readonly<{
  schemaVersion: "1.0.0";
  canvasId: string;
  revision: TCanvasRevision;
  items: readonly TCanvasItemSnapshot[];
}>;

export type TCanvasSnapshot = TCanvasDocument;

export type TCanvasItemPatch =
  | Readonly<{ type: "set"; path: TCanvasJsonPath; value: TJsonValue }>
  | Readonly<{ type: "remove"; path: TCanvasJsonPath }>;

export type TCanvasOperation =
  | Readonly<{ type: "insert"; item: TCanvasSceneNode }>
  | Readonly<{
      type: "patch";
      itemId: TCanvasItemId;
      patches: readonly TCanvasItemPatch[];
    }>
  | Readonly<{ type: "replace"; item: TCanvasSceneNode }>
  | Readonly<{ type: "delete"; itemId: TCanvasItemId }>
  | Readonly<{
      type: "reparent";
      itemId: TCanvasItemId;
      parentId: TCanvasItemId | null;
      orderKey?: string;
    }>
  | Readonly<{ type: "reorder"; itemId: TCanvasItemId; orderKey: string }>;

export type TCanvasPrecondition =
  | Readonly<{ type: "item-absent"; itemId: TCanvasItemId }>
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

export type TCanvasItemQueryFilter =
  | Readonly<{ type: "all" }>
  | Readonly<{ type: "ids"; ids: readonly TCanvasItemId[] }>
  | Readonly<{ type: "kind"; kind: TCanvasAuthoredNodeKind }>
  | Readonly<{ type: "parent"; parentId: TCanvasItemId | null }>
  | Readonly<{ type: "widget-instance"; instanceId: string }>
  | Readonly<{ type: "widget-key"; widgetKey: string }>;

export type TCanvasItemQueryCursor =
  | Readonly<{ type: "id"; id: TCanvasItemId }>
  | Readonly<{ type: "parent-order"; orderKey: string; id: TCanvasItemId }>
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

/**
 * Protocol-neutral access to one authoritative Canvas document.
 * Subscription iterators must settle a pending `next()` promptly on return.
 */
export type TCanvasDocumentTransport = Readonly<{
  getSnapshot(args: Readonly<{ canvasId: string }>): Promise<TCanvasSnapshot>;
  query(query: TCanvasItemQuery): Promise<TCanvasItemPage>;
  execute(command: TCanvasCommand): Promise<TCanvasItemsChangedEvent>;
  subscribe(args: Readonly<{
    canvasId: string;
    afterRevision: number;
  }>): AsyncIterable<TCanvasEvent>;
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

export type TCanvasContractSchema<A> = Readonly<{
  is(value: unknown): value is A;
  validate(value: unknown): TCanvasContractValidation;
  parse(value: unknown): A;
}>;

export type TCanvasContractCodec<A> = Readonly<{
  decode(value: unknown): A;
  parse(text: string): A;
  encode(value: A): TJsonValue;
  stringify(value: A): string;
}>;
