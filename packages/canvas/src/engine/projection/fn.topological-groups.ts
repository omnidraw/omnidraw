import type { TGroup } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TCanvasProjectionDiagnostic } from "../typed";
import type { TCanvasTopologicalGroupResult } from "./typed";

type TArgsTopologicalGroups = {
  groups: readonly TGroup[];
};

function compareGroups(left: TGroup, right: TGroup): number {
  return left.zIndex.localeCompare(right.zIndex) || left.id.localeCompare(right.id);
}

export function fnTopologicallyOrderCanvasGroups(
  args: TArgsTopologicalGroups,
): TCanvasTopologicalGroupResult {
  const diagnostics: TCanvasProjectionDiagnostic[] = [];
  const groupsById = new Map<string, TGroup>();
  const duplicateIds = new Set<string>();

  for (const group of [...args.groups].sort(compareGroups)) {
    if (groupsById.has(group.id)) {
      duplicateIds.add(group.id);
      continue;
    }
    groupsById.set(group.id, group);
  }
  for (const id of [...duplicateIds].sort()) {
    diagnostics.push({
      code: "DUPLICATE_GROUP_ID",
      message: `Duplicate product group ID '${id}'.`,
      target: { kind: "group", id },
    });
  }

  const state = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];
  const cyclicIds = new Set<string>();
  const reportedCycles = new Set<string>();
  const ordered: TGroup[] = [];

  const visit = (group: TGroup): void => {
    const currentState = state.get(group.id);
    if (currentState === "visited") {
      return;
    }
    if (currentState === "visiting") {
      const cycleStart = Math.max(0, stack.indexOf(group.id));
      const cycle = stack.slice(cycleStart);
      for (const id of cycle) {
        cyclicIds.add(id);
      }
      const cycleKey = [...cycle].sort().join("\u0000");
      if (!reportedCycles.has(cycleKey)) {
        reportedCycles.add(cycleKey);
        diagnostics.push({
          code: "GROUP_CYCLE",
          message: `Product group cycle detected: ${cycle.join(" -> ")} -> ${group.id}.`,
          target: { kind: "group", id: group.id },
        });
      }
      return;
    }

    state.set(group.id, "visiting");
    stack.push(group.id);
    const parentId = group.parentGroupId;
    if (parentId !== null) {
      const parent = groupsById.get(parentId);
      if (parent) {
        visit(parent);
      } else {
        diagnostics.push({
          code: "GROUP_PARENT_MISSING",
          message: `Group '${group.id}' references missing parent '${parentId}'.`,
          target: { kind: "group", id: group.id },
        });
      }
    }
    stack.pop();
    state.set(group.id, "visited");
    ordered.push(group);
  };

  for (const group of [...groupsById.values()].sort(compareGroups)) {
    visit(group);
  }

  const resolvedParentGroupIds = Object.fromEntries(
    [...groupsById.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((group) => {
        const parentId = group.parentGroupId;
        const resolved = cyclicIds.has(group.id)
          || parentId === null
          || !groupsById.has(parentId)
          ? null
          : parentId;
        return [group.id, resolved] as const;
      }),
  );

  return {
    groups: ordered,
    resolvedParentGroupIds,
    diagnostics,
  };
}
