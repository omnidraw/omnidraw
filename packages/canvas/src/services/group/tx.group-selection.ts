import type { TGroup } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TCanvasTarget } from "../../semantic/typed";
import type { CrdtService } from "../crdt/CrdtService";
import type { HistoryService } from "../history/HistoryService";
import type { SelectionService } from "../selection/SelectionService";
import { fnResolveProductTargets } from "./fn.product-groups";

export type TPortalGroupSelection = {
  crdt: CrdtService;
  history: HistoryService;
  selection: SelectionService;
  createId(): string;
  now(): number;
};

export type TArgsGroupSelection = {
  targets: readonly TCanvasTarget[];
};

export function txGroupSelection(
  portal: TPortalGroupSelection,
  args: TArgsGroupSelection,
): TGroup | null {
  const document = portal.crdt.doc();
  const resolved = fnResolveProductTargets({
    document,
    targets: args.targets,
  });
  if (resolved.length < 2) {
    return null;
  }
  const parentGroupId = resolved[0]!.entity.parentGroupId;
  if (!resolved.every((target) => {
    return target.entity.parentGroupId === parentGroupId;
  })) {
    return null;
  }
  const id = portal.createId();
  if (document.groups[id] !== undefined || document.elements[id] !== undefined) {
    throw new TypeError(`Cannot create duplicate canvas group '${id}'.`);
  }
  const zIndex = [...resolved]
    .sort((left, right) => {
      return left.entity.zIndex.localeCompare(right.entity.zIndex);
    })
    .at(-1)!.entity.zIndex;
  const group: TGroup = {
    id,
    parentGroupId,
    zIndex,
    locked: false,
    createdAt: portal.now(),
  };
  const originalTargets = resolved.map((item) => ({ ...item.target }));
  const builder = portal.crdt.build();
  builder.patchGroup(group.id, group);
  for (const item of resolved) {
    if (item.target.kind === "element") {
      builder.patchElement(item.target.id, "parentGroupId", group.id);
    } else {
      builder.patchGroup(item.target.id, "parentGroupId", group.id);
    }
  }
  const commit = builder.commit();
  const groupTarget = { kind: "group", id: group.id } as const;
  portal.selection.setSelection([groupTarget]);
  portal.selection.setFocusedTarget(groupTarget);
  portal.history.record({
    label: "group",
    undo: () => {
      portal.crdt.applyOps({ ops: commit.undoOps });
      portal.selection.setSelection(originalTargets);
      portal.selection.setFocusedTarget(originalTargets.at(-1) ?? null);
    },
    redo: () => {
      portal.crdt.applyOps({ ops: commit.redoOps });
      portal.selection.setSelection([groupTarget]);
      portal.selection.setFocusedTarget(groupTarget);
    },
  });
  return group;
}
