import type {
  TCanvasDoc,
  TElement,
  TGroup,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { fnCreateOrderedZIndex } from "../../core/fn.create-ordered-z-index";
import { fnCanvasTargetKey } from "../../semantic/fn.target";
import type { TCanvasTarget } from "../../semantic/typed";
import { fnGetOrderedProductChildren } from "../render-order/fn.product-order";

export type TResolvedProductTarget =
  | {
      target: Extract<TCanvasTarget, { kind: "element" }>;
      entity: TElement;
    }
  | {
      target: Extract<TCanvasTarget, { kind: "group" }>;
      entity: TGroup;
    };

export type TUngroupProductPlan = {
  deletedGroupIds: string[];
  selectedTargets: TCanvasTarget[];
  elementPatches: Array<{
    id: string;
    parentGroupId: string | null;
    zIndex: string;
  }>;
  groupPatches: Array<{
    id: string;
    parentGroupId: string | null;
    zIndex: string;
  }>;
};

type TArgsResolveProductTargets = {
  document: TCanvasDoc;
  targets: readonly TCanvasTarget[];
};

type TArgsPlanUngroupProducts = {
  document: TCanvasDoc;
  groupIds: readonly string[];
};

type TArgsCollectDescendantElementIds = {
  document: TCanvasDoc;
  groupIds: readonly string[];
};

export function fnResolveProductTargets(
  args: TArgsResolveProductTargets,
): TResolvedProductTarget[] {
  const seen = new Set<string>();
  const resolved: TResolvedProductTarget[] = [];
  for (const target of args.targets) {
    const key = fnCanvasTargetKey(target);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (target.kind === "element") {
      const entity = args.document.elements[target.id];
      if (entity !== undefined) {
        resolved.push({ target: { ...target }, entity });
      }
    } else {
      const entity = args.document.groups[target.id];
      if (entity !== undefined) {
        resolved.push({ target: { ...target }, entity });
      }
    }
  }
  return resolved;
}

export function fnPlanUngroupProducts(
  args: TArgsPlanUngroupProducts,
): TUngroupProductPlan {
  const selectedGroupIds = new Set(args.groupIds.filter((id) => {
    return args.document.groups[id] !== undefined;
  }));
  const rootGroupIds = [...selectedGroupIds].filter((id) => {
    const parentId = args.document.groups[id]?.parentGroupId ?? null;
    return parentId === null || !selectedGroupIds.has(parentId);
  });
  const elementPatches = new Map<string, {
    id: string;
    parentGroupId: string | null;
    zIndex: string;
  }>();
  const groupPatches = new Map<string, {
    id: string;
    parentGroupId: string | null;
    zIndex: string;
  }>();
  const selectedTargets: TCanvasTarget[] = [];
  let valid = true;

  const expand = (
    target: TCanvasTarget,
    ancestry: ReadonlySet<string> = new Set(),
  ): TCanvasTarget[] => {
    if (target.kind !== "group" || !selectedGroupIds.has(target.id)) {
      return [target];
    }
    if (ancestry.has(target.id)) {
      valid = false;
      return [];
    }
    const nextAncestry = new Set(ancestry);
    nextAncestry.add(target.id);
    return fnGetOrderedProductChildren({
      document: args.document,
      parentGroupId: target.id,
    }).flatMap((child) => expand(child.target, nextAncestry));
  };

  if (selectedGroupIds.size > 0 && rootGroupIds.length === 0) {
    valid = false;
  }
  const affectedParentIds = new Set(rootGroupIds.map((id) => {
    return args.document.groups[id]?.parentGroupId ?? null;
  }));
  for (const parentGroupId of affectedParentIds) {
    const ordered = fnGetOrderedProductChildren({
      document: args.document,
      parentGroupId,
    }).flatMap((child) => expand(child.target));
    ordered.forEach((target, index) => {
      const patch = {
        id: target.id,
        parentGroupId,
        zIndex: fnCreateOrderedZIndex(index),
      };
      if (target.kind === "element") {
        elementPatches.set(target.id, patch);
      } else {
        groupPatches.set(target.id, patch);
      }
    });
    for (const groupId of rootGroupIds) {
      if (
        (args.document.groups[groupId]?.parentGroupId ?? null)
        === parentGroupId
      ) {
        selectedTargets.push(...expand({ kind: "group", id: groupId }));
      }
    }
  }

  if (!valid) {
    return {
      deletedGroupIds: [],
      selectedTargets: [],
      elementPatches: [],
      groupPatches: [],
    };
  }
  return {
    deletedGroupIds: [...selectedGroupIds].sort(),
    selectedTargets,
    elementPatches: [...elementPatches.values()],
    groupPatches: [...groupPatches.values()],
  };
}

export function fnCollectDescendantElementIds(
  args: TArgsCollectDescendantElementIds,
): string[] {
  const pending = [...new Set(args.groupIds)];
  const visitedGroups = new Set<string>();
  const elementIds = new Set<string>();
  while (pending.length > 0) {
    const groupId = pending.shift()!;
    if (visitedGroups.has(groupId) || args.document.groups[groupId] === undefined) {
      continue;
    }
    visitedGroups.add(groupId);
    for (const element of Object.values(args.document.elements)) {
      if (element.parentGroupId === groupId) {
        elementIds.add(element.id);
      }
    }
    for (const group of Object.values(args.document.groups)) {
      if (group.parentGroupId === groupId) {
        pending.push(group.id);
      }
    }
  }
  return [...elementIds].sort();
}
