import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import { VC_NODE_KIND_ATTR } from "../../core/CONSTANTS";
import type { CrdtService, ElementService, RenderOrderService, SceneService, SelectionService } from "..";

type TPortal = {
  Group: typeof Konva.Group;
  crdt: CrdtService;
  element: Pick<ElementService, "toElement">;
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

export function txCreateWidgetCloneDrag(portal: TPortal, args: TArgs) {
  const sourceElement = portal.element.toElement(args.node);
  if (!sourceElement || sourceElement.data.type !== "widget") {
    return false;
  }

  const previewClone = portal.createNode(createClonedElement(portal, sourceElement));
  if (!(previewClone instanceof portal.Group)) {
    return false;
  }

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
      previewClone.destroy();
      portal.scene.staticForegroundLayer.batchDraw();
      return;
    }

    const builder = portal.crdt.build();
    builder.patchElement(clonedElement.id, clonedElement);
    builder.commit();
    portal.selection.setSelection([previewClone]);
    portal.selection.setFocusedNode(previewClone);
    portal.scene.dynamicLayer.batchDraw();
    portal.scene.staticForegroundLayer.batchDraw();
  };

  previewClone.on("dragend", finalizeCloneDrag);
  return true;
}
