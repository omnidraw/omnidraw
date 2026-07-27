import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { fnCanvasTargetKey } from "../../semantic/fn.target";
import type { TCanvasTarget } from "../../semantic/typed";
import type { TProductRenderOrderInsertPosition } from "./typed";

export type TOrderedProductChild = {
  target: TCanvasTarget;
  parentGroupId: string | null;
  zIndex: string;
};

type TArgsGetOrderedProductChildren = {
  document: TCanvasDoc;
  parentGroupId: string | null;
};

type TArgsGetProductTargetParentId = {
  document: TCanvasDoc;
  target: TCanvasTarget;
};

type TArgsTargetsShareProductParent = {
  document: TCanvasDoc;
  targets: readonly TCanvasTarget[];
};

type TArgsInsertProductTargets = {
  stationary: readonly TCanvasTarget[];
  moving: readonly TCanvasTarget[];
  position: TProductRenderOrderInsertPosition;
};

export function fnGetOrderedProductChildren(
  args: TArgsGetOrderedProductChildren,
): TOrderedProductChild[] {
  const children: TOrderedProductChild[] = [];
  for (const element of Object.values(args.document.elements)) {
    if (element.parentGroupId === args.parentGroupId) {
      children.push({
        target: { kind: "element", id: element.id },
        parentGroupId: element.parentGroupId,
        zIndex: element.zIndex,
      });
    }
  }
  for (const group of Object.values(args.document.groups)) {
    if (group.parentGroupId === args.parentGroupId) {
      children.push({
        target: { kind: "group", id: group.id },
        parentGroupId: group.parentGroupId,
        zIndex: group.zIndex,
      });
    }
  }
  return children.sort((left, right) => {
    return left.zIndex.localeCompare(right.zIndex)
      || fnCanvasTargetKey(left.target).localeCompare(
        fnCanvasTargetKey(right.target),
      );
  });
}

export function fnGetProductTargetParentId(
  args: TArgsGetProductTargetParentId,
): string | null | undefined {
  return args.target.kind === "element"
    ? args.document.elements[args.target.id]?.parentGroupId
    : args.document.groups[args.target.id]?.parentGroupId;
}

export function fnTargetsShareProductParent(
  args: TArgsTargetsShareProductParent,
): boolean {
  if (args.targets.length === 0) {
    return false;
  }
  const parent = fnGetProductTargetParentId({
    document: args.document,
    target: args.targets[0]!,
  });
  return parent !== undefined && args.targets.every((target) => {
    return fnGetProductTargetParentId({
      document: args.document,
      target,
    }) === parent;
  });
}

export function fnInsertProductTargets(
  args: TArgsInsertProductTargets,
): TCanvasTarget[] {
  if (args.position === "back") {
    return [...args.moving, ...args.stationary];
  }
  if (args.position === "front") {
    return [...args.stationary, ...args.moving];
  }
  const afterKey = args.position.after === undefined
    ? null
    : fnCanvasTargetKey(args.position.after);
  if (afterKey !== null) {
    const index = args.stationary.findIndex((target) => {
      return fnCanvasTargetKey(target) === afterKey;
    });
    if (index >= 0) {
      return [
        ...args.stationary.slice(0, index + 1),
        ...args.moving,
        ...args.stationary.slice(index + 1),
      ];
    }
  }
  const beforeKey = args.position.before === undefined
    ? null
    : fnCanvasTargetKey(args.position.before);
  if (beforeKey !== null) {
    const index = args.stationary.findIndex((target) => {
      return fnCanvasTargetKey(target) === beforeKey;
    });
    if (index >= 0) {
      return [
        ...args.stationary.slice(0, index),
        ...args.moving,
        ...args.stationary.slice(index),
      ];
    }
  }
  return [...args.stationary, ...args.moving];
}
