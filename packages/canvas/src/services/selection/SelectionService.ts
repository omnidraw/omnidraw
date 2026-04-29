import type { IService } from "@vibecanvas/runtime";
import { SyncHook } from "@vibecanvas/tapable";
import type Konva from "konva";
import { CanvasMode } from "./CONSTANTS";

export interface TSelectionServiceHooks {
  change: SyncHook<[]>;
}

/**
 * Holds selection and tool state.
 *
 * `selection` and `focusedId` are reserved for transformable canvas nodes
 * such as elements and groups. Widget connections are UI-only edges and must
 * not be pushed into `selection`, otherwise generic selection consumers like
 * the transformer would treat them as normal elements.
 *
 * `selectedConnectionId` stores the single selected widget connection id.
 * It is intentionally untangled from node selection: selecting a connection
 * clears node selection/focus, and selecting nodes clears connection selection.
 */
export class SelectionService implements IService<TSelectionServiceHooks> {
  readonly name = "selection";
  readonly hooks: TSelectionServiceHooks = {
    change: new SyncHook(),
  };

  mode = CanvasMode.SELECT;
  selection: Array<Konva.Node> = [];
  focusedId: string | null = null;
  selectedConnectionId: string | null = null;
  private suppressSelectionHandlingUntil = 0;

  setMode(mode: CanvasMode) {
    if (this.mode === mode) {
      return;
    }

    this.mode = mode;
    this.hooks.change.call();
  }

  setSelection(selection: Array<Konva.Node>) {
    this.selection = selection;
    this.selectedConnectionId = null;
    this.hooks.change.call();
  }

  setSelectedConnectionId(connectionId: string | null) {
    this.selection = [];
    this.focusedId = null;
    this.selectedConnectionId = connectionId;
    this.hooks.change.call();
  }

  setFocusedId(focusedId: string | null) {
    this.focusedId = focusedId;
    if (focusedId !== null) {
      this.selectedConnectionId = null;
    }
    this.hooks.change.call();
  }

  setFocusedNode(node: Konva.Node | null) {
    this.setFocusedId(node?.id() ?? null);
  }

  suppressSelectionHandling(durationMs: number) {
    const now = Date.now();
    this.suppressSelectionHandlingUntil = Math.max(this.suppressSelectionHandlingUntil, now + durationMs);
  }

  isSelectionHandlingSuppressed() {
    return Date.now() < this.suppressSelectionHandlingUntil;
  }

  clear() {
    this.selection = [];
    this.focusedId = null;
    this.selectedConnectionId = null;
    this.hooks.change.call();
  }
}
