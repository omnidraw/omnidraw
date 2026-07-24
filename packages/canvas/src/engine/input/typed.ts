import type {
  IInputController,
  TClickInputEvent,
  TClickRecognizerOptions,
  TAabb,
  THitResult,
  THitTestOptions,
  TInputDisposition,
  TKeyInputEvent,
  TPointerInputEvent,
  TVec2,
  TWheelInputEvent,
} from "@omnidraw/cangine";
import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type {
  TCanvasModifierState,
  TCanvasPoint,
  TCanvasSemanticHit,
  TCanvasTarget,
} from "../../semantic/typed";
import type { TCanvasProjectionIndex } from "../typed";

export type TCanvasSemanticHitPolicy = {
  lockedTargets?: "exclude" | "include";
};

export type TCanvasTransientTargetQuery = {
  ownerId: string;
  nodeId: string;
  handleId: string;
  path: readonly string[];
};

export type TCanvasTransientTargetResolver = (
  query: TCanvasTransientTargetQuery,
) => TCanvasTarget | null;

export type TCanvasResolveSemanticHitArgs = {
  hit: THitResult | null;
  viewport: TCanvasPoint;
  index: TCanvasProjectionIndex;
  document: TCanvasDoc;
  policy?: TCanvasSemanticHitPolicy;
  resolveTransientTarget?: TCanvasTransientTargetResolver;
};

type TCanvasInputEventBase = {
  timeStamp: number;
  modifiers: TCanvasModifierState;
};

export type TCanvasInputPointerEvent = TCanvasInputEventBase & {
  type: TPointerInputEvent["type"];
  pointerId: number;
  button: number;
  buttons: number;
  pointerType: TPointerInputEvent["pointerType"];
  client: TCanvasPoint;
  viewport: TCanvasPoint;
  world: TCanvasPoint;
  pressure: number;
  tilt: TCanvasPoint;
  deltaViewport: TCanvasPoint;
  deltaWorld: TCanvasPoint;
  hit: TCanvasSemanticHit | null;
};

export type TCanvasInputWheelEvent = TCanvasInputEventBase & {
  type: "wheel";
  client: TCanvasPoint;
  viewport: TCanvasPoint;
  world: TCanvasPoint;
  delta: TCanvasPoint;
  deltaMode: TWheelInputEvent["deltaMode"];
  hit: TCanvasSemanticHit | null;
};

export type TCanvasInputClickEvent = TCanvasInputEventBase & {
  type: TClickInputEvent["type"];
  pointerId: number;
  button: number;
  pointerType: TClickInputEvent["pointerType"];
  client: TCanvasPoint;
  viewport: TCanvasPoint;
  world: TCanvasPoint;
  hit: TCanvasSemanticHit | null;
};

export type TCanvasInputKeyEvent = TCanvasInputEventBase & {
  type: TKeyInputEvent["type"];
  key: string;
  code: string;
  repeat: boolean;
  composing: boolean;
};

export type TCanvasInputEvent =
  | TCanvasInputPointerEvent
  | TCanvasInputWheelEvent
  | TCanvasInputKeyEvent;

export type TCanvasInputListener = (
  event: TCanvasInputEvent,
) => TInputDisposition | void;

export type TCanvasInputClickListener = (
  event: TCanvasInputClickEvent,
) => void;

export type TCanvasInputAdapterConfig = {
  input: IInputController;
  clickRecognizer?: TClickRecognizerOptions;
  getProjectionIndex(): TCanvasProjectionIndex | null;
  getDocument(): TCanvasDoc;
  worldToViewport(point: TVec2): TVec2;
  policy?: TCanvasSemanticHitPolicy;
  resolveTransientTarget?: TCanvasTransientTargetResolver;
  onError?(
    error: unknown,
    diagnostic: TCanvasInputDiagnostic,
  ): void;
};

export type TCanvasInputDiagnostic =
  | {
      operation: "listener";
    }
  | {
      operation: "click-listener";
    }
  | {
      operation: "release-pointer";
      pointerId: number;
      owner: string;
    }
  | {
      operation: "blur";
    }
  | {
      operation: "unsubscribe";
    };

export type TCanvasSemanticHitQuery = {
  point: TVec2;
  options?: THitTestOptions;
  policy?: TCanvasSemanticHitPolicy;
};

export type TCanvasSemanticRectQuery = {
  rect: TAabb;
  options?: THitTestOptions;
  policy?: TCanvasSemanticHitPolicy;
};

export type TCanvasNormalizePointerEventArgs = {
  event: TPointerInputEvent;
  hit: TCanvasSemanticHit | null;
};

export type TCanvasNormalizeClickEventArgs = {
  event: TClickInputEvent;
  hit: TCanvasSemanticHit | null;
};

export type TCanvasNormalizeWheelEventArgs = {
  event: TWheelInputEvent;
  hit: TCanvasSemanticHit | null;
};

export type TCanvasNormalizeKeyEventArgs = {
  event: TKeyInputEvent;
};

export type TCanvasResolveSemanticHitsArgs = {
  hits: readonly THitResult[];
  index: TCanvasProjectionIndex;
  document: TCanvasDoc;
  worldToViewport(point: TVec2): TVec2;
  policy?: TCanvasSemanticHitPolicy;
  resolveTransientTarget?: TCanvasTransientTargetResolver;
};

export type TCanvasTransientTargetRegistration =
  | TCanvasTarget
  | TCanvasTransientTargetResolver;
