import type { IPlugin } from "@vibecanvas/runtime";
import type { TElement, TGroup } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import Konva from "konva";
import { VC_ON_REMOVE_ATTR } from "../../core/CONSTANTS";
import { isCanvasGroupNode, isKonvaGroup, isKonvaShape } from "../../core/GUARDS";
import type { TNodeOnRemove } from "../../core/types";
import type { CrdtService, TCrdtChangeSummary } from "../../services/crdt/CrdtService";
import type { ElementService } from "../../services/element/ElementService";
import type { GroupService } from "../../services/group/GroupService";
import type { SceneService } from "../../services/scene/SceneService";
import type { SelectionService } from "../../services/selection/SelectionService";
import type { IRuntimeConfig, IRuntimeHooks, IRuntimeServices } from "../../types";

type TSceneNode = Konva.Group | Konva.Shape;
type TSceneStateSnapshot = {
  selectionIds: string[];
  focusedId: string | null;
};

function destroySceneNode(node: Konva.Node | null | undefined) {
  if (!node) return;

  const onRemove = node.getAttr(VC_ON_REMOVE_ATTR);
  if (typeof onRemove === "function") {
    (onRemove as TNodeOnRemove)({ node });
  }

  node.destroy();
}

function destroySceneChildren(parent: Konva.Container) {
  parent.getChildren().slice().forEach((node) => {
    destroySceneNode(node);
  });
}

function compareByPersistedOrder(left: { id: string; zIndex?: string }, right: { id: string; zIndex?: string }) {
  const zCompare = (left.zIndex ?? "").localeCompare(right.zIndex ?? "");
  if (zCompare !== 0) {
    return zCompare;
  }

  return left.id.localeCompare(right.id);
}

function captureSceneState(selection: SelectionService): TSceneStateSnapshot {
  return {
    selectionIds: selection.selection.map((node) => node.id()),
    focusedId: selection.focusedId,
  };
}

function findSceneNodeById(scene: SceneService, id: string | null): TSceneNode | null {
  if (!id) {
    return null;
  }

  const node = scene.staticForegroundLayer.findOne((candidate: Konva.Node) => {
    return (isKonvaGroup(candidate) || isKonvaShape(candidate)) && candidate.id() === id;
  });

  if (!isKonvaGroup(node) && !isKonvaShape(node)) {
    return null;
  }

  return node;
}

function findGroupById(scene: SceneService, id: string | null): Konva.Group | null {
  if (!id) {
    return null;
  }

  const node = scene.staticForegroundLayer.findOne((candidate: Konva.Node) => {
    return isCanvasGroupNode(candidate) && candidate.id() === id;
  });

  return isKonvaGroup(node) ? node : null;
}

function resolveElementParent(scene: SceneService, element: TElement) {
  if (!element.parentGroupId) {
    return scene.staticForegroundLayer;
  }

  return findGroupById(scene, element.parentGroupId);
}

function hasGroupChanges(change: TCrdtChangeSummary) {
  return change.groups.added.length > 0
    || change.groups.updated.length > 0
    || change.groups.deleted.length > 0;
}

function getChangedElementIds(change: TCrdtChangeSummary) {
  return [...new Set([
    ...change.elements.added,
    ...change.elements.updated,
  ])];
}

function restoreSceneState(scene: SceneService, selection: SelectionService, snapshot: TSceneStateSnapshot) {
  const nextSelection = snapshot.selectionIds
    .map((id) => findSceneNodeById(scene, id))
    .filter((node): node is TSceneNode => node !== null);

  selection.setSelection(nextSelection);
  selection.setFocusedId(findSceneNodeById(scene, snapshot.focusedId)?.id() ?? null);
}

