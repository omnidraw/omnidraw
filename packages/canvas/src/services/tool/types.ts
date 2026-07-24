import type {
  TCanvasInputPointerEvent,
} from "../../engine/input/typed";
import type { TWidgetDropRequest } from "../widget-placement/types";

export type TToolMode = "select" | "hand" | "draw-create" | "click-create";
export type TToolShortcut = string;
export type TToolIcon = string;
export type TToolPointerEvent = TCanvasInputPointerEvent;

export type TToolCanvasPoint = {
  x: number;
  y: number;
  pressure: number;
};

export type TToolSessionCancelReason =
  | "escape"
  | "pointer-cancel"
  | "replaced"
  | "tool-change"
  | "unregister"
  | "destroy"
  | "commit-failed";

export type TToolSession = {
  id: string;
  update?(event: TToolPointerEvent): void;
  commit?(event: TToolPointerEvent): void | Promise<void>;
  cancel(reason: TToolSessionCancelReason): void | Promise<void>;
};

export type TToolDrawCreateStartDraftArgs = {
  event: TToolPointerEvent;
  point: TToolCanvasPoint;
};

export type TToolDrawCreateUpdateDraftArgs = {
  draft: unknown;
  event: TToolPointerEvent;
  point: TToolCanvasPoint;
  origin: TToolCanvasPoint;
  shiftKey: boolean;
  now: number;
};

export type TToolSessionFactory = (
  event: TToolPointerEvent,
) => TToolSession | null;

export type TTool = {
  id: string;
  label: string;
  tone?: "draft";
  icon?: TToolIcon;
  shortcuts?: TToolShortcut[];
  group?: string;
  priority?: number;
  active?: boolean;
  onSelect?: () => void;
  onActivate?(): void;
  onDeactivate?(): void;
  behavior:
    | { type: "mode"; mode: TToolMode }
    | { type: "action" }
    | { type: "modal" };
  createSession?: TToolSessionFactory;
  widgetPlacement?: TWidgetDropRequest;
};
