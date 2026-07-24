import type { IService } from "@vibecanvas/runtime";
import type {
  TElement,
  TGroup,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { SyncHook } from "@vibecanvas/tapable";
import type { TCanvasTarget } from "../../semantic/typed";
import type { TResolvedCanvasTarget } from "../selection/fn.resolve-selection";

export type TContextMenuScope = "canvas" | "item" | "selection" | "connection";

export type TContextMenuAction = {
  id: string;
  label: string;
  disabled?: boolean;
  hidden?: boolean;
  priority?: number;
  onSelect: () => void | Promise<void>;
};

export type TContextMenuProviderArgs = {
  scope: TContextMenuScope;
  target: TCanvasTarget | null;
  targetElement: TElement | null;
  targetGroup: TGroup | null;
  selection: readonly TCanvasTarget[];
  activeSelection: readonly TCanvasTarget[];
  resolvedSelection: readonly TResolvedCanvasTarget[];
  resolvedActiveSelection: readonly TResolvedCanvasTarget[];
  connectionId: string | null;
};

export type TContextMenuProvider = (
  args: TContextMenuProviderArgs,
) => TContextMenuAction[];

export interface TContextMenuServiceHooks {
  stateChange: SyncHook<[]>;
  providersChange: SyncHook<[]>;
}

function sortVisibleActions(
  actions: readonly TContextMenuAction[],
): TContextMenuAction[] {
  return actions
    .filter((action) => !action.hidden)
    .sort((left, right) => {
      const priority = (left.priority ?? 10_000) - (right.priority ?? 10_000);
      return priority || left.label.localeCompare(right.label);
    });
}

function noActions(): TContextMenuAction[] {
  return [{
    id: "no-actions",
    label: "No actions available",
    disabled: true,
    priority: 999_999,
    onSelect: () => undefined,
  }];
}

/**
 * Product-only context-menu policy and runtime state.
 */
export class ContextMenuService implements IService<TContextMenuServiceHooks> {
  readonly name = "contextMenu";
  readonly hooks: TContextMenuServiceHooks = {
    stateChange: new SyncHook(),
    providersChange: new SyncHook(),
  };
  readonly providers = new Map<string, TContextMenuProvider>();

  open = false;
  x = 0;
  y = 0;
  requestId = 0;
  actions: TContextMenuAction[] = [];
  context: TContextMenuProviderArgs | null = null;

  registerProvider(id: string, provider: TContextMenuProvider): () => void {
    this.providers.set(id, provider);
    this.hooks.providersChange.call();
    return () => {
      this.unregisterProvider(id);
    };
  }

  unregisterProvider(id: string): void {
    if (this.providers.delete(id)) {
      this.hooks.providersChange.call();
    }
  }

  getActions(args: TContextMenuProviderArgs): TContextMenuAction[] {
    return sortVisibleActions(
      [...this.providers.values()].flatMap((provider) => provider(args)),
    );
  }

  openAt(args: {
    x: number;
    y: number;
    context: TContextMenuProviderArgs;
  }): void {
    const actions = this.getActions(args.context);
    this.x = args.x;
    this.y = args.y;
    this.context = args.context;
    this.actions = actions.length === 0 ? noActions() : actions;
    this.open = true;
    this.requestId += 1;
    this.hooks.stateChange.call();
  }

  openWithActionsAt(args: {
    x: number;
    y: number;
    actions: readonly TContextMenuAction[];
  }): void {
    const actions = sortVisibleActions(args.actions);
    this.x = args.x;
    this.y = args.y;
    this.context = null;
    this.actions = actions.length === 0 ? noActions() : actions;
    this.open = true;
    this.requestId += 1;
    this.hooks.stateChange.call();
  }

  close(): void {
    if (!this.open && this.actions.length === 0 && this.context === null) {
      return;
    }
    this.open = false;
    this.actions = [];
    this.context = null;
    this.hooks.stateChange.call();
  }
}
