import type {
  IService,
  IStartableService,
} from "@vibecanvas/runtime";
import type { IServiceContext } from "@vibecanvas/runtime/interface.js";
import { SyncHook } from "@vibecanvas/tapable";
import type { TCanvasTarget } from "../../semantic/typed";
import type { IRuntimeConfig, IRuntimeHooks } from "../../types";
import type { ContextMenuService } from "../context-menu/ContextMenuService";
import type { CrdtService } from "../crdt/CrdtService";
import type { HistoryService } from "../history/HistoryService";
import { CanvasMode } from "../selection/CONSTANTS";
import type { SelectionService } from "../selection/SelectionService";
import { txGroupSelection } from "./tx.group-selection";
import { txMoveGroups } from "./tx.move-groups";
import { txUngroupSelection } from "./tx.ungroup-selection";
import type {
  TGroupMoveArgs,
  TGroupServiceArgs,
  TGroupServiceHooks,
} from "./types";

/**
 * Product hierarchy commands. The projected engine group tree is never read
 * back or serialized by this service.
 */
export class GroupService
implements IService<TGroupServiceHooks>, IStartableService {
  readonly name = "group";
  readonly hooks: TGroupServiceHooks = {
    groupsChange: new SyncHook(),
  };
  readonly #contextMenu: ContextMenuService;
  readonly #crdt: CrdtService;
  readonly #history: HistoryService;
  readonly #selection: SelectionService;
  readonly #createId: () => string;
  readonly #now: () => number;

  constructor(args: TGroupServiceArgs) {
    this.#contextMenu = args.contextMenu;
    this.#crdt = args.crdt;
    this.#history = args.history;
    this.#selection = args.selection;
    this.#createId = args.createId;
    this.#now = args.now;
  }

  start(ctx: IServiceContext<IRuntimeHooks, IRuntimeConfig>): void {
    this.#contextMenu.registerProvider("group", ({
      scope,
      activeSelection,
      resolvedActiveSelection,
    }) => {
      if (scope === "canvas") {
        return [];
      }
      const selectedGroups = resolvedActiveSelection.filter((resolved) => {
        return resolved.target.kind === "group";
      });
      const actions = [];
      if (activeSelection.length > 1) {
        actions.push({
          id: "group-selection",
          label: "Group",
          priority: 200,
          onSelect: () => {
            this.#selection.setSelection(activeSelection);
            this.groupSelection(activeSelection);
          },
        });
      }
      if (selectedGroups.length > 0) {
        actions.push({
          id: "ungroup-selection",
          label: "Ungroup",
          priority: 210,
          onSelect: () => {
            this.#selection.setSelection(activeSelection);
            this.ungroupSelection(activeSelection);
          },
        });
      }
      return actions;
    });

    ctx.hooks.keydown.tap((event) => {
      if (this.#selection.mode !== CanvasMode.SELECT) {
        return;
      }
      const isMeta = event.metaKey || event.ctrlKey;
      if (!isMeta || event.key.toLowerCase() !== "g") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) {
        this.ungroupSelection();
      } else {
        this.groupSelection();
      }
    });
    ctx.hooks.destroy.tap(() => {
      this.#contextMenu.unregisterProvider("group");
    });
  }

  groupSelection(
    targets: readonly TCanvasTarget[] = this.#selection.selection,
  ) {
    const group = txGroupSelection({
      crdt: this.#crdt,
      history: this.#history,
      selection: this.#selection,
      createId: this.#createId,
      now: this.#now,
    }, { targets });
    if (group !== null) {
      this.hooks.groupsChange.call();
    }
    return group;
  }

  ungroupSelection(
    targets: readonly TCanvasTarget[] = this.#selection.selection,
  ) {
    const result = txUngroupSelection({
      crdt: this.#crdt,
      history: this.#history,
      selection: this.#selection,
    }, { targets });
    if (result.length > 0) {
      this.hooks.groupsChange.call();
    }
    return result;
  }

  moveGroups(args: TGroupMoveArgs): readonly string[] {
    return txMoveGroups({
      crdt: this.#crdt,
      history: this.#history,
      now: this.#now,
    }, args);
  }

  moveGroup(args: {
    groupId: string;
    delta: { x: number; y: number };
  }): readonly string[] {
    return this.moveGroups({
      groupIds: [args.groupId],
      delta: args.delta,
    });
  }
}
