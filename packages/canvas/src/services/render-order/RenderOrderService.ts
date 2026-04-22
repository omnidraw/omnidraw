import type { IService } from "@vibecanvas/runtime";
import type { TElement, TGroup } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import Konva from "konva";
import { fnIsCanvasGroupNode } from "../../core/fn.canvas-node-semantics";
import { fnCreateOrderedZIndex } from "../../core/fn.create-ordered-z-index";
import { fnGetNodeZIndex } from "../../core/fn.get-node-z-index";
import { txSetNodeZIndex } from "../../core/tx.set-node-z-index";
import type { TRenderOrderSnapshot } from "../../types";
import type { CanvasRegistryService } from "../canvas-registry/CanvasRegistryService";
import type { CrdtService } from "../crdt/CrdtService";
import type { HistoryService } from "../history/HistoryService";
import type { SceneService } from "../scene/SceneService";

export type TOrderedNode = Konva.Group | Konva.Shape;
export type TParentContainer = Konva.Layer | Konva.Group;
export type TRenderOrderInsertPosition = "front" | "back" | { beforeId?: string; afterId?: string };
export type TRenderOrderBundleResolver = (node: TOrderedNode) => TOrderedNode[] | null;

export type TRenderOrderServiceArgs = {
  crdt: CrdtService;
  history: HistoryService;
  scene: SceneService;
  canvasRegistry: CanvasRegistryService;
  syncDomOrder?: () => void;
};

function isOrderedNode(node: Konva.Node): node is TOrderedNode {
  return node instanceof Konva.Node
}

function isParentContainer(node: Konva.Node | null | undefined): node is TParentContainer {
  return node instanceof Konva.Layer || node instanceof Konva.Group;
}

function getImmediateOrderedChildren(parent: TParentContainer) {
  return parent.getChildren().filter(isOrderedNode) as TOrderedNode[];
}

function sortNodesForBundle(nodes: TOrderedNode[], parent: TParentContainer) {
  const children = getImmediateOrderedChildren(parent);
  const order = new Map(children.map((node, index) => [node.id(), index]));
  return [...nodes].sort((left, right) => (order.get(left.id()) ?? 0) - (order.get(right.id()) ?? 0));
}

function insertNodes(
  stationary: TOrderedNode[],
  moving: TOrderedNode[],
  position: TRenderOrderInsertPosition,
) {
  if (position === "back") {
    return [...moving, ...stationary];
  }

  if (position === "front") {
    return [...stationary, ...moving];
  }

  if (position.afterId) {
    const anchorIndex = stationary.findIndex((node) => node.id() === position.afterId);
    if (anchorIndex >= 0) {
      return [
        ...stationary.slice(0, anchorIndex + 1),
        ...moving,
        ...stationary.slice(anchorIndex + 1),
      ];
    }
  }

  if (position.beforeId) {
    const anchorIndex = stationary.findIndex((node) => node.id() === position.beforeId);
    if (anchorIndex >= 0) {
      return [
        ...stationary.slice(0, anchorIndex),
        ...moving,
        ...stationary.slice(anchorIndex),
      ];
    }
  }

  return [...stationary, ...moving];
}

export class RenderOrderService implements IService<Record<string, never>> {
  readonly name = "renderOrder";
  readonly hooks = {};

  readonly crdt: CrdtService;
  readonly history: HistoryService;
  readonly scene: SceneService;
  readonly syncDomOrder?: () => void;
  #bundleResolvers = new Map<string, TRenderOrderBundleResolver>();

  constructor(args: TRenderOrderServiceArgs) {
    this.crdt = args.crdt;
    this.history = args.history;
    this.scene = args.scene;
    this.syncDomOrder = args.syncDomOrder;
  }

  registerBundleResolver(id: string, resolver: TRenderOrderBundleResolver) {
    this.#bundleResolvers.set(id, resolver);
  }

  unregisterBundleResolver(id: string) {
    this.#bundleResolvers.delete(id);
  }

  clearBundleResolvers() {
    this.#bundleResolvers.clear();
  }

  getNodeZIndex(node: TOrderedNode) {
    return fnGetNodeZIndex({ node });
  }

  setNodeZIndex(node: TOrderedNode, zIndex: string) {
    txSetNodeZIndex({}, { node, zIndex });
  }

  getOrderBundle(node: TOrderedNode) {
    for (const resolver of this.#bundleResolvers.values()) {
      const bundle = resolver(node);
      if (bundle && bundle.length > 0) {
        return bundle;
      }
    }

    const parent = node.getParent();
    if (!isParentContainer(parent)) {
      return [node];
    }

    return sortNodesForBundle([node], parent);
  }

