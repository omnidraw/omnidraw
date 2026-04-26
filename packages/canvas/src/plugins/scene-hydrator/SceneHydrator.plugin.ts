import type { IPlugin } from "@vibecanvas/runtime";
import type { TElement, TGroup } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import Konva from "konva";
import { isCanvasGroupNode, isKonvaGroup, isKonvaShape } from "../../core/GUARDS";
import type { CrdtService } from "../../services/crdt/CrdtService";
import type { ElementService } from "../../services/element/ElementService";
import type { GroupService } from "../../services/group/GroupService";
import type { SceneService } from "../../services/scene/SceneService";
import type { SelectionService } from "../../services/selection/SelectionService";
import type { IRuntimeHooks } from "../../types";

type TSceneNode = Konva.Group | Konva.Shape;
type TSceneStateSnapshot = {
  selectionIds: string[];
  focusedId: string | null;
};

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

function sortSceneTopDown(parent: Konva.Layer | Konva.Group) {
  parent.getChildren()
    .filter((candidate): candidate is TSceneNode => isKonvaGroup(candidate) || isKonvaShape(candidate))
    .slice()
    .sort((left, right) => {
      return compareByPersistedOrder(
        { id: left.id(), zIndex: left.getAttr("vcZIndex") as string | undefined },
        { id: right.id(), zIndex: right.getAttr("vcZIndex") as string | undefined },
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

/**
 * Rebuilds runtime scene from CRDT document for migrated groups and elements.
 */
export function createSceneHydratorPlugin(): IPlugin<{
  crdt: CrdtService;
  element: ElementService;
  group: GroupService;
  scene: SceneService;
  selection: SelectionService;
}, IRuntimeHooks> {
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
          scene.staticForegroundLayer.destroyChildren();
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

      crdt.hooks.change.tap(() => {
        if (destroyed) {
          return;
        }

        const consumedLocalChange = crdt.consumePendingLocalChangeEvent();
        if (consumedLocalChange) {
          return;
        }

        void reloadCanvas();
      });

      ctx.hooks.initAsync.tapPromise(async () => {
        loadCanvas({ crdt, element, group, scene });
      });

      ctx.hooks.destroy.tap(() => {
        destroyed = true;
      });
    },
  };
}
