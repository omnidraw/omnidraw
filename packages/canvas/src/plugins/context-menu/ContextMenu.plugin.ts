import type { IPlugin } from "@vibecanvas/runtime";
import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import {
  fnCanvasTargetsEqual,
} from "../../semantic/fn.target";
import type { TCanvasSemanticHit, TCanvasTarget } from "../../semantic/typed";
import type {
  SelectionService,
  TContextMenuScope,
} from "../../services";
import type {
  IRuntimeConfig,
  IRuntimeHooks,
  IRuntimeServices,
} from "../../types";
import { fnGetSelectionPath } from "../select/fn.get-selection-path";

function menuScope(
  target: TCanvasTarget | null,
  selection: readonly TCanvasTarget[],
): TContextMenuScope {
  if (target === null) {
    return "canvas";
  }
  return selection.length > 1 ? "selection" : "item";
}

function selectionForHit(
  selection: SelectionService,
  hit: TCanvasSemanticHit,
): TCanvasTarget[] {
  if (selection.selection.some((target) => {
    return fnCanvasTargetsEqual(target, hit.target);
  })) {
    return selection.snapshot.selection.map((target) => ({ ...target }));
  }
  const path = fnGetSelectionPath({ hit });
  const depth = Math.min(
    Math.max(selection.selection.length, 1),
    path.length,
  );
  return path.slice(0, depth);
}

function activeSelection(
  document: TCanvasDoc,
  selection: readonly TCanvasTarget[],
): TCanvasTarget[] {
  const selectedGroupIds = new Set(selection.flatMap((target) => {
    return target.kind === "group" ? [target.id] : [];
  }));
  const nested = selection.filter((target) => {
    const parentId = target.kind === "element"
      ? document.elements[target.id]?.parentGroupId
      : document.groups[target.id]?.parentGroupId;
    return parentId !== null
      && parentId !== undefined
      && selectedGroupIds.has(parentId);
  });
  return nested.length === 0
    ? selection.map((target) => ({ ...target }))
    : [{ ...nested.at(-1)! }];
}

/**
 * Product context-menu policy over semantic hit and selection data.
 * Cangine owns all menu input and presentation.
 */
export function createContextMenuPlugin(): IPlugin<
  IRuntimeServices,
  IRuntimeHooks,
  IRuntimeConfig
> {
  return {
    name: "context-menu",
    apply(ctx) {
      const contextMenu = ctx.services.require("contextMenu");
      const crdt = ctx.services.require("crdt");
      const scene = ctx.services.require("scene");
      const selection = ctx.services.require("selection");
      const cleanups: Array<() => void> = [];

      ctx.hooks.init.tap(() => {
        cleanups.push(
          contextMenu.setPresenter({
            close: () => scene.editor.menu.close(),
          }),
          scene.editor.registerContextMenuProvider((editorContext) => {
            const hit = scene.input.hitTestViewport({
              point: editorContext.anchor,
            }).find((candidate) => {
              return editorContext.target === null
                || fnCanvasTargetsEqual(
                  candidate.target,
                  editorContext.target,
                );
            }) ?? null;
            const nextSelection = hit === null
              ? selection.snapshot.selection
              : selectionForHit(selection, hit);
            if (hit !== null) {
              selection.setSelection(nextSelection);
              selection.setFocusedTarget(nextSelection.at(-1) ?? null);
            }

            const document = crdt.doc();
            const target = editorContext.target ?? hit?.target ?? null;
            const activeTargets = activeSelection(document, nextSelection);
            const resolvedSelection = selection.resolveSelection(document);
            const resolvedActiveSelection = activeTargets.flatMap(
              (candidate) => {
                const resolved = selection.resolveTarget(document, candidate);
                return resolved === null ? [] : [resolved];
              },
            );
            const actions = contextMenu.getActions({
              scope: menuScope(target, nextSelection),
              target,
              targetElement: target?.kind === "element"
                ? document.elements[target.id] ?? null
                : null,
              targetGroup: target?.kind === "group"
                ? document.groups[target.id] ?? null
                : null,
              selection: nextSelection,
              activeSelection: activeTargets,
              resolvedSelection,
              resolvedActiveSelection,
              connectionId: null,
            });
            if (actions.length === 0) {
              return [{
                id: "no-actions",
                text: "No actions available",
                disabled: true,
                activate: () => undefined,
              }];
            }
            return actions.map((action) => ({
              id: action.id,
              text: action.label,
              ...(action.disabled === undefined
                ? {}
                : { disabled: action.disabled }),
              ...(action.destructive === undefined
                ? {}
                : { destructive: action.destructive }),
              activate: action.onSelect,
            }));
          }),
        );
      });
      ctx.hooks.destroy.tap(() => {
        contextMenu.close();
        for (const cleanup of cleanups.splice(0).reverse()) {
          cleanup();
        }
      });
    },
  };
}
