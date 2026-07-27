import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type {
  TCanvasInputPointerEvent,
  TCanvasTransientTargetResolver,
} from "../input/typed";
import type { TCanvasProjectionIndex } from "../typed";
import type {
  TCanvasModifierState,
  TCanvasSemanticHit,
  TCanvasTarget,
} from "../../semantic/typed";

export type TCanvasProductPoint = {
  x: number;
  y: number;
};

export type TCanvasProductSize = {
  width: number;
  height: number;
};

export type TCanvasProductRect = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type TCanvasProductTransform = {
  position: TCanvasProductPoint;
  rotationRadians: number;
  scale: TCanvasProductPoint;
  skew: TCanvasProductPoint;
  origin: TCanvasProductPoint;
};

export type TCanvasProductNodeRole = "root" | "render" | "inline-text";

export type TCanvasProductTargetRef = {
  target: TCanvasTarget;
  role?: TCanvasProductNodeRole;
};

export type TCanvasProductColor = {
  r: number;
  g: number;
  b: number;
  a: number;
};

export type TCanvasProductStroke = {
  color: TCanvasProductColor;
  width: number;
  dash?: readonly number[];
};

export type TCanvasProductTransformHandle =
  | "move"
  | "rotate"
  | "resize-n"
  | "resize-ne"
  | "resize-e"
  | "resize-se"
  | "resize-s"
  | "resize-sw"
  | "resize-w"
  | "resize-nw";

export type TCanvasProductTransformPolicy = {
  handles: readonly TCanvasProductTransformHandle[];
  aspectRatioMode?: "free" | "locked" | "shift-lock" | "shift-invert";
  allowFlip?: boolean;
  allowRotate?: boolean;
  minSize?: TCanvasProductSize;
  maxSize?: TCanvasProductSize;
  snapRotationRadians?: number;
};

export type TCanvasProductTransformHoverState = Readonly<{
  pointerId: number;
  pointerType: string;
  handle: TCanvasProductTransformHandle;
  cursor:
    | "grab"
    | "grabbing"
    | "move"
    | "ns-resize"
    | "nesw-resize"
    | "ew-resize"
    | "nwse-resize";
}>;

export type TCanvasProductSelectionAppearance = {
  outline: TCanvasProductStroke;
  handleFill: TCanvasProductColor;
  handleStroke: TCanvasProductStroke;
  handleSize: number;
  rotateHandleOffset: number;
  outlinePadding?: number;
};

export type TCanvasProductSelection = {
  targets: readonly TCanvasTarget[];
  focused?: TCanvasTarget;
  appearance: TCanvasProductSelectionAppearance;
  policy: TCanvasProductTransformPolicy;
};

export type TCanvasProductTransformProposal = {
  target: TCanvasTarget;
  previousTransform: TCanvasProductTransform;
  nextTransform: TCanvasProductTransform;
  previousSize?: TCanvasProductSize;
  nextSize?: TCanvasProductSize;
};

export type TCanvasProductCloneIdentity = {
  elements: readonly {
    sourceId: string;
    cloneId: string;
  }[];
  groups: readonly {
    sourceId: string;
    cloneId: string;
  }[];
  selection: readonly TCanvasTarget[];
};

export type TCanvasProductClonePlanProvider = {
  prepare(args: {
    gestureId: string;
    targets: readonly TCanvasTarget[];
  }): TCanvasProductCloneIdentity | null;
  discard(args: {
    gestureId: string;
    reason: string;
  }): void;
};

export type TCanvasDurableHandoffState =
  | "pending"
  | "completed"
  | "failed"
  | "cancelled";

export type TCanvasDurableHandoff = {
  readonly id: string;
  readonly state: TCanvasDurableHandoffState;
  retain(): void;
  waitFor(operation: PromiseLike<unknown>): void;
  complete(): void;
  fail(error?: unknown): void;
  cancel(reason?: string): void;
};

