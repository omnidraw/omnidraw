import type {
  TCanvasDoc,
  TElement,
  TGroup,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TCanvasProductCloneIdentity } from "../../engine/product-runtime/typed";
import type { TCanvasTarget } from "../../semantic/typed";

export type TProductClonePlan = {
  elements: Array<{ sourceId: string; clone: TElement }>;
  groups: Array<{ sourceId: string; clone: TGroup }>;
  selection: TCanvasTarget[];
};

function fnHasSelectedGroupAncestor(args: {
  document: TCanvasDoc;
  parentGroupId: string | null;
  selectedGroupIds: ReadonlySet<string>;
}) {
  const visited = new Set<string>();
  let parentId = args.parentGroupId;
  while (parentId !== null && !visited.has(parentId)) {
    if (args.selectedGroupIds.has(parentId)) {
      return true;
    }
    visited.add(parentId);
    parentId = args.document.groups[parentId]?.parentGroupId ?? null;
  }
  return false;
}

export function fnPlanProductSubtreeClone(args: {
  document: TCanvasDoc;
  targets: readonly TCanvasTarget[];
  createId(): string;
  now: number;
}): TProductClonePlan {
  const selectedGroupIds = new Set(args.targets.flatMap((target) => {
    return target.kind === "group" ? [target.id] : [];
  }));
  const roots = args.targets.filter((target) => {
    const entity = target.kind === "group"
      ? args.document.groups[target.id]
      : args.document.elements[target.id];
    return entity !== undefined && !fnHasSelectedGroupAncestor({
      document: args.document,
      parentGroupId: entity.parentGroupId,
      selectedGroupIds,
    });
  });
  const groupIds = new Set<string>();
  const elementIds = new Set<string>();
  const visitGroup = (groupId: string) => {
    if (groupIds.has(groupId) || args.document.groups[groupId] === undefined) {
      return;
    }
    groupIds.add(groupId);
    Object.values(args.document.groups)
      .filter((group) => group.parentGroupId === groupId)
      .sort((left, right) => left.zIndex.localeCompare(right.zIndex))
      .forEach((group) => visitGroup(group.id));
    Object.values(args.document.elements)
      .filter((element) => element.parentGroupId === groupId)
      .forEach((element) => elementIds.add(element.id));
  };
  for (const root of roots) {
    if (root.kind === "group") {
      visitGroup(root.id);
    } else {
      elementIds.add(root.id);
    }
  }
  const groupIdMap = new Map([...groupIds].map((id) => [id, args.createId()]));
  const elementIdMap = new Map([...elementIds].map((id) => [id, args.createId()]));
  const groups = [...groupIds].map((sourceId) => {
    const source = args.document.groups[sourceId]!;
    return {
      sourceId,
      clone: {
        ...source,
        id: groupIdMap.get(sourceId)!,
        parentGroupId: source.parentGroupId === null
          ? null
          : groupIdMap.get(source.parentGroupId) ?? source.parentGroupId,
        createdAt: args.now,
      },
    };
  });
  const elements = [...elementIds].map((sourceId) => {
    const source = args.document.elements[sourceId]!;
    let data = { ...source.data } as TElement["data"];
    if (data.type === "line" || data.type === "arrow") {
      data = {
        ...data,
        startBinding: data.startBinding === null
          ? null
          : {
              ...data.startBinding,
              targetId: elementIdMap.get(data.startBinding.targetId)
                ?? data.startBinding.targetId,
            },
        endBinding: data.endBinding === null
          ? null
          : {
              ...data.endBinding,
              targetId: elementIdMap.get(data.endBinding.targetId)
                ?? data.endBinding.targetId,
            },
      };
    }
    return {
      sourceId,
      clone: {
        ...source,
        id: elementIdMap.get(sourceId)!,
        parentGroupId: source.parentGroupId === null
          ? null
          : groupIdMap.get(source.parentGroupId) ?? source.parentGroupId,
        createdAt: args.now,
        updatedAt: args.now,
        bindings: source.bindings.map((binding) => ({
          ...binding,
          targetId: elementIdMap.get(binding.targetId) ?? binding.targetId,
        })),
        data,
      },
    };
  });
  return {
    groups,
    elements,
    selection: roots.map((target) => ({
      kind: target.kind,
      id: target.kind === "group"
        ? groupIdMap.get(target.id)!
        : elementIdMap.get(target.id)!,
    })),
  };
}

export function fnProductCloneIdentity(
  plan: TProductClonePlan,
): TCanvasProductCloneIdentity {
  return {
    elements: plan.elements.map((entry) => ({
      sourceId: entry.sourceId,
      cloneId: entry.clone.id,
    })),
    groups: plan.groups.map((entry) => ({
      sourceId: entry.sourceId,
      cloneId: entry.clone.id,
    })),
    selection: plan.selection.map((target) => ({ ...target })),
  };
}
