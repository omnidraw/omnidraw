import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import { VC_NODE_KIND_ATTR, VC_ON_REMOVE_ATTR } from "../../core/CONSTANTS";
import type { CrdtService, ElementService, HistoryService, RenderOrderService, SceneService, SelectionService } from "..";

type TNodeOnRemove = (args: { node: unknown }) => void;

type TPortal = {
  Group: typeof Konva.Group;
  crdt: CrdtService;
  element: Pick<ElementService, "toElement" | "updateElement">;
  history: HistoryService;
  renderOrder: RenderOrderService;
  scene: SceneService;
  selection: SelectionService;
  createId: () => string;
  createNode: (element: TElement) => Konva.Group | null;
  now: () => number;
  setupNode: (node: Konva.Group) => boolean;
}

type TArgs = {
  node: Konva.Node;
}

function stopDragSafely(node: Konva.Node) {
  try {
    if (node.isDragging()) {
      node.stopDrag();
    }
  } catch {
    return;
  }
}

function createClonedElement(portal: TPortal, sourceElement: TElement) {
  const timestamp = portal.now();

  return {
    ...structuredClone(sourceElement),
    id: portal.createId(),
    createdAt: timestamp,
    updatedAt: timestamp,
    parentGroupId: null,
    zIndex: "",
  } satisfies TElement;
}

function findWidgetNodeById(portal: TPortal, id: string) {
  const node = portal.scene.staticForegroundLayer.findOne((candidate: Konva.Node) => {
    return candidate instanceof portal.Group && candidate.id() === id;
  });

  return node instanceof portal.Group ? node : null;
}

function removeWidgetNode(node: Konva.Group) {
  const onRemove = node.getAttr(VC_ON_REMOVE_ATTR);
  if (typeof onRemove === "function") {
    (onRemove as TNodeOnRemove)({ node });
  }

  node.destroy();
}

export function txCreateWidgetCloneDrag(portal: TPortal, args: TArgs) {
  const sourceElement = portal.element.toElement(args.node);
  if (!sourceElement || sourceElement.data.type !== "widget") {
    return false;
  }

  const previewClone = portal.createNode(createClonedElement(portal, sourceElement));
  if (!(previewClone instanceof portal.Group)) {
    return false;
  }

  previewClone.off("dragend");
  previewClone.draggable(true);
  previewClone.listening(true);
  portal.scene.dynamicLayer.add(previewClone);
  previewClone.startDrag();

  const finalizeCloneDrag = () => {
    previewClone.off("dragend", finalizeCloneDrag);
    stopDragSafely(previewClone);
    previewClone.moveTo(portal.scene.staticForegroundLayer);
    previewClone.setAttr(VC_NODE_KIND_ATTR, "element");
    portal.setupNode(previewClone);
    portal.renderOrder.assignOrderOnInsert({
      parent: portal.scene.staticForegroundLayer,
      nodes: [previewClone],
      position: "front",
    });

    const clonedElement = portal.element.toElement(previewClone);
    if (!clonedElement) {
      removeWidgetNode(previewClone);
      portal.scene.staticForegroundLayer.batchDraw();
      return;
    }

    portal.element.updateElement(clonedElement);
    const createCommitResult = (() => {
      const builder = portal.crdt.build();
      builder.patchElement(clonedElement.id, clonedElement);
      return builder.commit();
    })();

    let currentNode: Konva.Group | null = previewClone;

    portal.history.record({
      label: "clone-widget",
      undo() {
        const node = currentNode ?? findWidgetNodeById(portal, clonedElement.id);
        if (node) {
          removeWidgetNode(node);
          currentNode = null;
        }

        createCommitResult.rollback();
        portal.selection.clear();
        portal.scene.staticForegroundLayer.batchDraw();
      },
      redo() {
        const recreatedNode = portal.createNode(clonedElement);
        if (!(recreatedNode instanceof portal.Group)) {
          return;
        }

        portal.scene.staticForegroundLayer.add(recreatedNode);
        portal.element.updateElement(clonedElement);
        portal.renderOrder.sortChildren(portal.scene.staticForegroundLayer);
        portal.crdt.applyOps({ ops: createCommitResult.redoOps });
        portal.selection.setSelection([recreatedNode]);
        portal.selection.setFocusedNode(recreatedNode);
        portal.scene.staticForegroundLayer.batchDraw();
        currentNode = recreatedNode;
      },
    });

    portal.selection.setSelection([previewClone]);
    portal.selection.setFocusedNode(previewClone);
    portal.scene.dynamicLayer.batchDraw();
    portal.scene.staticForegroundLayer.batchDraw();
  };

  previewClone.on("dragend", finalizeCloneDrag);
  return true;
}
