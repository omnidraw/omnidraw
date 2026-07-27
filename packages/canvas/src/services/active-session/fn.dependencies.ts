import type {
  TCanvasDoc,
  TElement,
  TGroup,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TCanvasTarget } from "../../semantic/typed";
import type {
  TCanvasActiveSessionDependencies,
  TCanvasElementDependencyField,
  TCanvasGroupDependencyField,
} from "./typed";

type TArgs = {
  document: TCanvasDoc;
  targets: readonly TCanvasTarget[];
  elementFields: readonly TCanvasElementDependencyField[];
  groupFields: readonly TCanvasGroupDependencyField[];
  includeGroupDescendants?: boolean;
};

function fnAddAncestorGroups(
  canvasDoc: TCanvasDoc,
  groupId: string | null,
  groupIds: Set<string>,
): void {
  const visited = new Set<string>();
  let currentId = groupId;
  while (currentId !== null && !visited.has(currentId)) {
    visited.add(currentId);
    const group = canvasDoc.groups[currentId];
    if (group === undefined) {
      return;
    }
    groupIds.add(currentId);
    currentId = group.parentGroupId;
  }
}

function fnCollectGroupSubtree(
  canvasDoc: TCanvasDoc,
  rootId: string,
  elementIds: Set<string>,
  groupIds: Set<string>,
): void {
  const pending = [rootId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const groupId = pending.shift()!;
    if (visited.has(groupId) || canvasDoc.groups[groupId] === undefined) {
      continue;
    }
    visited.add(groupId);
    groupIds.add(groupId);
    for (const element of Object.values(canvasDoc.elements)) {
      if (element.parentGroupId === groupId) {
        elementIds.add(element.id);
      }
    }
    for (const group of Object.values(canvasDoc.groups)) {
      if (group.parentGroupId === groupId) {
        pending.push(group.id);
      }
    }
  }
}

function fnDependencyRecord<TField extends keyof TElement | keyof TGroup | "*">(
  ids: ReadonlySet<string>,
  fields: readonly TField[],
): Readonly<Record<string, readonly TField[]>> {
  return Object.fromEntries(
    [...ids].sort().map((id) => [id, [...fields]]),
  );
}

export function fnCanvasActiveSessionDependencies(
  args: TArgs,
): TCanvasActiveSessionDependencies {
  const elementIds = new Set<string>();
  const groupIds = new Set<string>();

  for (const target of args.targets) {
    if (target.kind === "element") {
      const element = args.document.elements[target.id];
      if (element === undefined) {
        continue;
      }
      elementIds.add(element.id);
      fnAddAncestorGroups(
        args.document,
        element.parentGroupId,
        groupIds,
      );
      continue;
    }

    const group = args.document.groups[target.id];
    if (group === undefined) {
      continue;
    }
    fnAddAncestorGroups(args.document, group.parentGroupId, groupIds);
    if (args.includeGroupDescendants === true) {
      fnCollectGroupSubtree(
        args.document,
        group.id,
        elementIds,
        groupIds,
      );
    } else {
      groupIds.add(group.id);
    }
  }

  for (const elementId of elementIds) {
    fnAddAncestorGroups(
      args.document,
      args.document.elements[elementId]?.parentGroupId ?? null,
      groupIds,
    );
  }

  return {
    elements: fnDependencyRecord(elementIds, args.elementFields),
    groups: fnDependencyRecord(groupIds, args.groupFields),
  };
}
