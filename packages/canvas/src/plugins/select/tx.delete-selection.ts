import type { TElement, TGroup } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { Group } from "konva/lib/Group";
import type { Layer } from "konva/lib/Layer";
import type { Node } from "konva/lib/Node";
import type { Shape, ShapeConfig } from "konva/lib/Shape";
import { VC_ON_REMOVE_ATTR } from "../../core/CONSTANTS";
import { isCanvasElementNode, isCanvasGroupNode, isKonvaGroup, isKonvaLayer, isKonvaShape } from "../../core/GUARDS";
import { fnGetCanvasNodeKind, } from "../../core/fn.canvas-node-semantics";
import type {
  CrdtService, ElementService, GroupService, HistoryService, RenderOrderService,
  SceneService, SelectionService
} from "../../services";
import { SHAPE2D_INLINE_TEXT_DERIVED_ATTR } from "../shape2d/CONSTANTS";

export type TPortalDeleteSelection = {
  element: ElementService;
  group: GroupService;
  crdt: CrdtService;
  history: HistoryService;
  scene: SceneService;
  renderOrder: RenderOrderService;
  selection: SelectionService;
};

export type TArgsDeleteSelection = {
  recordHistory?: boolean;
  selection?: Array<Group | Shape<ShapeConfig>>;
};

type TSceneNode = Group | Shape<ShapeConfig>;

type TDeleteSnapshot = {
  rootIds: string[];
  groups: TGroup[];
  elements: TElement[];
  groupIds: string[];
  elementIds: string[];
};

type TCollectedDeleteData = {
  snapshot: TDeleteSnapshot;
  removeNodes: TSceneNode[];
  destroyNodes: TSceneNode[];
};

type TNodeOnRemove = (args: { node: TSceneNode }) => void;

function isSceneNode(portal: TPortalDeleteSelection, node: Node | null | undefined): node is TSceneNode {
  void portal;
  return Boolean(node) && (isKonvaGroup(node) || isKonvaShape(node));
}

function isSceneParent(portal: TPortalDeleteSelection, node: Node | null | undefined): node is Group | Layer {
  return Boolean(node) && (isKonvaGroup(node) || isKonvaLayer(node));
}

function isRuntimeOnlyDerivedNode(node: Node) {
  return node.getAttr(SHAPE2D_INLINE_TEXT_DERIVED_ATTR) === true;
}

function callNodeOnRemove(node: TSceneNode) {
  const onRemove = node.getAttr(VC_ON_REMOVE_ATTR);
  if (typeof onRemove !== "function") {
    return;
  }

  (onRemove as TNodeOnRemove)({ node });
}

function isNodeDescendantOf(node: Node, ancestor: Node) {
  let current = node.getParent();

  while (current) {
    if (current === ancestor) {
      return true;
    }

    current = current.getParent();
  }

  return false;
}

function collapseSelectionToDeleteRoots(selection: TSceneNode[]) {
  return selection.filter((node, index) => {
    return !selection.some((candidate, candidateIndex) => {
      if (candidateIndex === index) {
        return false;
      }

      return isNodeDescendantOf(node, candidate);
    });
  });
}

function findSceneNodeById(portal: TPortalDeleteSelection, id: string | null) {
  if (!id) {
    return null;
  }

  const node = portal.scene.staticForegroundLayer.findOne((candidate: Node) => {
    return isSceneNode(portal, candidate) && candidate.id() === id;
  });

  return isSceneNode(portal, node) ? node : null;
}

function sortSceneTopDown(portal: TPortalDeleteSelection, parent: Group | Layer) {
  portal.renderOrder.sortChildren(parent);

  parent.getChildren().forEach((child: Node) => {
    if (!isCanvasGroupNode(child)) {
      return;
    }

    sortSceneTopDown(portal, child as Group);
  });
}

function collectDeleteSnapshot(portal: TPortalDeleteSelection, roots: TSceneNode[]): TCollectedDeleteData | null {
  const groups: TGroup[] = [];
  const elements: TElement[] = [];
  const groupIds = new Set<string>();
  const elementIds = new Set<string>();
  const visitedNodeIds = new Set<string>();
  const visitedNodes: TSceneNode[] = [];
  let didFail = false;

  const visitNode = (node: TSceneNode) => {
    if (didFail || visitedNodeIds.has(node.id())) {
      return;
    }

    visitedNodeIds.add(node.id());
    visitedNodes.push(node);

    if (isRuntimeOnlyDerivedNode(node)) {
      return;
    }

    const kind = fnGetCanvasNodeKind(node);
    if (kind === "group") {
      if (!isCanvasGroupNode(node)) {
        didFail = true;
        return;
      }

      const group = portal.group.toGroup(node);
      if (!group) {
        didFail = true;
        return;
      }

      if (!groupIds.has(node.id())) {
        groupIds.add(node.id());
        groups.push(group);
      }

      (node as Group).getChildren().forEach((child: Node) => {
        if (!isSceneNode(portal, child)) {
          return;
        }

        visitNode(child);
      });
      return;
    }

    if (kind === "element") {
      const element = portal.element.toElement(node);
      if (!element) {
        didFail = true;
        return;
      }

      if (!elementIds.has(node.id())) {
        elementIds.add(node.id());
        elements.push(element);
      }
      return;
    }

    didFail = true;
  };

  roots.forEach((root) => {
    visitNode(root);
  });

  if (didFail) {
    return null;
  }

  return {
    snapshot: {
      rootIds: roots.map((root) => root.id()),
      groups,
      elements,
      groupIds: [...groupIds],
      elementIds: [...elementIds],
    },
    removeNodes: visitedNodes,
    destroyNodes: visitedNodes.filter((node, index) => {
      return !visitedNodes.some((candidate, candidateIndex) => {
        if (candidateIndex === index) {
          return false;
        }

        if (!isCanvasGroupNode(candidate)) {
          return false;
        }

        return isNodeDescendantOf(node, candidate);
      });
    }),
  };
}

