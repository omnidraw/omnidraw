import type { TElement, TGroup } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import { fnGetCanvasNodeKind, } from "../../core/fn.canvas-node-semantics";
import { isCanvasGroupNode } from "../../core/GUARDS";
import type { CrdtService, ElementService, RenderOrderService, SceneService, SelectionService } from "../../services";

export type TPortalCreateGroupCloneDrag = {
  element: ElementService;
  crdt: CrdtService;
  scene: SceneService;
  renderOrder: RenderOrderService;
  selection: SelectionService;
  toGroup: (node: Konva.Node) => TGroup | null;
  attachListeners: (node: Konva.Node) => boolean;
  setupGroupNode: (group: Konva.Group) => Konva.Group;
  createId: () => string;
  getNodeZIndex: (node: Konva.Group | Konva.Shape) => string;
  setNodeZIndex: (node: Konva.Group | Konva.Shape, zIndex: string) => void;
};

export type TArgsCreateGroupCloneDrag = {
  sourceGroup: Konva.Group;
};

function refreshCloneSubtree(
  portal: TPortalCreateGroupCloneDrag,
  clone: Konva.Group,
) {
  clone.id(portal.createId());
  clone.setDraggable(true);
  clone.setAttr("vcGroupNodeSetup", false);

  clone.getChildren().forEach((node) => {
    if (isCanvasGroupNode(node)) {
      refreshCloneSubtree(portal, node as Konva.Group);
      return;
    }

    const kind = fnGetCanvasNodeKind(node);
    if (kind !== null) {
      node.id(portal.createId());
    }
    node.setDraggable(false);
  });
}

function createPreviewClone(
  portal: TPortalCreateGroupCloneDrag,
  sourceGroup: Konva.Group,
) {
  const clone = sourceGroup.clone() as Konva.Group;
  refreshCloneSubtree(portal, clone);
  return clone;
}

function registerSubtree(
  portal: TPortalCreateGroupCloneDrag,
  args: {
    sourceGroup: Konva.Group;
    cloneGroup: Konva.Group;
    groups: TGroup[];
    elements: TElement[];
  },
) {
  portal.setupGroupNode(args.cloneGroup);
  // TODO: this needs to be resolved as the group service has toGroup now
  const clonedGroup = portal.toGroup(args.cloneGroup);
  if (clonedGroup) {
    args.groups.push(clonedGroup);
  }

  const sourceChildren = args.sourceGroup.getChildren().slice();
  const cloneChildren = args.cloneGroup.getChildren().slice();

  cloneChildren.forEach((cloneChild, index) => {
    const sourceChild = sourceChildren[index];
    if (!sourceChild) {
      return;
    }

    if (
      isCanvasGroupNode(sourceChild)
      && isCanvasGroupNode(cloneChild)
    ) {
      registerSubtree(portal, {
        sourceGroup: sourceChild as Konva.Group,
        cloneGroup: cloneChild as Konva.Group,
        groups: args.groups,
        elements: args.elements,
      });
      return;
    }

    if (fnGetCanvasNodeKind(cloneChild) === null) {
      return;
    }

    portal.attachListeners(cloneChild);
    const clonedElement = portal.element.toElement(cloneChild);
    if (!clonedElement) {
      return;
    }

    args.elements.push(clonedElement);
  });
}

export function txCreateGroupCloneDrag(
  portal: TPortalCreateGroupCloneDrag,
  args: TArgsCreateGroupCloneDrag,
) {
  const previewClone = createPreviewClone(portal, args.sourceGroup);
  portal.scene.dynamicLayer.add(previewClone);
  previewClone.startDrag();
  portal.selection.setSelection([previewClone]);
  portal.selection.setFocusedNode(previewClone);

  const finalizeCloneDrag = () => {
    previewClone.off("dragend", finalizeCloneDrag);
    if (previewClone.isDragging()) {
      previewClone.stopDrag();
    }

    previewClone.moveTo(portal.scene.staticForegroundLayer);
    portal.renderOrder.assignOrderOnInsert({
      parent: portal.scene.staticForegroundLayer,
      nodes: [previewClone],
      position: "front",
    });
    portal.setNodeZIndex(previewClone, portal.getNodeZIndex(args.sourceGroup));

    const groups: TGroup[] = [];
    const elements: TElement[] = [];
    registerSubtree(portal, {
      sourceGroup: args.sourceGroup,
      cloneGroup: previewClone,
      groups,
      elements,
    });

    const builder = portal.crdt.build();
    groups.forEach((group) => {
      builder.patchGroup(group.id, group);
    });
    elements.forEach((element) => {
      builder.patchElement(element.id, element);
    });
    builder.commit();
    portal.selection.setSelection([previewClone]);
    portal.selection.setFocusedNode(previewClone);
    portal.scene.dynamicLayer.batchDraw();
    portal.scene.staticForegroundLayer.batchDraw();
  };

  previewClone.on("dragend", finalizeCloneDrag);
  return previewClone;
}
