import type { TCanvasTarget } from "../../semantic/typed";
import type { CrdtService } from "../crdt/CrdtService";
import type { HistoryService } from "../history/HistoryService";
import type { SelectionService } from "../selection/SelectionService";
import { fnPlanUngroupProducts } from "./fn.product-groups";

export type TPortalUngroupSelection = {
  crdt: CrdtService;
  history: HistoryService;
  selection: SelectionService;
};

export type TArgsUngroupSelection = {
  targets: readonly TCanvasTarget[];
};

export function txUngroupSelection(
  portal: TPortalUngroupSelection,
  args: TArgsUngroupSelection,
): TCanvasTarget[] {
  const groupIds = args.targets
    .filter((target): target is Extract<TCanvasTarget, { kind: "group" }> => {
      return target.kind === "group";
    })
    .map((target) => target.id);
  const plan = fnPlanUngroupProducts({
    document: portal.crdt.doc(),
    groupIds,
  });
  if (plan.deletedGroupIds.length === 0) {
    return [];
  }
  const originalTargets = args.targets.map((target) => ({ ...target }));
  const builder = portal.crdt.build();
  for (const patch of plan.elementPatches) {
    builder.patchElement(patch.id, "parentGroupId", patch.parentGroupId);
    builder.patchElement(patch.id, "zIndex", patch.zIndex);
  }
  for (const patch of plan.groupPatches) {
    builder.patchGroup(patch.id, "parentGroupId", patch.parentGroupId);
    builder.patchGroup(patch.id, "zIndex", patch.zIndex);
  }
  for (const groupId of plan.deletedGroupIds) {
    builder.deleteGroup(groupId);
  }
  const commit = builder.commit();
  portal.selection.setSelection(plan.selectedTargets);
  portal.selection.setFocusedTarget(plan.selectedTargets.at(-1) ?? null);
  portal.history.record({
    label: "ungroup",
    undo: () => {
      portal.crdt.applyOps({ ops: commit.undoOps });
      portal.selection.setSelection(originalTargets);
      portal.selection.setFocusedTarget(originalTargets.at(-1) ?? null);
    },
    redo: () => {
      portal.crdt.applyOps({ ops: commit.redoOps });
      portal.selection.setSelection(plan.selectedTargets);
      portal.selection.setFocusedTarget(plan.selectedTargets.at(-1) ?? null);
    },
  });
  return plan.selectedTargets;
}
