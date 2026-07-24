import type { IService } from "@vibecanvas/runtime";
import { SyncHook } from "@vibecanvas/tapable";

export type THistoryEntry = {
  undo: () => void;
  redo: () => void;
  label?: string;
};

export interface THistoryServiceHooks {
  change: SyncHook<[]>;
}

/**
 * Holds undo and redo stacks for runtime actions.
 * Service stays dumb. Plugins own actual undo and redo behavior.
 */
export class HistoryService implements IService<THistoryServiceHooks> {
  readonly name = "history";
  readonly hooks: THistoryServiceHooks = {
    change: new SyncHook(),
  };

  maxStackSize = 100;

  #undoStack: THistoryEntry[] = [];
  #redoStack: THistoryEntry[] = [];

  record(entry: THistoryEntry) {
    this.#undoStack.push(entry);
    this.#redoStack = [];

    if (this.#undoStack.length > this.maxStackSize) {
      this.#undoStack.shift();
    }

    this.hooks.change.call();
  }

  discard(entry: THistoryEntry) {
    const undoIndex = this.#undoStack.lastIndexOf(entry);
    const redoIndex = this.#redoStack.lastIndexOf(entry);
    if (undoIndex < 0 && redoIndex < 0) {
      return false;
    }
    if (undoIndex >= 0) {
      this.#undoStack.splice(undoIndex, 1);
    }
    if (redoIndex >= 0) {
      this.#redoStack.splice(redoIndex, 1);
    }
    this.hooks.change.call();
    return true;
  }

  undo() {
    const entry = this.#undoStack.pop();
    if (!entry) {
      return false;
    }

    entry.undo();
    this.#redoStack.push(entry);
    this.hooks.change.call();
    return true;
  }

  redo() {
    const entry = this.#redoStack.pop();
    if (!entry) {
      return false;
    }

    entry.redo();
    this.#undoStack.push(entry);
    this.hooks.change.call();
    return true;
  }

  canUndo() {
    return this.#undoStack.length > 0;
  }

  canRedo() {
    return this.#redoStack.length > 0;
  }

  clear() {
    if (this.#undoStack.length === 0 && this.#redoStack.length === 0) {
      return;
    }

    this.#undoStack = [];
    this.#redoStack = [];
    this.hooks.change.call();
  }

  getUndoStackSize() {
    return this.#undoStack.length;
  }

  getRedoStackSize() {
    return this.#redoStack.length;
  }
}
