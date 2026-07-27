import type {
  IService,
  IStartableService,
} from "@vibecanvas/runtime";
import type { IServiceContext } from "@vibecanvas/runtime/interface.js";
import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { fnCanvasTargetKey } from "../../semantic/fn.target";
import type { TCanvasTarget } from "../../semantic/typed";
import { fnCreateOrderedZIndex } from "../../core/fn.create-ordered-z-index";
import type { IRuntimeConfig, IRuntimeHooks } from "../../types";
import type { ContextMenuService } from "../context-menu/ContextMenuService";
import type { CrdtService } from "../crdt/CrdtService";
import type { HistoryService } from "../history/HistoryService";
import {
  fnGetOrderedProductChildren,
  fnGetProductTargetParentId,
  fnInsertProductTargets,
  fnTargetsShareProductParent,
} from "./fn.product-order";
import type {
  TProductRenderOrderBundleResolver,
  TProductRenderOrderInsertPosition,
  TProductRenderOrderSnapshot,
} from "./typed";

export type TRenderOrderServiceArgs = {
  crdt: CrdtService;
  history: HistoryService;
  contextMenu: ContextMenuService;
};

type TOrderedUnit = {
  targets: TCanvasTarget[];
  selected: boolean;
};

/**
 * Owns durable product ordering. Engine order is projection output only.
 */
