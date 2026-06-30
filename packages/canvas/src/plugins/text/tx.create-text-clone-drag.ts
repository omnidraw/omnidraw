import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import type { CrdtService } from "../../services/crdt/CrdtService";
import type { SceneService } from "../../services/scene/SceneService";
import type { SelectionService } from "../../services/selection/SelectionService";

export type TPortalTxCreateTextCloneDrag = {
  Konva: typeof Konva;
  crdt: CrdtService;
  render: SceneService;
  selection: SelectionService;
  createId: () => string;
  now: () => number;
  serializeNode: (args: { node: Konva.Text; createdAt: number; updatedAt: number }) => TElement;
  setupNode: (node: Konva.Text) => Konva.Text;
};

export type TArgsTxCreateTextCloneDrag = {
  freeTextName: string;
  node: Konva.Text;
};

function stopDragSafely(node: Konva.Node) {
  try {
    if (node.isDragging()) {
      node.stopDrag();
    }
  } catch {
    return;
  }
}

export function txCreateTextCloneDrag(portal: TPortalTxCreateTextCloneDrag, args: TArgsTxCreateTextCloneDrag) {
  const previewClone = new portal.Konva.Text(args.node.getAttrs());
  previewClone.id(portal.createId());
  previewClone.name(args.freeTextName);
  previewClone.draggable(true);
  portal.render.dynamicLayer.add(previewClone);
  previewClone.startDrag();

  const finalizeCloneDrag = () => {
    previewClone.off("dragend", finalizeCloneDrag);
    stopDragSafely(previewClone);
    previewClone.moveTo(portal.render.staticForegroundLayer);
    const cloned = portal.setupNode(previewClone);
    const timestamp = portal.now();
    const clonedElement = portal.serializeNode({
      node: cloned,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const createBuilder = portal.crdt.build();
    createBuilder.patchElement(clonedElement.id, clonedElement);
    createBuilder.commit();
    portal.selection.setSelection([cloned]);
    portal.selection.setFocusedNode(cloned);
    portal.render.dynamicLayer.batchDraw();
    portal.render.staticForegroundLayer.batchDraw();
  };

  previewClone.on("dragend", finalizeCloneDrag);
  return previewClone;
}
