import type { TElement, TGroup } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import type { CrdtService, HistoryService, SceneService, SelectionService, GroupService, ElementService } from "../../services";
import { fnGetCanvasNodeKind, fnIsCanvasGroupNode } from "../../core/fn.canvas-node-semantics";
import { fnGetSelectionBounds } from "./fn.get-selection-bounds";
import { fnFindSceneNodeById, fnGetGroupChildren, fnGetSelectionGroupParent, fnIsSceneParent, fnIsSceneNode, type TSceneNode } from "./fn.scene-node";
import { fnToGroupPatch } from "./fn.to-group-patch";

export type TPortalGroupSelection = {
  Group: typeof Konva.Group;
  Shape: typeof Konva.Shape;
  Layer: typeof Konva.Layer;
  element: ElementService;
  group: GroupService;
  crdt: CrdtService;
  history: HistoryService;
  scene: SceneService;
  selection: SelectionService;
  setupNode: (group: Konva.Group) => Konva.Group;
  createGroupNode: (group: TGroup) => Konva.Group;
  sortChildrenByPersistedOrder: (parent: Konva.Layer | Konva.Group) => void;
  getNodeZIndex: (node: TSceneNode) => string;
  now: () => number;
  createId: () => string;
};

export type TArgsGroupSelection = Record<string, never>;

export function txGroupSelection(
  portal: TPortalGroupSelection,
  args: TArgsGroupSelection,
) {
  const selection = portal.selection.selection.filter((node): node is TSceneNode => {
    return fnIsSceneNode({ scene: portal.scene, node });
  });
  if (selection.length <= 1) {
    return;
  }

  const parent = fnGetSelectionGroupParent({ scene: portal.scene, selection });
  if (!parent) {
    return;
  }

  const bounds = fnGetSelectionBounds({ selection });
  const createdAt = portal.now();
  const groupId = portal.createId();
  const zIndex = portal.getNodeZIndex(selection[selection.length - 1] ?? selection[0]);
  const groupNode = portal.setupNode(portal.createGroupNode({
    id: groupId,
    parentGroupId: fnIsCanvasGroupNode(parent) ? parent.id() : null,
    zIndex,
    locked: false,
    createdAt,
  }));

  groupNode.position({ x: bounds.x, y: bounds.y });
  groupNode.setAttr("width", bounds.width);
  groupNode.setAttr("height", bounds.height);
  parent.add(groupNode);

  const elementPatches: TElement[] = [];
  const groupPatches: TGroup[] = [fnToGroupPatch({
    groupService: portal.group,
    group: groupNode,
    getNodeZIndex: portal.getNodeZIndex,
    fallbackCreatedAt: createdAt,
  })];

  selection.forEach((node) => {
    const absolutePosition = node.getAbsolutePosition();
    groupNode.add(node);
    node.setAbsolutePosition(absolutePosition);

    const kind = fnGetCanvasNodeKind(node);
    if (kind === "group") {
      const groupPatch = portal.group.toGroup(node);
      if (groupPatch) {
        groupPatches.push(groupPatch);
      }
      return;
    }

    if (kind !== null) {
      const element = portal.element.toElement(node);
      if (element) {
        elementPatches.push(element);
        portal.element.updateElement(element);
      }
    }
  });

  portal.sortChildrenByPersistedOrder(groupNode);
  const commitResult = (() => {
    const builder = portal.crdt.build();
    elementPatches.forEach((element) => {
      builder.patchElement(element.id, element);
    });
    groupPatches.forEach((group) => {
      builder.patchGroup(group.id, group);
    });
    return builder.commit();
  })();
  portal.selection.setSelection([groupNode]);
  portal.selection.setFocusedNode(groupNode);
  portal.scene.staticForegroundLayer.batchDraw();

  const childIds = selection.map((node) => node.id());

  portal.history.record({
    label: "group",
    undo() {
      const currentGroupNode = fnFindSceneNodeById({ scene: portal.scene, id: groupId });
      if (currentGroupNode && !fnIsCanvasGroupNode(currentGroupNode)) {
        return;
      }

      const currentGroup = currentGroupNode as Konva.Group;
      const children = fnGetGroupChildren({ group: currentGroup, scene: portal.scene });
      const currentParentNode = currentGroup.getParent();
      if (!fnIsSceneParent({ scene: portal.scene, node: currentParentNode })) {
        return;
      }

      const currentParent = currentParentNode as Konva.Group | Konva.Layer;

      children.forEach((child) => {
        const absolutePosition = child.getAbsolutePosition();
        currentParent.add(child);
        child.setAbsolutePosition(absolutePosition);

        const kind = fnGetCanvasNodeKind(child);
        if (kind === "group") {
          return;
        }

        if (kind !== null) {
          const element = portal.element.toElement(child);
          if (element) {
            portal.element.updateElement(element);
          }
        }
      });

      currentGroup.destroy();
      portal.selection.setSelection(children);
      portal.selection.setFocusedNode(children.at(-1) ?? null);
      commitResult.rollback();
      portal.scene.staticForegroundLayer.batchDraw();
    },
    redo() {
      const nodes = childIds
        .map((id) => fnFindSceneNodeById({ scene: portal.scene, id }))
        .filter((node): node is TSceneNode => node !== null);

      if (nodes.length !== childIds.length) {
        return;
      }

      const redoParent = fnGetSelectionGroupParent({ scene: portal.scene, selection: nodes });
      if (!redoParent) {
        return;
      }

      const recreated = portal.setupNode(portal.createGroupNode({
        id: groupId,
        parentGroupId: redoParent && fnIsCanvasGroupNode(redoParent) ? redoParent.id() : null,
        zIndex,
        locked: false,
        createdAt,
      }));
      const redoBounds = fnGetSelectionBounds({ selection: nodes });
      recreated.position({ x: redoBounds.x, y: redoBounds.y });
      recreated.setAttr("width", redoBounds.width);
      recreated.setAttr("height", redoBounds.height);
      redoParent.add(recreated);

      fnToGroupPatch({
        groupService: portal.group,
        group: recreated,
        getNodeZIndex: portal.getNodeZIndex,
        fallbackCreatedAt: createdAt,
      });

      nodes.forEach((node) => {
        const absolutePosition = node.getAbsolutePosition();
        recreated.add(node);
        node.setAbsolutePosition(absolutePosition);

        const kind = fnGetCanvasNodeKind(node);
        if (kind === "group") {
          return;
        }

        if (kind !== null) {
          const element = portal.element.toElement(node);
          if (element) {
            portal.element.updateElement(element);
          }
        }
      });

      portal.sortChildrenByPersistedOrder(recreated);
      portal.selection.setSelection([recreated]);
      portal.selection.setFocusedNode(recreated);
      portal.crdt.applyOps({ ops: commitResult.redoOps });
      portal.scene.staticForegroundLayer.batchDraw();
    },
  });

  void args;
}
