import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TCanvasTarget } from "../../semantic/typed";
import { fnUniqueCanvasTargets } from "../../semantic/fn.target";

type TArgsCollectDeleteTargets = {
  document: TCanvasDoc;
  targets: readonly TCanvasTarget[];
};

function parentGroupId(
  canvasDoc: TCanvasDoc,
  target: TCanvasTarget,
): string | null | undefined {
  return target.kind === "element"
    ? canvasDoc.elements[target.id]?.parentGroupId
    : canvasDoc.groups[target.id]?.parentGroupId;
}

function hasSelectedAncestor(
  canvasDoc: TCanvasDoc,
  target: TCanvasTarget,
  selectedGroupIds: ReadonlySet<string>,
): boolean {
  let parentId = parentGroupId(canvasDoc, target);
  const visited = new Set<string>();
  while (parentId !== null && parentId !== undefined) {
    if (selectedGroupIds.has(parentId)) {
      return true;
    }
    if (visited.has(parentId)) {
      return false;
    }
    visited.add(parentId);
    parentId = canvasDoc.groups[parentId]?.parentGroupId;
  }
  return false;
}

export function fnCollectDeleteTargets(
  args: TArgsCollectDeleteTargets,
): TCanvasTarget[] {
  const existing = fnUniqueCanvasTargets(args.targets).filter((target) => {
    return target.kind === "element"
      ? args.document.elements[target.id] !== undefined
      : args.document.groups[target.id] !== undefined;
  });
  const selectedGroupIds = new Set(existing.flatMap((target) => {
    return target.kind === "group" ? [target.id] : [];
  }));
  const roots = existing.filter((target) => {
    return !hasSelectedAncestor(args.document, target, selectedGroupIds);
  });
  const result: TCanvasTarget[] = [];
  const visitedGroups = new Set<string>();

  const visitGroup = (groupId: string) => {
    if (visitedGroups.has(groupId)) {
      return;
    }
    visitedGroups.add(groupId);
    Object.values(args.document.groups)
      .filter((group) => group.parentGroupId === groupId)
      .sort((left, right) => left.id.localeCompare(right.id))
      .forEach((group) => visitGroup(group.id));
    Object.values(args.document.elements)
      .filter((element) => element.parentGroupId === groupId)
      .sort((left, right) => left.id.localeCompare(right.id))
      .forEach((element) => {
        result.push({ kind: "element", id: element.id });
      });
    result.push({ kind: "group", id: groupId });
  };

  for (const root of roots) {
    if (root.kind === "group") {
      visitGroup(root.id);
    } else {
      result.push({ ...root });
    }
  }
  return fnUniqueCanvasTargets(result);
}
