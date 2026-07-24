import type {
  CrdtService,
  ElementService,
  HistoryService,
  RenderOrderService,
  SelectionService,
} from "../../services";
import type { TCanvasTarget } from "../../semantic/typed";
import { fnCollectDeleteTargets } from "./fn.delete-targets";

export type TPortalDeleteSelection = {
  crdt: CrdtService;
  element: ElementService;
  history: HistoryService;
  renderOrder: RenderOrderService;
  selection: SelectionService;
};

export type TArgsDeleteSelection = {
  recordHistory?: boolean;
  selection?: readonly TCanvasTarget[];
};

function queueTargetDeletes(
  portal: Pick<TPortalDeleteSelection, "crdt" | "element">,
  targets: readonly TCanvasTarget[],
) {
  const canvasDoc = portal.crdt.doc();
  const builder = portal.crdt.build();
  for (const target of targets) {
    if (target.kind === "element") {
      const entity = canvasDoc.elements[target.id];
      if (entity !== undefined) {
        portal.element.deleteElement(entity, builder);
      }
    } else if (canvasDoc.groups[target.id] !== undefined) {
      builder.deleteGroup(target.id);
    }
  }
  return builder;
}

export function txDeleteSelection(
  portal: TPortalDeleteSelection,
  args: TArgsDeleteSelection,
): boolean {
  const canvasDoc = portal.crdt.doc();
  const roots = args.selection ?? portal.selection.selection;
  const bundled = roots.flatMap((target) => {
    return portal.renderOrder.getOrderBundle(target, canvasDoc);
  });
  const targets = fnCollectDeleteTargets({
    document: canvasDoc,
    targets: bundled,
  });
  if (targets.length === 0) {
    return false;
  }

  let activeCommit = queueTargetDeletes(portal, targets).commit();
  portal.selection.clear();

  if (args.recordHistory !== false) {
    const selectedRoots = roots.map((target) => ({ ...target }));
    portal.history.record({
      label: `Delete ${selectedRoots.length} ${
        selectedRoots.length === 1 ? "item" : "items"
      }`,
      undo: () => {
        activeCommit.rollback();
        portal.selection.setSelection(selectedRoots);
        portal.selection.setFocusedTarget(selectedRoots.at(-1) ?? null);
      },
      redo: () => {
        activeCommit = queueTargetDeletes(portal, targets).commit();
        portal.selection.clear();
      },
    });
  }
  return true;
}