function loadGroupsTopDown(args: {
  groups: TGroup[];
  group: GroupService;
  scene: SceneService;
}) {
  const groupsById = new Map(args.groups.map((group) => [group.id, group]));
  const remainingGroupIds = new Set(args.groups.map((group) => group.id));
  const mountedGroups = new Map<string, Konva.Group>();

  while (remainingGroupIds.size > 0) {
    let loadedInPass = false;

    for (const groupId of [...remainingGroupIds]) {
      const group = groupsById.get(groupId);
      if (!group) {
        remainingGroupIds.delete(groupId);
        continue;
      }

      const parent = group.parentGroupId
        ? mountedGroups.get(group.parentGroupId)
        : args.scene.staticForegroundLayer;
      if (!parent) {
        continue;
      }

      const groupNode = args.group.createNodeFromGroup(group);
      remainingGroupIds.delete(groupId);
      if (!groupNode) {
        continue;
      }

      parent.add(groupNode);
      mountedGroups.set(groupId, groupNode);
      loadedInPass = true;
    }

    if (!loadedInPass) {
      break;
    }
  }
}

function loadElementsTopDown(args: {
  elements: TElement[];
  element: ElementService;
  scene: SceneService;
}) {
  const groupsById = new Map(
    args.scene.staticForegroundLayer.find((candidate: Konva.Node) => {
      return isCanvasGroupNode(candidate);
    }).map((candidate) => [candidate.id(), candidate as Konva.Group]),
  );
  const invalidElementIds: string[] = [];

  args.elements.forEach((element) => {
    const parent = element.parentGroupId
      ? groupsById.get(element.parentGroupId)
      : args.scene.staticForegroundLayer;
    if (!parent) {
      return;
    }

    if (!element.data) {
      invalidElementIds.push(element.id);
      return;
    }

    const node = args.element.createNodeFromElement(element);
    if (!node) {
      return;
    }

    if (isKonvaGroup(node) || isKonvaShape(node)) {
      parent.add(node);
      args.element.updateElement(element);
    }
  });

  return invalidElementIds;
}

function reloadElementsByIds(args: {
  crdt: CrdtService;
  element: ElementService;
  scene: SceneService;
  selection: SelectionService;
  elementIds: readonly string[];
}) {
  const doc = args.crdt.doc();
  const elementIds = new Set(args.elementIds);
  const affectedParents = new Set<Konva.Layer | Konva.Group>();
  const snapshot = captureSceneState(args.selection);

  Object.values(doc.elements)
    .filter((element) => elementIds.has(element.id))
    .sort(compareByPersistedOrder)
    .forEach((persistedElement) => {
      const existingNode = findSceneNodeById(args.scene, persistedElement.id);
      const parent = resolveElementParent(args.scene, persistedElement) ?? existingNode?.getParent();
      if (!(parent instanceof Konva.Layer) && !(parent instanceof Konva.Group)) {
        return;
      }

      destroySceneNode(existingNode);
      const nextNode = args.element.createNodeFromElement(persistedElement);
      if (!isKonvaGroup(nextNode) && !isKonvaShape(nextNode)) {
        return;
      }

      parent.add(nextNode);
      args.element.updateElement(persistedElement);
      affectedParents.add(parent);
    });

  affectedParents.forEach((parent) => {
    sortSceneTopDown(parent);
  });
  restoreSceneState(args.scene, args.selection, snapshot);
  args.scene.stage.batchDraw();
}

function sortSceneTopDown(parent: Konva.Layer | Konva.Group) {
  parent.getChildren()
    .filter((candidate): candidate is TSceneNode => isKonvaGroup(candidate) || isKonvaShape(candidate))
    .slice()
    .sort((left, right) => {
      return compareByPersistedOrder(
        { id: left.id(), zIndex: (left as Konva.Node).getAttr("vcZIndex") as string | undefined },
        { id: right.id(), zIndex: (right as Konva.Node).getAttr("vcZIndex") as string | undefined },
      );
    })
    .forEach((child, index) => {
      child.zIndex(index);
      if (isCanvasGroupNode(child)) {
        sortSceneTopDown(child as Konva.Group);
      }
    });
}

function loadCanvas(args: {
  crdt: CrdtService;
  element: ElementService;
  group: GroupService;
  scene: SceneService;
}) {
  const doc = args.crdt.doc();
  const groups = Object.values(doc.groups).sort(compareByPersistedOrder);
  const elements = Object.values(doc.elements).sort(compareByPersistedOrder);

  loadGroupsTopDown({ groups, group: args.group, scene: args.scene });
  const invalidElementIds = loadElementsTopDown({ elements, element: args.element, scene: args.scene });
  if (invalidElementIds.length > 0) {
    const builder = args.crdt.build();
    invalidElementIds.forEach((id) => {
      builder.deleteElement(id);
    });
    builder.commit();
  }
  sortSceneTopDown(args.scene.staticForegroundLayer);
  args.scene.stage.batchDraw();
}

