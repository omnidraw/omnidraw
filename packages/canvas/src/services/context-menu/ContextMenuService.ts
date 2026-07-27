import type { IService } from "@vibecanvas/runtime";
import type {
  TElement,
  TGroup,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TCanvasTarget } from "../../semantic/typed";
import type { TResolvedCanvasTarget } from "../selection/fn.resolve-selection";

export type TContextMenuScope = "canvas" | "item" | "selection" | "connection";

export type TContextMenuAction = {
  id: string;
  label: string;
  disabled?: boolean;
  hidden?: boolean;
  destructive?: boolean;
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

/**
 * Product-only context-menu action policy. Cangine owns presentation state,
 * positioning, focus, keyboard navigation, dismissal, and DOM cleanup.
 */
export class ContextMenuService implements IService {
  readonly name = "contextMenu";
  readonly #providers = new Map<string, TContextMenuProvider>();
  #closePresenter: (() => void) | null = null;

  registerProvider(id: string, provider: TContextMenuProvider): () => void {
    this.#providers.set(id, provider);
    return () => {
      this.unregisterProvider(id);
    };
  }

  unregisterProvider(id: string): void {
    this.#providers.delete(id);
  }

  getActions(args: TContextMenuProviderArgs): TContextMenuAction[] {
    return sortVisibleActions(
      [...this.#providers.values()].flatMap((provider) => provider(args)),
    );
  }

  setPresenter(presenter: Readonly<{ close(): void }>): () => void {
    const close = () => presenter.close();
    this.#closePresenter = close;
    return () => {
      if (this.#closePresenter === close) {
        this.#closePresenter = null;
      }
    };
  }

  close(): void {
    this.#closePresenter?.();
  }
}
