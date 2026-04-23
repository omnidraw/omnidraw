import { throttle as THROTTLE } from "@solid-primitives/scheduled";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { CrdtService, HistoryService } from "../../services";
import { fxToPositionPatch } from "./fx.node";
import type { TShape1dNode } from "./CONSTANTS";
import type { TShape1dPluginState } from "./typed";

const SHAPE1D_MOVE_BEFORE_ELEMENT_ATTR = "vcShape1dMoveBeforeElement";

export type TPortalTxShape1dMove = {
  state: TShape1dPluginState;
  crdt: CrdtService;
  history: HistoryService;
  now: () => number;
  movePatchIntervalMs: number;
  transformMoveBeforeAttr: string;
  toElement: (node: TShape1dNode) => TElement;
  applyElement: (element: TElement) => void;
};

export type TArgsTxBeginShape1dMove = {
  node: TShape1dNode;
  beforeElement?: TElement | null;
};

export function txBeginShape1dMove(portal: TPortalTxShape1dMove, args: TArgsTxBeginShape1dMove) {
  const resolvedBeforeElement = args.beforeElement ? structuredClone(args.beforeElement) : structuredClone(portal.toElement(args.node));
  args.node.setAttr(SHAPE1D_MOVE_BEFORE_ELEMENT_ATTR, structuredClone(resolvedBeforeElement));
  portal.state.moveSessions.set(args.node.id(), {
    beforeElement: resolvedBeforeElement,
    throttledPatch: THROTTLE((patch) => {
      const builder = portal.crdt.build();
      builder.patchElement(patch.id, "x", patch.x);
      builder.patchElement(patch.id, "y", patch.y);
      builder.patchElement(patch.id, "parentGroupId", patch.parentGroupId);
      builder.patchElement(patch.id, "updatedAt", patch.updatedAt);
      builder.commit();
    }, portal.movePatchIntervalMs),
  });
}

export type TArgsTxEnsureShape1dMove = {
  node: TShape1dNode;
};

export function txEnsureShape1dMove(portal: TPortalTxShape1dMove, args: TArgsTxEnsureShape1dMove) {
  const existingSession = portal.state.moveSessions.get(args.node.id());
  if (existingSession) {
    return existingSession;
  }

  const beforeElement = args.node.getAttr(SHAPE1D_MOVE_BEFORE_ELEMENT_ATTR) as TElement | undefined;
  const transformBeforeElement = args.node.getAttr(portal.transformMoveBeforeAttr) as TElement | undefined;
  txBeginShape1dMove(portal, { node: args.node, beforeElement: beforeElement ?? transformBeforeElement ?? null });
  return portal.state.moveSessions.get(args.node.id()) ?? null;
}

export type TArgsTxPatchShape1dMove = {
  node: TShape1dNode;
};

export function txPatchShape1dMove(portal: TPortalTxShape1dMove, args: TArgsTxPatchShape1dMove) {
  const session = txEnsureShape1dMove(portal, { node: args.node });
  if (!session) {
    return false;
  }

  session.throttledPatch(fxToPositionPatch({ now: portal.now }, { node: args.node }));
  return true;
}

export type TArgsTxFinalizeShape1dMove = {
  node: TShape1dNode;
};

export function txFinalizeShape1dMove(portal: TPortalTxShape1dMove, args: TArgsTxFinalizeShape1dMove) {
  const session = portal.state.moveSessions.get(args.node.id());
  portal.state.moveSessions.delete(args.node.id());
  args.node.setAttr(SHAPE1D_MOVE_BEFORE_ELEMENT_ATTR, undefined);
  if (!session) {
    return false;
  }

  const beforeElement = structuredClone(session.beforeElement);
  const afterElement = structuredClone(portal.toElement(args.node));
  const moveCommitResult = (() => {
    const builder = portal.crdt.build();
    builder.patchElement(afterElement.id, afterElement);
    return builder.commit();
  })();

  const didMove = beforeElement.x !== afterElement.x || beforeElement.y !== afterElement.y;
  if (!didMove) {
    return true;
  }

  portal.history.record({
    label: "drag-shape1d",
    undo: () => {
      portal.applyElement(beforeElement);
      moveCommitResult.rollback();
    },
    redo: () => {
      portal.applyElement(afterElement);
      portal.crdt.applyOps({ ops: moveCommitResult.redoOps });
    },
  });

  return true;
}
