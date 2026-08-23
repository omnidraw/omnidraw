import type {
  TCanvasItemPage,
  TCanvasItemQuery,
  TCanvasItemSnapshot,
  TCanvasSceneNode,
  TRect,
  TWidgetFrameNode,
} from '@omnidraw/canvas-contract';
import type { TReproductionTraceSink } from './debug-trace/typed';
import type {
  TCanvasOverlayOwnership,
  TCanvasShellState,
} from './fn.canvas-shell';
import type { TCanvasNotificationPort } from './types';

export type TCanvasShellProjectionPort = Readonly<{
  state(): TCanvasShellState;
  owns(ownership: TCanvasOverlayOwnership): boolean;
  subscribe(listener: (state: TCanvasShellState) => void): () => void;
  registerOverlay(contribution: TCanvasOverlayContribution): () => void;
}>;

/** An extension mounts only while its declared Canvas shell owns the surface. */
export type TCanvasOverlayContribution = Readonly<{
  ownership: TCanvasOverlayOwnership;
  setMounted(mounted: boolean): void;
}>;

export type TCanvasExtensionInsertionNode = TCanvasSceneNode extends infer TNode
  ? TNode extends TCanvasSceneNode
    ? Omit<TNode, 'orderKey'>
    : never
  : never;

export type TCanvasExtensionSceneCommand =
  | Readonly<{ type: 'upsert'; node: TCanvasSceneNode }>
  | Readonly<{
      type: 'remove';
      nodeId: string;
      descendants?: 'remove' | 'reparent';
    }>
  | Readonly<{
      type: 'reparent';
      nodeId: string;
      parentId: string | null;
      orderKey?: string;
    }>
  | Readonly<{ type: 'reorder'; nodeId: string; orderKey: string }>;

/**
 * Narrow authored-document facade for optional Canvas extensions. Renderer
 * stores, editor sessions, portals, and authority implementations stay private.
 */
export type TCanvasExtensionDocumentPort = Readonly<{
  item(itemId: string): TCanvasItemSnapshot | null;
  items(): readonly TCanvasItemSnapshot[];
  node(nodeId: string): Readonly<TCanvasSceneNode> | null;
  nodes(): readonly Readonly<TCanvasSceneNode>[];
  childrenOf(parentId: string | null): readonly Readonly<TCanvasSceneNode>[];
  query(query: TCanvasItemQuery): Promise<TCanvasItemPage>;
  commit(mutation: Readonly<{
    source: string;
    coalesceKey?: string;
    /** Host-synchronized document chrome can persist without changing user undo history. */
    history?: 'record' | 'ignore';
    commands: readonly TCanvasExtensionSceneCommand[];
  }>): void;
  /** Inserts one unordered new node after every current sibling, rebalancing atomically when needed. */
  insertAtFront(insertion: Readonly<{
    source: string;
    node: TCanvasExtensionInsertionNode;
  }>): void;
  setSelection(
    nodeIds: readonly string[],
    options?: Readonly<{ focusedNodeId?: string | null }>,
  ): void;
  subscribe(listener: () => void): () => void;
}>;

export type TCanvasExtensionConfig = Readonly<{
  canvasId: string;
  container: HTMLDivElement;
  notification: TCanvasNotificationPort;
}>;

export type TCanvasExternalPlacementPoint = Readonly<{
  x: number;
  y: number;
}>;

export type TCanvasExternalPlacementBounds = Readonly<{
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}>;

/** One renderer-owned, non-durable widget outline used during external drag. */
export type TCanvasExternalWidgetPreview = Readonly<{
  update(worldBounds: TRect): void;
  clear(): void;
  dispose(): void;
}>;

/**
 * Renderer-neutral camera and preview seam for controls outside the Canvas.
 * Gesture thresholds, clamping, commit policy, and pointer capture stay with
 * the host; Canvas alone owns camera projection and transient rendering.
 */
export type TCanvasExternalPlacementPort = Readonly<{
  containsClientPoint(point: TCanvasExternalPlacementPoint): boolean;
  clientToWorld(point: TCanvasExternalPlacementPoint): TCanvasExternalPlacementPoint;
  visibleWorldBounds(): TCanvasExternalPlacementBounds;
  viewportCenter(): TCanvasExternalPlacementPoint;
  createWidgetPreview(args: Readonly<{
    nodeId: string;
    title?: string;
  }>): TCanvasExternalWidgetPreview;
}>;

