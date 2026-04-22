import type { TElement, TGroup } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import type {
  CrdtService, HistoryService, SceneService, SelectionService, ElementService, GroupService
} from "../../services";
import { fnGetCanvasNodeKind, fnIsCanvasGroupNode } from "../../core/fn.canvas-node-semantics";
import { fnGetSelectionBounds } from "./fn.get-selection-bounds";
import { fnFindSceneNodeById, fnGetGroupChildren, fnGetSelectionGroupParent, fnIsSceneParent, type TSceneNode } from "./fn.scene-node";
import { fnToGroupPatch } from "./fn.to-group-patch";

export type TPortalUngroupSelection = {
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
  getNodeZIndex: (node: Konva.Group) => string;
  now: () => number;
};

export type TArgsUngroupSelection = Record<string, never>;

export function txUngroupSelection(
  portal: TPortalUngroupSelection,
  args: TArgsUngroupSelection,
) {
  const group = [...portal.selection.selection].reverse().find((node): node is Konva.Group => {
    return fnIsCanvasGroupNode(node);
  });
  if (!group) {
    return;
  }

  const parentNode = group.getParent();
  if (!fnIsSceneParent({ scene: portal.scene, node: parentNode })) {
    return;
  }

  const parent = parentNode as Konva.Group | Konva.Layer;
  const children = fnGetGroupChildren({ group, scene: portal.scene });
  const childIds = children.map((child) => child.id());
  const groupPatch = portal.group.toGroup(group);
  const elementPatches: TElement[] = [];
  const nestedGroupPatches: TGroup[] = [];

  children.forEach((child) => {
    const absolutePosition = child.getAbsolutePosition();
    parent.add(child);
    child.setAbsolutePosition(absolutePosition);

    const kind = fnGetCanvasNodeKind(child);
    if (kind === "group") {
      const patch = portal.group.toGroup(child);
      if (patch) {
        nestedGroupPatches.push(patch);
      }
      return;
    }

    if (kind !== null) {
      const element = portal.element.toElement(child);
      if (element) {
        elementPatches.push(element);
        portal.element.updateElement(element);
      }
    }
  });

  group.destroy();
  const commitResult = (() => {
    const builder = portal.crdt.build();
    elementPatches.forEach((element) => {
      builder.patchElement(element.id, element);
    });
    nestedGroupPatches.forEach((nestedGroup) => {
      builder.patchGroup(nestedGroup.id, nestedGroup);
    });
    builder.deleteGroup(group.id());
    return builder.commit();
  })();
  portal.selection.setSelection(children);
  portal.selection.setFocusedNode(children.at(-1) ?? null);
  portal.scene.staticForegroundLayer.batchDraw();

  if (!groupPatch) {
    return;
  }

  portal.history.record({
    label: "ungroup",
    undo() {
      const currentNodes = childIds
        .map((id) => fnFindSceneNodeById({ scene: portal.scene, id }))
        .filter((node): node is TSceneNode => node !== null);

      if (currentNodes.length !== childIds.length) {
        return;
      }

      const currentParent = fnGetSelectionGroupParent({ scene: portal.scene, selection: currentNodes });
      if (!currentParent) {
        return;
      }

      const recreated = portal.setupNode(portal.createGroupNode(groupPatch));
      currentParent.add(recreated);
      const bounds = fnGetSelectionBounds({ selection: currentNodes });
      recreated.position({ x: bounds.x, y: bounds.y });
      recreated.setAttr("width", bounds.width);
      recreated.setAttr("height", bounds.height);

      fnToGroupPatch({
        groupService: portal.group,
        group: recreated,
        getNodeZIndex: portal.getNodeZIndex,
        fallbackCreatedAt: portal.now(),
      });

      currentNodes.forEach((node) => {
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

      portal.selection.setSelection([recreated]);
      portal.selection.setFocusedNode(recreated);
      commitResult.rollback();
      portal.scene.staticForegroundLayer.batchDraw();
    },
    redo() {
      const currentGroupNode = fnFindSceneNodeById({ scene: portal.scene, id: groupPatch.id });
      if (currentGroupNode && !fnIsCanvasGroupNode(currentGroupNode)) {
        return;
      }

      const currentGroup = currentGroupNode as Konva.Group;
      const redoChildren = fnGetGroupChildren({ group: currentGroup, scene: portal.scene });
      const redoParentNode = currentGroup.getParent();
      if (!fnIsSceneParent({ scene: portal.scene, node: redoParentNode })) {
        return;
      }

      const redoParent = redoParentNode as Konva.Group | Konva.Layer;

      redoChildren.forEach((child) => {
        const absolutePosition = child.getAbsolutePosition();
        redoParent.add(child);
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
      portal.selection.setSelection(redoChildren);
      portal.selection.setFocusedNode(redoChildren.at(-1) ?? null);
      portal.crdt.applyOps({ ops: commitResult.redoOps });
      portal.scene.staticForegroundLayer.batchDraw();
    },
  });

  void args;
}
