import type { SceneService } from "../../services/scene/SceneService";
import type { SelectionService } from "../../services/selection/SelectionService";
import type { TElementPointerEvent } from "../../types";
import { fnGetSelectionPath } from "./fn.get-selection-path";

export type TPortalHandleElementPointerDoubleClick = {
  scene: SceneService;
  selection: SelectionService;
  hasSameSelectionOrder: (
    currentSelection: Array<{ id(): string }>,
    nextSelection: Array<{ id(): string }>,
  ) => boolean;
};

export type TArgsHandleElementPointerDoubleClick = {
  event: TElementPointerEvent;
};

function isSelectionPathPrefix(
  currentSelection: Array<{ id(): string }>,
  path: Array<{ id(): string }>,
) {
  if (currentSelection.length > path.length) {
    return false;
  }

  return currentSelection.every((node, index) => node === path[index]);
}

function applySelection(
  portal: TPortalHandleElementPointerDoubleClick,
  args: { nextSelection: Parameters<SelectionService["setSelection"]>[0] },
) {
  if (portal.hasSameSelectionOrder(portal.selection.selection, args.nextSelection)) {
    return;
  }

  portal.selection.setSelection(args.nextSelection);
}

export function txHandleElementPointerDoubleClick(
  portal: TPortalHandleElementPointerDoubleClick,
  args: TArgsHandleElementPointerDoubleClick,
) {
  const path = fnGetSelectionPath({ scene: portal.scene, node: args.event.currentTarget });

  if (!isSelectionPathPrefix(portal.selection.selection, path)) {
    return false;
  }

  if (portal.selection.selection.length >= path.length) {
    return false;
  }

  const nextSelection = path.slice(0, portal.selection.selection.length + 1);
  applySelection(portal, { nextSelection });
  portal.selection.setFocusedNode(nextSelection.at(-1) ?? null);
  return true;
}