export class RenderOrderService
implements IService<Record<string, never>>, IStartableService {
  readonly name = "renderOrder";
  readonly hooks = {};
  readonly crdt: CrdtService;
  readonly history: HistoryService;
  readonly contextMenu: ContextMenuService;
  readonly #bundleResolvers = new Map<
    string,
    TProductRenderOrderBundleResolver
  >();

  constructor(args: TRenderOrderServiceArgs) {
    this.crdt = args.crdt;
    this.history = args.history;
    this.contextMenu = args.contextMenu;
  }

  start(ctx: IServiceContext<IRuntimeHooks, IRuntimeConfig>): void {
    this.contextMenu.registerProvider("render-order", ({
      scope,
      activeSelection,
    }) => {
      const document = this.crdt.doc();
      const disabled = activeSelection.length === 0
        || !fnTargetsShareProductParent({
          document,
          targets: activeSelection,
        });
      if (scope === "canvas") {
        return [];
      }
      return [
        {
          id: "render-order-bring-to-front",
          label: "Bring to front",
          disabled,
          priority: 100,
          onSelect: () => {
            this.bringSelectionToFront(activeSelection);
          },
        },
        {
          id: "render-order-move-forward",
          label: "Move forward",
          disabled,
          priority: 110,
          onSelect: () => {
            this.moveSelectionUp(activeSelection);
          },
        },
        {
          id: "render-order-move-backward",
          label: "Move backward",
          disabled,
          priority: 120,
          onSelect: () => {
            this.moveSelectionDown(activeSelection);
          },
        },
        {
          id: "render-order-send-to-back",
          label: "Send to back",
          disabled,
          priority: 130,
          onSelect: () => {
            this.sendSelectionToBack(activeSelection);
          },
        },
      ];
    });
    ctx.hooks.destroy.tap(() => {
      this.contextMenu.unregisterProvider("render-order");
      this.clearBundleResolvers();
    });
  }

  registerBundleResolver(
    id: string,
    resolver: TProductRenderOrderBundleResolver,
  ): () => void {
    this.#bundleResolvers.set(id, resolver);
    return () => this.unregisterBundleResolver(id);
  }

  unregisterBundleResolver(id: string): void {
    this.#bundleResolvers.delete(id);
  }

  clearBundleResolvers(): void {
    this.#bundleResolvers.clear();
  }

  getOrderBundle(
    target: TCanvasTarget,
    document: TCanvasDoc = this.crdt.doc(),
  ): TCanvasTarget[] {
    for (const resolver of this.#bundleResolvers.values()) {
      const bundle = resolver(target, document);
      if (bundle !== null && bundle.length > 0) {
        return [...bundle];
      }
    }
    return [{ ...target }];
  }

  getOrderedSiblings(
    parentGroupId: string | null,
    document: TCanvasDoc = this.crdt.doc(),
  ) {
    return fnGetOrderedProductChildren({ document, parentGroupId });
  }

  snapshotParentOrder(
    parentGroupId: string | null,
    document: TCanvasDoc = this.crdt.doc(),
  ): TProductRenderOrderSnapshot {
    return {
      parentGroupId,
      items: this.getOrderedSiblings(parentGroupId, document).map((item) => ({
        target: { ...item.target },
        zIndex: item.zIndex,
      })),
    };
  }

  restoreParentOrder(snapshot: TProductRenderOrderSnapshot): boolean {
    const document = this.crdt.doc();
    const validItems = snapshot.items.filter((item) => {
      return fnGetProductTargetParentId({
        document,
        target: item.target,
      }) === snapshot.parentGroupId;
    });
    if (validItems.length === 0) {
      return false;
    }
    const builder = this.crdt.build();
    for (const item of validItems) {
      if (item.target.kind === "element") {
        builder.patchElement(item.target.id, "zIndex", item.zIndex);
      } else {
        builder.patchGroup(item.target.id, "zIndex", item.zIndex);
      }
    }
    builder.commit();
    return true;
  }

  assignOrderOnInsert(args: {
    parentGroupId: string | null;
    targets: readonly TCanvasTarget[];
    position?: TProductRenderOrderInsertPosition;
  }) {
    const document = this.crdt.doc();
    const moving = args.targets.filter((target) => {
      return fnGetProductTargetParentId({ document, target })
        === args.parentGroupId;
    });
    if (moving.length === 0) {
      return [];
    }
    const ordered = this.getOrderedSiblings(
      args.parentGroupId,
      document,
    ).map((item) => item.target);
    const movingKeys = new Set(moving.map(fnCanvasTargetKey));
    const stationary = ordered.filter((target) => {
      return !movingKeys.has(fnCanvasTargetKey(target));
    });
    const next = fnInsertProductTargets({
      stationary,
      moving,
      position: args.position ?? "front",
    });
    return this.#applyTargetOrder(args.parentGroupId, next, false, true);
  }

  moveSelectionUp(targets: readonly TCanvasTarget[]): boolean {
    return this.#moveByOneStep(targets, "forward");
  }

  moveSelectionDown(targets: readonly TCanvasTarget[]): boolean {
    return this.#moveByOneStep(targets, "backward");
  }

  bringSelectionToFront(targets: readonly TCanvasTarget[]): boolean {
    return this.#moveToExtreme(targets, "front");
  }

  sendSelectionToBack(targets: readonly TCanvasTarget[]): boolean {
    return this.#moveToExtreme(targets, "back");
  }

  #moveByOneStep(
    roots: readonly TCanvasTarget[],
    direction: "forward" | "backward",
  ): boolean {
    const resolved = this.#resolveOrderedUnits(roots);
    if (resolved === null) {
      return false;
    }
    const units = [...resolved.units];
    if (direction === "forward") {
      for (let index = units.length - 2; index >= 0; index -= 1) {
        if (!units[index]!.selected && units[index + 1]!.selected) {
          [units[index], units[index + 1]] = [
            units[index + 1]!,
            units[index]!,
          ];
        }
      }
    } else {
      for (let index = 1; index < units.length; index += 1) {
        if (units[index]!.selected && !units[index - 1]!.selected) {
          [units[index], units[index - 1]] = [
            units[index - 1]!,
            units[index]!,
          ];
        }
      }
    }
    return this.#applyTargetOrder(
      resolved.parentGroupId,
      units.flatMap((unit) => unit.targets),
      true,
    ).length > 0;
  }

  #moveToExtreme(
    roots: readonly TCanvasTarget[],
    position: "front" | "back",
  ): boolean {
    const resolved = this.#resolveOrderedUnits(roots);
    if (resolved === null) {
      return false;
    }
    const selected = resolved.units.filter((unit) => unit.selected);
    const unselected = resolved.units.filter((unit) => !unit.selected);
    const units = position === "front"
      ? [...unselected, ...selected]
      : [...selected, ...unselected];
    return this.#applyTargetOrder(
      resolved.parentGroupId,
      units.flatMap((unit) => unit.targets),
      true,
    ).length > 0;
  }

  #resolveOrderedUnits(roots: readonly TCanvasTarget[]): {
    parentGroupId: string | null;
    units: TOrderedUnit[];
  } | null {
    const document = this.crdt.doc();
    const uniqueRoots = roots.filter((target, index) => {
      const key = fnCanvasTargetKey(target);
      return roots.findIndex((candidate) => {
        return fnCanvasTargetKey(candidate) === key;
      }) === index;
    });
    if (
      uniqueRoots.length === 0
      || !fnTargetsShareProductParent({
        document,
        targets: uniqueRoots,
      })
    ) {
      return null;
    }
    const parentGroupId = fnGetProductTargetParentId({
      document,
      target: uniqueRoots[0]!,
    });
    if (parentGroupId === undefined) {
      return null;
    }
    const selectedKeys = new Set<string>();
    for (const root of uniqueRoots) {
      for (const target of this.getOrderBundle(root, document)) {
        selectedKeys.add(fnCanvasTargetKey(target));
      }
    }

    const children = this.getOrderedSiblings(
      parentGroupId,
      document,
    ).map((item) => item.target);
    const childKeys = new Set(children.map(fnCanvasTargetKey));
    const consumed = new Set<string>();
    const units: TOrderedUnit[] = [];
    for (const child of children) {
      const childKey = fnCanvasTargetKey(child);
      if (consumed.has(childKey)) {
        continue;
      }
      const bundle = this.getOrderBundle(child, document).filter((target) => {
        return childKeys.has(fnCanvasTargetKey(target))
          && fnGetProductTargetParentId({ document, target }) === parentGroupId;
      });
      const targets = bundle.length > 0 ? bundle : [child];
      for (const target of targets) {
        consumed.add(fnCanvasTargetKey(target));
      }
      units.push({
        targets,
        selected: targets.some((target) => {
          return selectedKeys.has(fnCanvasTargetKey(target));
        }),
      });
    }
    return { parentGroupId, units };
  }

  #applyTargetOrder(
    parentGroupId: string | null,
    orderedTargets: readonly TCanvasTarget[],
    recordHistory: boolean,
    force = false,
  ): Array<{ target: TCanvasTarget; zIndex: string }> {
    const before = this.snapshotParentOrder(parentGroupId);
    const beforeKeys = before.items.map((item) => fnCanvasTargetKey(item.target));
    const nextKeys = orderedTargets.map(fnCanvasTargetKey);
    if (
      !force
      &&
      beforeKeys.length === nextKeys.length
      && beforeKeys.every((key, index) => key === nextKeys[index])
    ) {
      return [];
    }

    const patches = orderedTargets.map((target, index) => ({
      target: { ...target },
      zIndex: fnCreateOrderedZIndex(index),
    }));
    const builder = this.crdt.build();
    for (const patch of patches) {
      if (patch.target.kind === "element") {
        builder.patchElement(patch.target.id, "zIndex", patch.zIndex);
      } else {
        builder.patchGroup(patch.target.id, "zIndex", patch.zIndex);
      }
    }
    const commit = builder.commit();
    if (recordHistory) {
      this.history.record({
        label: "render-order",
        undo: () => {
          this.crdt.applyOps({ ops: commit.undoOps });
        },
        redo: () => {
          this.crdt.applyOps({ ops: commit.redoOps });
        },
      });
    }
    return patches;
  }
}