function applyIncrementalElementChange(args: {
  crdt: CrdtService;
  element: ElementService;
  scene: SceneService;
  selection: SelectionService;
  change: TCrdtChangeSummary;
}) {
  if (args.change.fullReload || hasGroupChanges(args.change)) {
    return false;
  }

  const doc = args.crdt.doc();
  const affectedParents = new Set<Konva.Layer | Konva.Group>();
  const snapshot = captureSceneState(args.selection);

  args.change.elements.deleted.forEach((id) => {
    const node = findSceneNodeById(args.scene, id);
    const parent = node?.getParent();
    if (parent instanceof Konva.Layer || parent instanceof Konva.Group) {
      affectedParents.add(parent);
    }
    destroySceneNode(node);
  });

  for (const id of getChangedElementIds(args.change)) {
    const changedElement = doc.elements[id];
    if (!changedElement?.data) {
      return false;
    }

    const parent = resolveElementParent(args.scene, changedElement);
    if (!parent) {
      return false;
    }

    const existingNode = findSceneNodeById(args.scene, id);
    if (!existingNode) {
      const node = args.element.createNodeFromElement(changedElement);
      if (!isKonvaGroup(node) && !isKonvaShape(node)) {
        return false;
      }

      parent.add(node);
      args.element.updateElement(changedElement);
      affectedParents.add(parent);
      continue;
    }

    const previousParent = existingNode.getParent();
    if (previousParent !== parent) {
      if (previousParent instanceof Konva.Layer || previousParent instanceof Konva.Group) {
        affectedParents.add(previousParent);
      }
      existingNode.moveTo(parent);
    }

    const didUpdate = args.element.updateElement(changedElement);
    if (!didUpdate) {
      return false;
    }
    affectedParents.add(parent);
  }

  affectedParents.forEach((parent) => {
    sortSceneTopDown(parent);
  });
  restoreSceneState(args.scene, args.selection, snapshot);
  args.scene.stage.batchDraw();
  return true;
}

/**
 * Rebuilds runtime scene from CRDT document for migrated groups and elements.
 */
export function createSceneHydratorPlugin(): IPlugin<IRuntimeServices, IRuntimeHooks, IRuntimeConfig> {
  return {
    name: "scene-hydrator",
    apply(ctx) {
      const crdt = ctx.services.require("crdt");
      const element = ctx.services.require("element");
      const group = ctx.services.require("group");
      const scene = ctx.services.require("scene");
      const selection = ctx.services.require("selection");

      let destroyed = false;
      let isReloading = false;
      let reloadQueued = false;

      const reloadCanvas = async () => {
        if (destroyed) {
          return;
        }

        if (isReloading) {
          reloadQueued = true;
          return;
        }

        isReloading = true;

        try {
          const snapshot = captureSceneState(selection);
          destroySceneChildren(scene.staticForegroundLayer);
          loadCanvas({ crdt, element, group, scene });
          restoreSceneState(scene, selection, snapshot);
        } finally {
          isReloading = false;
        }

        if (reloadQueued) {
          reloadQueued = false;
          await reloadCanvas();
        }
      };

      crdt.hooks.change.tap((change) => {
        if (destroyed) {
          return;
        }

        const consumedLocalChange = crdt.consumePendingLocalChangeEvent();
        if (consumedLocalChange) {
          return;
        }

        const didApplyIncrementally = applyIncrementalElementChange({
          crdt,
          element,
          scene,
          selection,
          change,
        });
        if (didApplyIncrementally) {
          return;
        }

        void reloadCanvas();
      });

      ctx.hooks.initAsync.tapPromise(async () => {
        loadCanvas({ crdt, element, group, scene });
      });

      ctx.hooks.elementDefinitionInvalidated.tap((event) => {
        reloadElementsByIds({
          crdt,
          element,
          scene,
          selection,
          elementIds: event.elementIds,
        });
      });

      ctx.hooks.destroy.tap(() => {
        destroyed = true;
      });
    },
  };
}