  getOrderedSiblings(parent: TParentContainer) {
    const children = getImmediateOrderedChildren(parent);
    return [...children].sort((left, right) => {
      const zCompare = fnGetNodeZIndex({ node: left }).localeCompare(fnGetNodeZIndex({ node: right }));
      if (zCompare !== 0) {
        return zCompare;
      }

      return left.id().localeCompare(right.id());
    });
  }

  sortChildren(parent: TParentContainer) {
    const sorted = this.getOrderedSiblings(parent);
    sorted.forEach((node, index) => {
      node.zIndex(index);
    });
    this.syncDomOrder?.();
  }

  assignOrderOnInsert(args: {
    parent: TParentContainer;
    nodes: TOrderedNode[];
    position?: TRenderOrderInsertPosition;
  }) {
    const orderedNodes = sortNodesForBundle(args.nodes.filter((node) => node.getParent() === args.parent), args.parent);
    if (orderedNodes.length === 0) {
      return [];
    }

    const children = getImmediateOrderedChildren(args.parent);
    const movingIds = new Set(orderedNodes.map((node) => node.id()));
    const stationary = children.filter((child) => !movingIds.has(child.id()));
    const nextChildren = insertNodes(stationary, orderedNodes, args.position ?? "front");
    return this.applyOrderedChildren(args.parent, nextChildren, true);
  }

  moveSelectionUp(nodes: TOrderedNode[]) {
    this.moveByOneStep(nodes, "forward");
  }

  moveSelectionDown(nodes: TOrderedNode[]) {
    this.moveByOneStep(nodes, "backward");
  }

  bringSelectionToFront(nodes: TOrderedNode[]) {
    this.moveToExtreme(nodes, "front");
  }

  sendSelectionToBack(nodes: TOrderedNode[]) {
    this.moveToExtreme(nodes, "back");
  }

  snapshotParentOrder(parent: TParentContainer): TRenderOrderSnapshot {
    return {
      parentId: parent.id() || "__layer__",
      items: getImmediateOrderedChildren(parent).map((node) => ({
        id: node.id(),
        zIndex: fnGetNodeZIndex({ node }),
        kind: fnIsCanvasGroupNode(node) ? 'group' : 'element',
      })),
    };
  }

  restoreParentOrder(snapshot: TRenderOrderSnapshot) {
    const parent = this.findParentBySnapshot(snapshot);
    if (!parent) {
      return;
    }

    snapshot.items.forEach((item) => {
      const node = this.findImmediateChildById(parent, item.id);
      if (!node) {
        return;
      }

      txSetNodeZIndex({}, { node, zIndex: item.zIndex });
    });

    this.sortChildren(parent);
  }

  private moveByOneStep(roots: TOrderedNode[], direction: "forward" | "backward") {
    const resolved = this.resolveOrderedUnits(roots);
    if (!resolved) {
      return;
    }

    const units = [...resolved.units];
    if (direction === "forward") {
      for (let index = units.length - 2; index >= 0; index -= 1) {
        if (!units[index].selected && units[index + 1].selected) {
          [units[index], units[index + 1]] = [units[index + 1], units[index]];
        }
      }
    } else {
      for (let index = 1; index < units.length; index += 1) {
        if (units[index].selected && !units[index - 1].selected) {
          [units[index], units[index - 1]] = [units[index - 1], units[index]];
        }
      }
    }

    this.applyUnitOrder(resolved.parent, units);
  }

  private moveToExtreme(roots: TOrderedNode[], position: "front" | "back") {
    const resolved = this.resolveOrderedUnits(roots);
    if (!resolved) {
      return;
    }

    const selected = resolved.units.filter((unit) => unit.selected);
    const unselected = resolved.units.filter((unit) => !unit.selected);
    const next = position === "front"
      ? [...unselected, ...selected]
      : [...selected, ...unselected];

    this.applyUnitOrder(resolved.parent, next);
  }

