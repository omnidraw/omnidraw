import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import { VC_NODE_KIND_ATTR } from "../../core/CONSTANTS";
import type {
  CrdtService,
  ElementService,
  HistoryService,
  RenderOrderService,
  SceneService,
  SelectionService,
} from "../../services";

export type TPortalCreateShape2dCloneDrag = {
  Konva: typeof Konva;
  element: ElementService;
  crdt: CrdtService;
  history: HistoryService;
  render: SceneService;
  renderOrder: RenderOrderService;
  selection: SelectionService;
  createId: () => string;
  now: () => number;
  createNode: (element: TElement) => Konva.Shape | null;
  setupNode: (node: Konva.Shape) => Konva.Shape;
  toElement: (node: Konva.Node) => TElement | null;
};

export type TArgsCreateShape2dCloneDrag = {
  node: Konva.Shape;
};

export function txCreateShape2dCloneDrag(
  portal: TPortalCreateShape2dCloneDrag,
  args: TArgsCreateShape2dCloneDrag,
) {
  const sourceElement = portal.toElement(args.node);
  if (!sourceElement) {
    return null;
  }

  const timestamp = portal.now();
  const previewClone = portal.createNode({
    ...sourceElement,
    id: portal.createId(),
    createdAt: timestamp,
    updatedAt: timestamp,
    parentGroupId: null,
    zIndex: "",
  });
  if (!previewClone) {
    return null;
  }

  previewClone.draggable(true);
  previewClone.listening(true);
  portal.render.dynamicLayer.add(previewClone);
  previewClone.startDrag();

  const finalizeCloneDrag = () => {
    previewClone.off("dragend", finalizeCloneDrag);
    if (previewClone.isDragging()) {
      previewClone.stopDrag();
    }

    previewClone.moveTo(portal.render.staticForegroundLayer);
    previewClone.setAttr(VC_NODE_KIND_ATTR, "element");
    portal.setupNode(previewClone);
    portal.renderOrder.assignOrderOnInsert({
      parent: portal.render.staticForegroundLayer,
      nodes: [previewClone],
      position: "front",
    });

    const clonedElement = portal.toElement(previewClone);
    if (!clonedElement) {
      return;
    }

    portal.element.updateElement(clonedElement);
    const createCommitResult = (() => {
      const builder = portal.crdt.build();
      builder.patchElement(clonedElement.id, clonedElement);
      return builder.commit();
    })();

    portal.history.record({
      label: "clone-shape2d",
      undo() {
        portal.renderOrder.getOrderBundle(previewClone).forEach((node) => {
          node.destroy();
        });
        createCommitResult.rollback();
        portal.selection.clear();
        portal.render.staticForegroundLayer.batchDraw();
      },
      redo() {
        const recreatedNode = portal.element.createNodeFromElement(clonedElement);
        if (!(recreatedNode instanceof portal.Konva.Shape)) {
          return;
        }

        portal.render.staticForegroundLayer.add(recreatedNode);
        portal.element.updateElement(clonedElement);
        portal.renderOrder.sortChildren(portal.render.staticForegroundLayer);
        portal.crdt.applyOps({ ops: createCommitResult.redoOps });
        portal.selection.setSelection([recreatedNode]);
        portal.selection.setFocusedNode(recreatedNode);
        portal.render.staticForegroundLayer.batchDraw();
      },
    });
    portal.selection.setSelection([previewClone]);
    portal.selection.setFocusedNode(previewClone);
    portal.render.dynamicLayer.batchDraw();
    portal.render.staticForegroundLayer.batchDraw();
  };

  previewClone.on("dragend", finalizeCloneDrag);
  return previewClone;
}
