import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";

export type TModifiers = {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

export type TStep =
  | {
    type: "pointer";
    event: "pointerdown" | "pointerup" | "pointerout" | "pointerover" | "pointercancel";
    targetId: string | null;
    x: number;
    y: number;
    modifiers: TModifiers;
  }
  | {
    type: "pointermove";
    targetId: string | null;
    x: number;
    y: number;
    modifiers: TModifiers;
  }
  | {
    type: "drag";
    event: "dragstart" | "dragmove" | "dragend";
    targetId: string | null;
    x: number;
    y: number;
    modifiers: TModifiers;
  }
  | {
    type: "wheel";
    targetId: string | null;
    x: number;
    y: number;
    deltaX: number;
    deltaY: number;
    modifiers: TModifiers;
  }
  | {
    type: "key";
    event: "keydown" | "keyup";
    key: string;
    modifiers: TModifiers;
  };

export type TCrdtOp = {
  type: "ops";
  payload: Array<Record<string, unknown>>;
};

export type TRecording = {
  name: string;
  initialDoc: TCanvasDoc | null;
  reducedEvents: boolean;
  steps: TStep[];
  crdtOps: TCrdtOp[];
};
