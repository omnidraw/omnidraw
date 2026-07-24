import type {
  TElement,
  TGroup,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TCrdtChangeSummary } from "../crdt/CrdtService";

export type TCanvasActiveSessionKind =
  | "transform"
  | "text-edit"
  | "line-point-edit"
  | "clone-drag"
  | "widget-drop";

export type TCanvasElementDependencyField = keyof TElement | "*";
export type TCanvasGroupDependencyField = keyof TGroup | "*";

export type TCanvasActiveSessionDependencies = {
  elements: Readonly<Record<string, readonly TCanvasElementDependencyField[]>>;
  groups: Readonly<Record<string, readonly TCanvasGroupDependencyField[]>>;
};

export type TCanvasActiveSessionCancelReason =
  | "destroy"
  | "disposed"
  | "replaced"
  | "remote-full-reload"
  | "remote-element-added"
  | "remote-element-deleted"
  | "remote-element-fields-changed"
  | "remote-element-reparented"
  | "remote-group-added"
  | "remote-group-deleted"
  | "remote-group-fields-changed"
  | "remote-group-reparented";

export type TCanvasActiveSessionCancelEvent = {
  sessionId: string;
  reason: TCanvasActiveSessionCancelReason;
  summary: TCrdtChangeSummary | null;
};

export type TCanvasActiveSession = {
  id: string;
  kind: TCanvasActiveSessionKind;
  startedAtRevision: number;
  dependencies: TCanvasActiveSessionDependencies;
  cancel(event: TCanvasActiveSessionCancelEvent): void;
  rebase?(summary: TCrdtChangeSummary): boolean;
};

export type TCanvasActiveSessionDecision =
  | {
      action: "continue";
      sessionId: string;
      summaryRevision: number;
    }
  | {
      action: "rebase";
      sessionId: string;
      summaryRevision: number;
      reason:
        | "remote-element-fields-changed"
        | "remote-group-fields-changed";
    }
  | {
      action: "cancel";
      sessionId: string;
      summaryRevision: number;
      reason: TCanvasActiveSessionCancelReason;
    };