export type TCanvasWidgetTitlebarModel = Readonly<{
  title?: string;
  badge?: string;
  actions?: readonly Readonly<{
    id: string;
    label: string;
    icon?: string;
    disabled?: boolean;
  }>[];
}>;

export type TCanvasWidgetSchedulingState = Readonly<{
  /** Whether cold work may enter the host's bounded mount queue. */
  eligible: boolean;
  /** Authoritative Cangine portal visibility, distinct from forced eligibility. */
  visible: boolean;
  /** Viewport distance in CSS pixels, clamped to the portable runtime bound. */
  distance: number;
  /** Host-owned startup priority: unavailable 0 through maximized 4. */
  priority: 0 | 1 | 2 | 3 | 4;
  /** Fraction outside the viewport, clamped to 0..1. */
  occlusion: number;
}>;

export type TCanvasWidgetMountArgs = Readonly<{
  node: TWidgetFrameNode;
  container: HTMLElement;
  signal: AbortSignal;
  scheduling: Readonly<{
    current(): TCanvasWidgetSchedulingState;
    subscribe(listener: (state: TCanvasWidgetSchedulingState) => void): () => void;
  }>;
  setTitlebar?(model: TCanvasWidgetTitlebarModel): void;
  onNodeChange?(
    listener: (node: TWidgetFrameNode) => void,
  ): () => void;
}>;

export type TCanvasWidgetCleanup = () => void | Promise<void>;

export type TCanvasWidgetHostRegistration = Readonly<{
  id: string;
  match(node: Readonly<TWidgetFrameNode>): boolean;
  mount(
    args: TCanvasWidgetMountArgs,
  ): void | TCanvasWidgetCleanup | Promise<void | TCanvasWidgetCleanup>;
  onAction?(args: Readonly<{
    node: TWidgetFrameNode;
    actionId: string;
    signal: AbortSignal;
  }>): void | Promise<void>;
}>;

/** Renderer-neutral host for widget content and title-bar actions. */
export type TCanvasWidgetHostPort = Readonly<{
  register(registration: TCanvasWidgetHostRegistration): () => void;
}>;

export type TCanvasExtensionContext = Readonly<{
  config: TCanvasExtensionConfig;
  document: TCanvasExtensionDocumentPort;
  placement: TCanvasExternalPlacementPort;
  widgets: TCanvasWidgetHostPort;
  trace: TReproductionTraceSink | null;
  shell: TCanvasShellProjectionPort;
}>;

export type TCanvasWidgetCreationContext = Readonly<{
  kind: 'widget';
  nodeId: string;
  parentId: string | null;
  draft: Readonly<{
    worldBounds: TRect;
    belowThreshold: boolean;
  }>;
}>;

export type TCanvasExtensionInstall = Readonly<{
  dispose?(): void | Promise<void>;
}>;

/**
 * Lightweight metadata for an optional extension implementation. Hosts may
 * keep matching and frame construction in the critical graph while loading
 * the implementation only after an accepted matching frame exists.
 */
export type TCanvasExtensionLoader = Readonly<{
  name: string;
  match(node: Readonly<TCanvasSceneNode>): boolean;
  loadingLabel: string;
  failureLabel: string;
  /** Return to the select tool after this descriptor creates a widget. */
  oneShotWidgetCreation?: boolean;
  createWidgetNodes?(
    context: TCanvasWidgetCreationContext,
  ): readonly TCanvasSceneNode[] | null;
  load(signal: AbortSignal): Promise<ICanvasExtension>;
}>;

/** Effect-free, renderer-neutral optional Canvas integration seam. */
export interface ICanvasExtension {
  readonly name: string;
  /** Return to the select tool after this extension creates a widget. */
  oneShotWidgetCreation?: boolean;
  createWidgetNodes?(
    context: TCanvasWidgetCreationContext,
  ): readonly TCanvasSceneNode[] | null;
  install(
    context: TCanvasExtensionContext,
  ): TCanvasExtensionInstall | Promise<TCanvasExtensionInstall>;
}
