import type { IService } from "@vibecanvas/runtime";
import type { TElement, TGroup } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { SyncHook } from "@vibecanvas/tapable";
import type { Group } from "konva/lib/Group";
import type { Shape, ShapeConfig } from "konva/lib/Shape";

export type TContextMenuScope = "canvas" | "item" | "selection" | "connection";
export type TContextMenuNode = Group | Shape<ShapeConfig>;

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
  targetNode: TContextMenuNode | null;
  targetElement: TElement | null;
  targetGroup: TGroup | null;
  selection: TContextMenuNode[];
  activeSelection: TContextMenuNode[];
  connectionId: string | null;
};

export type TContextMenuProvider = (args: TContextMenuProviderArgs) => TContextMenuAction[];

export interface TContextMenuServiceHooks {
  stateChange: SyncHook<[]>;
  providersChange: SyncHook<[]>;
}

/**
 * Holds context menu runtime state and provider registry.
 * Feature plugins register actions here. UI plugin only renders and opens/closes.
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

  registerProvider(id: string, provider: TContextMenuProvider) {
    this.providers.set(id, provider);
    this.hooks.providersChange.call();
  }

  unregisterProvider(id: string) {
    const didDelete = this.providers.delete(id);
    if (!didDelete) {
      return;
    }

    this.hooks.providersChange.call();
  }

  getActions(args: TContextMenuProviderArgs) {
    const actions = [...this.providers.values()].flatMap((provider) => {
      return provider(args);
    }).filter((action) => !action.hidden);

    return actions.sort((left, right) => {
      const leftPriority = left.priority ?? 10000;
      const rightPriority = right.priority ?? 10000;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      return left.label.localeCompare(right.label);
    });
  }

  openAt(args: {
    x: number;
    y: number;
    context: TContextMenuProviderArgs;
  }) {
    const actions = this.getActions(args.context);

    this.x = args.x;
    this.y = args.y;
    this.context = args.context;
    this.actions = actions.length === 0
      ? [{ id: "no-actions", label: "No actions available", disabled: true, priority: 999999, onSelect: () => {} }]
      : actions;
    this.open = true;
    this.requestId += 1;
    this.hooks.stateChange.call();
  }

  openWithActionsAt(args: {
    x: number;
    y: number;
    actions: TContextMenuAction[];
  }) {
    const actions = args.actions.filter((action) => !action.hidden).sort((left, right) => {
      const leftPriority = left.priority ?? 10000;
      const rightPriority = right.priority ?? 10000;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      return left.label.localeCompare(right.label);
    });

    this.x = args.x;
    this.y = args.y;
    this.context = null;
    this.actions = actions.length === 0
      ? [{ id: "no-actions", label: "No actions available", disabled: true, priority: 999999, onSelect: () => {} }]
      : actions;
    this.open = true;
    this.requestId += 1;
    this.hooks.stateChange.call();
  }

  close() {
    if (!this.open && this.actions.length === 0 && this.context === null) {
      return;
    }

    this.open = false;
    this.actions = [];
    this.context = null;
    this.hooks.stateChange.call();
  }
}
