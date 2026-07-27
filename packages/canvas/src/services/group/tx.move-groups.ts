import type { CrdtService } from "../crdt/CrdtService";
import type { HistoryService } from "../history/HistoryService";
import { fnCollectDescendantElementIds } from "./fn.product-groups";
import type { TGroupMoveArgs } from "./types";

export type TPortalMoveGroups = {
  crdt: CrdtService;
  history: HistoryService;
  now(): number;
};

export type TArgsMoveGroups = TGroupMoveArgs;

export function txMoveGroups(
  portal: TPortalMoveGroups,
  args: TArgsMoveGroups,
): readonly string[] {
  if (args.delta.x === 0 && args.delta.y === 0) {
    return [];
  }
  const document = portal.crdt.doc();
  const elementIds = fnCollectDescendantElementIds({
    document,
    groupIds: args.groupIds,
  });
  if (elementIds.length === 0) {
    return [];
  }
  const updatedAt = portal.now();
  const builder = portal.crdt.build();
  for (const elementId of elementIds) {
    const element = document.elements[elementId]!;
    builder.patchElement(elementId, "x", element.x + args.delta.x);
    builder.patchElement(elementId, "y", element.y + args.delta.y);
    builder.patchElement(elementId, "updatedAt", updatedAt);
  }
  const commit = builder.commit();
  portal.history.record({
    label: "group-move",
    undo: () => {
      portal.crdt.applyOps({ ops: commit.undoOps });
    },
    redo: () => {
      portal.crdt.applyOps({ ops: commit.redoOps });
    },
  });
  return elementIds;
}
