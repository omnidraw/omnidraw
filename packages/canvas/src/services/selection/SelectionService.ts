import type { IService } from "@vibecanvas/runtime";
import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { SyncHook } from "@vibecanvas/tapable";
import {
  fnCanvasTargetKey,
  fnCanvasTargetsEqual,
  fnUniqueCanvasTargets,
} from "../../semantic/fn.target";
import type {
  TCanvasSelectionMode,
  TCanvasTarget,
} from "../../semantic/typed";
import { CanvasMode } from "./CONSTANTS";
import {
  fnApplyCanvasSelectionMode,
  fnPruneCanvasSelection,
} from "./fn.semantic-selection";
import {
  fnResolveCanvasSelection,
  fnResolveCanvasTarget,
} from "./fn.resolve-selection";

export type TCanvasSelectionSnapshot = {
  mode: CanvasMode;
  selection: readonly TCanvasTarget[];
  focused: TCanvasTarget | null;
};

export type TCanvasSetFocusedTargetOptions = Readonly<{
  /**
   * Content focus may exist without ordinary canvas selection. Selection
   * focus keeps the historical invariant that the focused target is selected.
   */
  allowUnselected?: boolean;
}>;

export type TSelectionServiceHooks = {
  change: SyncHook<[TCanvasSelectionSnapshot]>;
};

export type TSelectionServicePortal = {
  now(): number;
};

/**
 * Production owner for ordered semantic product selection and focus.
 */
export class SelectionService implements IService<TSelectionServiceHooks> {
  readonly name = "selection";
  readonly hooks: TSelectionServiceHooks = {
    change: new SyncHook(),
  };

  mode = CanvasMode.SELECT;
  selection: TCanvasTarget[] = [];
  focused: TCanvasTarget | null = null;
  #suppressSelectionHandlingUntil = 0;
  #allowUnselectedFocus = false;

  constructor(
    private readonly portal: TSelectionServicePortal = {
      now: () => Date.now(),
    },
  ) {}

  get focusedId(): string | null {
    return this.focused?.id ?? null;
  }

  get snapshot(): TCanvasSelectionSnapshot {
    return {
      mode: this.mode,
      selection: this.selection.map((target) => ({ ...target })),
      focused: this.focused === null ? null : { ...this.focused },
    };
  }

  setMode(mode: CanvasMode): boolean {
    if (this.mode === mode) {
      return false;
    }
    this.mode = mode;
    this.#emit();
    return true;
  }

  setSelection(selection: readonly TCanvasTarget[]): boolean {
    const next = fnUniqueCanvasTargets(selection);
    const unchanged = next.length === this.selection.length
      && next.every((target, index) => {
        return fnCanvasTargetsEqual(target, this.selection[index] ?? null);
      });
    if (unchanged) {
      return false;
    }

    this.selection = next;
    if (
      !this.#allowUnselectedFocus
      && this.focused !== null
      && !next.some((target) => fnCanvasTargetsEqual(target, this.focused))
    ) {
      this.focused = null;
      this.#allowUnselectedFocus = false;
    }
    this.#emit();
    return true;
  }

  select(
    target: TCanvasTarget,
    mode: TCanvasSelectionMode = "replace",
  ): boolean {
    const selectionChanged = this.setSelection(fnApplyCanvasSelectionMode(
      this.selection,
      target,
      mode,
    ));
    if (
      mode !== "remove"
      && this.selection.some((candidate) => {
        return fnCanvasTargetKey(candidate) === fnCanvasTargetKey(target);
      })
    ) {
      const focusChanged = this.setFocusedTarget(target);
      return selectionChanged || focusChanged;
    }
    return selectionChanged;
  }

  setFocusedTarget(
    target: TCanvasTarget | null,
    options: TCanvasSetFocusedTargetOptions = {},
  ): boolean {
    const allowUnselected = options.allowUnselected === true;
    const next = target !== null
      && (
        allowUnselected
        || this.selection.some((candidate) => {
          return fnCanvasTargetsEqual(candidate, target);
        })
      )
      ? target
      : null;
    const nextAllowsUnselected = next !== null && allowUnselected;
    if (
      fnCanvasTargetsEqual(this.focused, next)
      && this.#allowUnselectedFocus === nextAllowsUnselected
    ) {
      return false;
    }
    this.focused = next;
    this.#allowUnselectedFocus = nextAllowsUnselected;
    this.#emit();
    return true;
  }

  setFocusedId(focusedId: string | null): boolean {
    const target = focusedId === null
      ? null
      : this.selection.find((candidate) => candidate.id === focusedId) ?? null;
    return this.setFocusedTarget(target);
  }

  resolveTarget(document: TCanvasDoc, target: TCanvasTarget) {
    return fnResolveCanvasTarget({ document, target });
  }

  resolveSelection(document: TCanvasDoc) {
    return fnResolveCanvasSelection({
      document,
      selection: this.selection,
    });
  }

  prune(availableTargetKeys: ReadonlySet<string>): boolean {
    const nextSelection = fnPruneCanvasSelection(
      this.selection,
      availableTargetKeys,
    );
    const nextFocused = this.focused !== null
      && availableTargetKeys.has(fnCanvasTargetKey(this.focused))
      ? this.focused
      : null;
    return this.#setPrunedState(nextSelection, nextFocused);
  }

  pruneDocument(document: TCanvasDoc): boolean {
    const nextSelection = this.selection.filter((target) => {
      return fnResolveCanvasTarget({ document, target }) !== null;
    });
    const nextFocused = this.focused !== null
      && fnResolveCanvasTarget({ document, target: this.focused }) !== null
      ? this.focused
      : null;
    return this.#setPrunedState(nextSelection, nextFocused);
  }

  suppressSelectionHandling(durationMs: number): void {
    this.#suppressSelectionHandlingUntil = Math.max(
      this.#suppressSelectionHandlingUntil,
      this.portal.now() + Math.max(0, durationMs),
    );
  }

  isSelectionHandlingSuppressed(): boolean {
    return this.portal.now() < this.#suppressSelectionHandlingUntil;
  }

  clear(): boolean {
    if (this.selection.length === 0 && this.focused === null) {
      return false;
    }
    this.selection = [];
    this.focused = null;
    this.#allowUnselectedFocus = false;
    this.#emit();
    return true;
  }

  #setPrunedState(
    selection: readonly TCanvasTarget[],
    focused: TCanvasTarget | null,
  ): boolean {
    const nextSelection = fnUniqueCanvasTargets(selection);
    const selectionUnchanged = nextSelection.length === this.selection.length
      && nextSelection.every((target, index) => {
        return fnCanvasTargetsEqual(target, this.selection[index] ?? null);
      });
    const focusUnchanged = fnCanvasTargetsEqual(this.focused, focused);
    if (selectionUnchanged && focusUnchanged) {
      return false;
    }
    this.selection = nextSelection;
    this.focused = focused;
    if (focused === null) {
      this.#allowUnselectedFocus = false;
    }
    this.#emit();
    return true;
  }

  #emit(): void {
    this.hooks.change.call(this.snapshot);
  }
}