function restoreDeleteSnapshot(portal: TPortalDeleteSelection, snapshot: TDeleteSnapshot) {
  const createdGroups = new Set<string>();
  const pendingGroups = [...snapshot.groups];
  let didCreateGroup = true;

  while (pendingGroups.length > 0 && didCreateGroup) {
    didCreateGroup = false;

    for (let index = 0; index < pendingGroups.length; index += 1) {
      const group = pendingGroups[index];
      if (!group) {
        continue;
      }

      const parentNode = group.parentGroupId
        ? findSceneNodeById(portal, group.parentGroupId)
        : portal.scene.staticForegroundLayer;

      if (
        group.parentGroupId !== null
        && parentNode
        && !createdGroups.has(group.parentGroupId)
        && !isCanvasGroupNode(parentNode)
      ) {
        continue;
      }

      const parent = isSceneParent(portal, parentNode) ? parentNode : null;
      if (!parent) {
        continue;
      }

      const groupNode = portal.group.createNodeFromGroup(group);
      if (!groupNode) {
        continue;
      }

      parent.add(groupNode);
      createdGroups.add(group.id);
      pendingGroups.splice(index, 1);
      index -= 1;
      didCreateGroup = true;
    }
  }

  snapshot.elements.forEach((element) => {
    const parentNode = element.parentGroupId
      ? findSceneNodeById(portal, element.parentGroupId)
      : portal.scene.staticForegroundLayer;
    const parent = isSceneParent(portal, parentNode) ? parentNode : null;
    if (!parent) {
      return;
    }

    const node = portal.element.createNodeFromElement(element);
    if (!node) {
      return;
    }

    if (isKonvaGroup(node) || isKonvaShape(node)) {
      parent.add(node);
      portal.element.updateElement(element);
    }
  });

  const builder = portal.crdt.build();
  snapshot.groups.forEach((group) => {
    builder.patchGroup(group.id, group);
  });
  snapshot.elements.forEach((element) => {
    builder.patchElement(element.id, element);
  });
  builder.commit();
  sortSceneTopDown(portal, portal.scene.staticForegroundLayer);

  const restoredRoots = snapshot.rootIds
    .map((id) => findSceneNodeById(portal, id))
    .filter((node): node is TSceneNode => node !== null);

  portal.selection.setSelection(restoredRoots);
  portal.selection.setFocusedId(restoredRoots[restoredRoots.length - 1]?.id() ?? null);
  portal.scene.stage.batchDraw();
}

function deleteSelectionInternal(portal: TPortalDeleteSelection, args: TArgsDeleteSelection) {
  const selection = (args.selection ?? portal.selection.selection)
    .filter((node): node is TSceneNode => isSceneNode(portal, node));
  const roots = collapseSelectionToDeleteRoots(selection);
  if (roots.length === 0) {
    return false;
  }

  const expandedRoots = collapseSelectionToDeleteRoots(roots.flatMap((root) => {
    return portal.renderOrder.getOrderBundle(root).filter((candidate): candidate is TSceneNode => {
      return isSceneNode(portal, candidate);
    });
  }));

  const collected = collectDeleteSnapshot(portal, expandedRoots);
  if (!collected) {
    return false;
  }

  const { snapshot, removeNodes, destroyNodes } = collected;
  removeNodes.forEach((node) => {
    callNodeOnRemove(node);
  });
  destroyNodes.forEach((node) => {
    node.destroy();
  });

  const commitResult = (() => {
    const builder = portal.crdt.build();
    snapshot.elementIds.forEach((id) => {
      builder.deleteElement(id);
    });
    snapshot.groupIds.forEach((id) => {
      builder.deleteGroup(id);
    });
    return builder.commit();
  })();
  portal.selection.clear();
  portal.scene.stage.batchDraw();

  if (args.recordHistory === false) {
    return true;
  }

  portal.history.record({
    label: "delete-selection",
    undo: () => {
      restoreDeleteSnapshot(portal, snapshot);
      commitResult.rollback();
    },
    redo: () => {
      const redoRoots = snapshot.rootIds
        .map((id) => findSceneNodeById(portal, id))
        .filter((node): node is TSceneNode => node !== null);
      deleteSelectionInternal(portal, {
        recordHistory: false,
        selection: redoRoots,
      });
    },
  });

  return true;
}

export function txDeleteSelection(portal: TPortalDeleteSelection, args: TArgsDeleteSelection) {
  // return deleteSelectionInternal(portal, args);

  const selection = (args.selection ?? portal.selection.selection)
    .filter((node): node is TSceneNode => isSceneNode(portal, node));
  const roots = collapseSelectionToDeleteRoots(selection);
  if (roots.length === 0) {
    return false;
  }

  const expandedRoots = collapseSelectionToDeleteRoots(roots.flatMap((root) => {
    return portal.renderOrder.getOrderBundle(root).filter((candidate): candidate is TSceneNode => {
      return isSceneNode(portal, candidate);
    });
  }));

  console.log(expandedRoots)
  let builder = portal.crdt.build()
  expandedRoots.forEach(node => {
    if (isCanvasGroupNode(node)) {
      builder = portal.group.removeGroupById(node.id(), builder)
    } else if (isCanvasElementNode(node)) {
      builder = portal.element.removeElementById(node.id(), builder)
    } else {
      // TODO: remove after feature is done
      console.log('not found', node)
    }
  })

  builder.commit()

  return true

}