export type TCanvasProductTransformEvent =
  | {
      type: "transform-begin" | "transform-update" | "transform-cancel";
      gestureId: string;
      handle: TCanvasProductTransformHandle;
      pointerId: number;
      proposals: readonly TCanvasProductTransformProposal[];
      worldPointer: TCanvasProductPoint;
      modifiers: TCanvasModifierState;
      clone?: TCanvasProductCloneIdentity;
    }
  | {
      type: "transform-commit";
      gestureId: string;
      handle: TCanvasProductTransformHandle;
      pointerId: number;
      proposals: readonly TCanvasProductTransformProposal[];
      worldPointer: TCanvasProductPoint;
      modifiers: TCanvasModifierState;
      clone?: TCanvasProductCloneIdentity;
      handoff: TCanvasDurableHandoff;
    };

export type TCanvasProductInteractionSample = {
  pointerId: number;
  pointerType: string;
  world: TCanvasProductPoint;
  viewport: TCanvasProductPoint;
  client: TCanvasProductPoint;
  pressure: number;
  tilt: TCanvasProductPoint;
  timeStamp: number;
  modifiers: TCanvasModifierState;
};

export type TCanvasProductDragDraft = {
  kind: "marquee" | "create" | "connector";
  phase: "begin" | "update" | "commit";
  start: TCanvasProductInteractionSample;
  current: TCanvasProductInteractionSample;
  worldBounds: TCanvasProductRect;
  viewportBounds: TCanvasProductRect;
  distanceViewport: number;
};

export type TCanvasProductInteractionCancel = {
  kind: "marquee" | "create" | "stroke" | "connector";
  pointerId: number;
  reason:
    | "pointer-cancel"
    | "explicit"
    | "replaced"
    | "destroy"
    | "sample-limit"
    | "query-failure"
    | "remote-change";
};

export type TCanvasProductMarqueeCommit = TCanvasProductDragDraft & {
  kind: "marquee";
  phase: "commit";
  hits: readonly TCanvasSemanticHit[];
  belowThreshold: boolean;
};

export type TCanvasProductCreationCommit = TCanvasProductDragDraft & {
  kind: "create";
  phase: "commit";
  belowThreshold: boolean;
};

export type TCanvasProductStrokeEvent = {
  kind: "stroke";
  phase: "begin" | "update" | "commit";
  samples: readonly TCanvasProductInteractionSample[];
  added: readonly TCanvasProductInteractionSample[];
  sampleCount: number;
};

export type TCanvasProductPathCommand =
  | { type: "M" | "L"; to: TCanvasProductPoint }
  | { type: "Q"; control: TCanvasProductPoint; to: TCanvasProductPoint }
  | {
      type: "C";
      control1: TCanvasProductPoint;
      control2: TCanvasProductPoint;
      to: TCanvasProductPoint;
    }
  | {
      type: "A";
      radius: TCanvasProductPoint;
      xAxisRotationRadians: number;
      largeArc: boolean;
      sweep: boolean;
      to: TCanvasProductPoint;
    }
  | { type: "Z" };

export type TCanvasProductResolvedConnector = {
  from: TCanvasProductPoint;
  to: TCanvasProductPoint;
  pathStart: TCanvasProductPoint;
  pathEnd: TCanvasProductPoint;
  path: readonly TCanvasProductPathCommand[];
  bounds: TCanvasProductRect;
  startTangent: TCanvasProductPoint;
  endTangent: TCanvasProductPoint;
};

export type TCanvasProductConnectorDraft = TCanvasProductDragDraft & {
  kind: "connector";
  candidate: TCanvasSemanticHit | null;
  route: TCanvasProductResolvedConnector | null;
};

export type TCanvasProductDragCallbacks<TCommit> = {
  thresholdViewport?: number;
  constrainDraft?(draft: TCanvasProductDragDraft): {
    worldBounds?: TCanvasProductRect;
    viewportBounds?: TCanvasProductRect;
  };
  onBegin?(draft: TCanvasProductDragDraft): void;
  onUpdate?(draft: TCanvasProductDragDraft): void;
  onCommit(event: TCommit): void;
  onCancel?(event: TCanvasProductInteractionCancel): void;
};

export type TCanvasProductMarqueeOptions =
  TCanvasProductDragCallbacks<TCanvasProductMarqueeCommit>;

export type TCanvasProductCreationOptions =
  TCanvasProductDragCallbacks<TCanvasProductCreationCommit>;