  private resolveOrderedUnits(roots: TOrderedNode[]) {
    const uniqueRoots = roots.filter((node, index) => roots.findIndex((candidate) => candidate.id() === node.id()) === index);
    if (uniqueRoots.length === 0) {
      return null;
    }

    const parent = uniqueRoots[0]?.getParent();
    if (!isParentContainer(parent)) {
      return null;
    }

    if (!uniqueRoots.every((node) => node.getParent() === parent)) {
      return null;
    }

    const selectedIds = new Set<string>();
    uniqueRoots.forEach((root) => {
      const bundle = this.getOrderBundle(root);
      bundle.forEach((node) => {
        selectedIds.add(node.id());
      });
    });

    const orderedChildren = getImmediateOrderedChildren(parent);
    const units: Array<{ nodes: TOrderedNode[]; selected: boolean }> = [];
    const consumedIds = new Set<string>();

    orderedChildren.forEach((child) => {
      if (consumedIds.has(child.id())) {
        return;
      }

      const bundle = this.getOrderBundle(child);
      const nodes = sortNodesForBundle(bundle.filter((node) => node.getParent() === parent), parent);
      nodes.forEach((node) => {
        consumedIds.add(node.id());
      });
      units.push({
        nodes,
        selected: nodes.some((node) => selectedIds.has(node.id())),
      });
    });

    return { parent, units };
  }

  private applyUnitOrder(parent: TParentContainer, units: Array<{ nodes: TOrderedNode[] }>) {
    const orderedChildren = units.flatMap((unit) => unit.nodes);
    const before = this.snapshotParentOrder(parent);
    const patches = this.applyOrderedChildren(parent, orderedChildren, true);
    const after = this.snapshotParentOrder(parent);
    if (patches.length === 0) {
      return;
    }

    this.history.record({
      label: "render-order",
      undo: () => {
        this.applySnapshot(parent, before);
      },
      redo: () => {
        this.applySnapshot(parent, after);
      },
    });
  }

  private applySnapshot(parent: TParentContainer, snapshot: TRenderOrderSnapshot) {
    snapshot.items.forEach((item) => {
      const node = this.findImmediateChildById(parent, item.id);
      if (!node) {
        return;
      }

      txSetNodeZIndex({}, { node, zIndex: item.zIndex });
    });

    const orderedChildren = [...snapshot.items]
      .map((item) => this.findImmediateChildById(parent, item.id))
      .filter((node): node is TOrderedNode => Boolean(node));
    this.applyOrderedChildren(parent, orderedChildren, true);
  }

  private applyOrderedChildren(parent: TParentContainer, orderedChildren: TOrderedNode[], persist: boolean) {
    let persistedIndex = 0;
    orderedChildren.forEach((node, index) => {
      node.zIndex(index);
      if (node.id() === "") {
        return;
      }

      txSetNodeZIndex({}, { node, zIndex: fnCreateOrderedZIndex(persistedIndex) });
      persistedIndex += 1;
    });

    if (!persist) {
      return [];
    }

    const elementPatches: TElement[] = [];
    const groupPatches: TGroup[] = [];
    persistedIndex = 0;

    orderedChildren.forEach((node) => {
      if (node.id() === "") {
        return;
      }

      const zIndex = fnCreateOrderedZIndex(persistedIndex);
      persistedIndex += 1;

      const nodeType = this.canvasRegistry.getNodeType(node);
      if (nodeType === "group") {
        // Some flows insert runtime nodes before their first CRDT create commit.
        // Persist zIndex only after the group exists in the doc, otherwise
        // builder path patches would throw on a missing entity.
        if (this.crdt.doc().groups[node.id()] !== undefined) {
          groupPatches.push({
            id: node.id(),
            zIndex,
          } as TGroup);
        }
        return;
      }

      // Some flows insert runtime nodes before their first CRDT create commit.
      // Persist zIndex only after the element exists in the doc, otherwise
      // builder path patches would throw on a missing entity.
      if (nodeType !== null && this.crdt.doc().elements[node.id()] !== undefined) {
        elementPatches.push({
          id: node.id(),
          zIndex,
        } as TElement);
      }
    });

    if (elementPatches.length > 0 || groupPatches.length > 0) {
      const builder = this.crdt.build();

      elementPatches.forEach((element) => {
        builder.patchElement(element.id, "zIndex", element.zIndex);
      });

      groupPatches.forEach((group) => {
        builder.patchGroup(group.id, "zIndex", group.zIndex);
      });

      builder.commit();
    }

    this.syncDomOrder?.();
    return [...elementPatches, ...groupPatches];
  }

  private findImmediateChildById(parent: TParentContainer, id: string) {
    return getImmediateOrderedChildren(parent).find((node) => node.id() === id) ?? null;
  }

  private findParentBySnapshot(snapshot: TRenderOrderSnapshot) {
    if (snapshot.parentId === "__layer__") {
      return this.scene.staticForegroundLayer;
    }

    const parent = this.scene.staticForegroundLayer.findOne(`#${snapshot.parentId}`);
    return isParentContainer(parent) ? parent : null;
  }
}
