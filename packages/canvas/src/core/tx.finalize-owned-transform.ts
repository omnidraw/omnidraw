import type Konva from "konva";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { CrdtService } from "../services/crdt/CrdtService";
import type { HistoryService } from "../services/history/HistoryService";

type TPortalTxFinalizeOwnedTransform = {
  crdt: CrdtService;
  history: HistoryService;
  applyElement: (element: TElement) => void;
  serializeAfterElement: (node: Konva.Node, beforeElement: TElement | null) => TElement | null;
  isMeaningfulChange?: (beforeElement: TElement, afterElement: TElement) => boolean;
};

type TArgsTxFinalizeOwnedTransform = {
  node: Konva.Node;
  label: string;
  beforeAttr: string;
};

function didElementTransform(beforeElement: TElement, afterElement: TElement) {
  return beforeElement.x !== afterElement.x
    || beforeElement.y !== afterElement.y
    || beforeElement.rotation !== afterElement.rotation
    || JSON.stringify(beforeElement.data) !== JSON.stringify(afterElement.data)
    || JSON.stringify(beforeElement.style) !== JSON.stringify(afterElement.style);
}

export function txFinalizeOwnedTransform(portal: TPortalTxFinalizeOwnedTransform, args: TArgsTxFinalizeOwnedTransform) {
  const beforeElement = (args.node.getAttr(args.beforeAttr) as TElement | undefined) ?? null;
  const afterElement = portal.serializeAfterElement(args.node, beforeElement);
  if (!afterElement) {
    return false;
  }

  const builder = portal.crdt.build();
  builder.patchElement(afterElement.id, afterElement);
  const commitResult = builder.commit();

  if (!beforeElement) {
    return true;
  }

  const didTransform = portal.isMeaningfulChange?.(beforeElement, afterElement) ?? didElementTransform(beforeElement, afterElement);
  if (!didTransform) {
    return true;
  }

  const undoElement = structuredClone(beforeElement);
  const redoElement = structuredClone(afterElement);
  portal.history.record({
    label: args.label,
    undo: () => {
      portal.applyElement(undoElement);
      commitResult.rollback();
    },
    redo: () => {
      portal.applyElement(redoElement);
      portal.crdt.applyOps({ ops: commitResult.redoOps });
    },
  });

  return true;
}