export type TCanvasProductStrokeOptions = {
  minDistanceViewport?: number;
  maxSamples?: number;
  onBegin?(event: TCanvasProductStrokeEvent): void;
  onUpdate?(event: TCanvasProductStrokeEvent): void;
  onCommit(event: TCanvasProductStrokeEvent): void;
  onCancel?(event: TCanvasProductInteractionCancel): void;
};

export type TCanvasProductConnectorOptions = Omit<
  TCanvasProductDragCallbacks<TCanvasProductConnectorDraft & {
    phase: "commit";
    belowThreshold: boolean;
  }>,
  "onUpdate"
> & {
  source?: TCanvasTarget;
  acceptCandidate?(hit: TCanvasSemanticHit): boolean;
  preview?: {
    stroke?: TCanvasProductStroke;
    routing?: "straight" | "orthogonal" | "quadratic" | "bezier";
  };
  onUpdate?(event: TCanvasProductConnectorDraft): void;
};

export type TCanvasProductTextProjection = {
  visible: boolean;
  clientMatrix: readonly [number, number, number, number, number, number];
  localSize: TCanvasProductSize;
};

export type TCanvasProductTextSessionOptions = {
  target: TCanvasTarget;
  role?: TCanvasProductNodeRole;
  element: HTMLElement;
  commitOnBlur?: boolean;
  selectOnFocus?: boolean;
  onProjection?(projection: TCanvasProductTextProjection): void;
  onCommit?(text: string): void;
  onCancel?(): void;
};

export type TCanvasProductTextSession = {
  readonly projection: TCanvasProductTextProjection | null;
  sync(): void;
  commit(): void;
  cancel(): void;
  destroy(): void;
};

type TCanvasProductTransientBase = {
  id: string;
  parentId: string | null;
  orderKey: string;
  transform?: Partial<TCanvasProductTransform>;
  opacity?: number;
  pointerEvents?: "auto" | "none" | "bounds-only" | "painted";
};

export type TCanvasProductTransientNode =
  | (TCanvasProductTransientBase & {
      kind: "group";
    })
  | (TCanvasProductTransientBase & {
      kind: "rect";
      size: TCanvasProductSize;
      fill?: TCanvasProductColor;
      stroke?: TCanvasProductStroke;
      radius?: number;
    })
  | (TCanvasProductTransientBase & {
      kind: "ellipse";
      size: TCanvasProductSize;
      fill?: TCanvasProductColor;
      stroke?: TCanvasProductStroke;
    })
  | (TCanvasProductTransientBase & {
      kind: "polygon";
      points: readonly TCanvasProductPoint[];
      closed: boolean;
      fill?: TCanvasProductColor;
      stroke?: TCanvasProductStroke;
    })
  | (TCanvasProductTransientBase & {
      kind: "path";
      path: readonly TCanvasProductPathCommand[];
      fill?: TCanvasProductColor;
      stroke?: TCanvasProductStroke;
    })
  | (TCanvasProductTransientBase & {
      kind: "widget-frame";
      size: TCanvasProductSize;
      title: string;
      collapsed?: boolean;
      resizable?: boolean;
    });

export type TCanvasProductTransientProjection = {
  band: "world-overlay" | "screen-overlay";
  hitTest?: "none" | "enabled";
  nodes: readonly TCanvasProductTransientNode[];
};

export type TCanvasProductTransientOwnerOptions = {
  ownerId: string;
  target?: TCanvasTarget;
  resolveTarget?: TCanvasTransientTargetResolver;
};

export type TCanvasProductTransientOwner = {
  readonly id: string;
  replace(projection: TCanvasProductTransientProjection): void;
  clear(): void;
  destroy(): void;
};

export type TCanvasProductRuntimeDiagnostic = {
  operation:
    | "handoff-create"
    | "handoff-failure"
    | "interaction-callback"
    | "transform-callback"
    | "teardown";
  error: unknown;
  gestureId?: string;
  ownerId?: string;
};

export type TCanvasProductRuntimeData = {
  getProjectionIndex(): TCanvasProjectionIndex | null;
  getDocument(): TCanvasDoc;
};

export type TCanvasProductPointerEvent = TCanvasInputPointerEvent;
