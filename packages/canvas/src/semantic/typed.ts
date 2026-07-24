import type {
  TElement,
  TGroup,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";

export type TCanvasPoint = {
  x: number;
  y: number;
};

export type TCanvasTarget =
  | {
      kind: "element";
      id: string;
    }
  | {
      kind: "group";
      id: string;
    };

export type TCanvasModifierState = {
  alt: boolean;
  control: boolean;
  meta: boolean;
  shift: boolean;
};

export type TCanvasSemanticHitPart =
  | "body"
  | "frame"
  | "inline-text"
  | "connector-start"
  | "connector-end"
  | "connector-segment"
  | "resize-handle"
  | "rotate-handle"
  | "widget-minimize"
  | "widget-restore"
  | "widget-fullscreen"
  | "widget-content"
  | {
      kind: "custom";
      value: string;
    };

export type TCanvasSemanticHit = {
  target: TCanvasTarget;
  part: TCanvasSemanticHitPart;
  groupAncestry: readonly string[];
  world: TCanvasPoint;
  viewport: TCanvasPoint;
  transient?: {
    ownerId: string;
    handleId?: string;
  };
};

export type TCanvasPointerEventType =
  | "pointer-down"
  | "pointer-move"
  | "pointer-up"
  | "pointer-cancel"
  | "pointer-enter"
  | "pointer-leave";

export type TCanvasPointerEvent = {
  type: TCanvasPointerEventType;
  pointerId: number;
  button: number;
  buttons: number;
  pointerType: string;
  client: TCanvasPoint;
  viewport: TCanvasPoint;
  world: TCanvasPoint;
  pressure: number;
  modifiers: TCanvasModifierState;
  hit: TCanvasSemanticHit | null;
  nativeEvent: PointerEvent;
};

export type TCanvasWheelEvent = {
  type: "wheel";
  client: TCanvasPoint;
  viewport: TCanvasPoint;
  world: TCanvasPoint;
  delta: TCanvasPoint;
  deltaMode: number;
  modifiers: TCanvasModifierState;
  hit: TCanvasSemanticHit | null;
  nativeEvent: WheelEvent;
};

export type TCanvasTransformProposal = {
  target: TCanvasTarget;
  position?: TCanvasPoint;
  rotationRadians?: number;
  scale?: TCanvasPoint;
  size?: {
    width: number;
    height: number;
  };
};

export type TCanvasElementTransformPatch = Pick<
  TElement,
  "x" | "y" | "rotation" | "scaleX" | "scaleY"
> & {
  width?: number;
  height?: number;
};

export type TCanvasGroupTransformPatch = {
  group: Pick<TGroup, "id">;
  descendantDelta: TCanvasPoint;
};

export type TCanvasSelectionMode = "replace" | "add" | "toggle" | "remove";
