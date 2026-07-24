import type { IPlugin } from "@vibecanvas/runtime";
import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import {
  fnCanvasTargetsEqual,
  fnUniqueCanvasTargets,
} from "../../semantic/fn.target";
import type {
  TCanvasSemanticHitPart,
  TCanvasTarget,
} from "../../semantic/typed";
import { CanvasMode } from "../../services/selection/CONSTANTS";
import type {
  IRuntimeConfig,
  IRuntimeHooks,
  IRuntimeServices,
  TElementPointerEvent,
} from "../../types";
import {
  fnGetMarqueeTargets,
  fnGetSelectionPath,
  fnIsSelectionPathPrefix,
} from "./fn.get-selection-path";
import { txDeleteSelection } from "./tx.delete-selection";

type TMarqueeState = {
  baseSelection: readonly TCanvasTarget[];
};

function isWidgetFrameControl(part: TCanvasSemanticHitPart): boolean {
  if (
    part === "widget-minimize"
    || part === "widget-restore"
    || part === "widget-fullscreen"
  ) {
    return true;
  }
  return typeof part === "object" && part.value.startsWith("control:");
}

function selectionDepth(
  selection: readonly TCanvasTarget[],
  path: readonly TCanvasTarget[],
): number {
  return Math.min(Math.max(selection.length, 1), path.length);
}

function selectionFocusTarget(
  document: TCanvasDoc,
  target: TCanvasTarget | null,
): TCanvasTarget | null {
  if (target?.kind !== "element") {
    return target;
  }
  const element = document.elements[target.id];
  return element?.data.type === "ui-widget"
    || element?.data.type === "widget-instance"
    ? null
    : target;
}

function isWidgetContentHit(
  document: TCanvasDoc,
  event: TElementPointerEvent,
): boolean {
  const target = event.hit.target;
  if (event.hit.part !== "widget-content" || target.kind !== "element") {
    return false;
  }
  const element = document.elements[target.id];
  return element?.data.type === "ui-widget"
    || element?.data.type === "widget-instance";
}

/**
 * Semantic click, drill-down, marquee, and product deletion policy.
 */
export function createSelectPlugin(): IPlugin<
  IRuntimeServices,
  IRuntimeHooks,
  IRuntimeConfig
> {
  return {
    name: "select",
    apply(ctx) {
      const contextMenu = ctx.services.require("contextMenu");
      const crdt = ctx.services.require("crdt");
      const element = ctx.services.require("element");
      const history = ctx.services.require("history");
      const renderOrder = ctx.services.require("renderOrder");
      const scene = ctx.services.require("scene");
      const selection = ctx.services.require("selection");
      let marquee: TMarqueeState | null = null;
      const setSelectionFocus = (target: TCanvasTarget | null) => {
        selection.setFocusedTarget(selectionFocusTarget(crdt.doc(), target));
      };

      const stopMarquee = () => {
        const active = marquee;
        if (active === null) {
          return;
        }
        marquee = null;
        scene.product.interactions.cancel();
        selection.setSelection(active.baseSelection);
        setSelectionFocus(active.baseSelection.at(-1) ?? null);
      };
      const applyMarqueeTargets = (
        active: TMarqueeState,
        targets: readonly TCanvasTarget[],
      ) => {
        if (marquee !== active) {
          return;
        }
        const nextSelection = fnUniqueCanvasTargets([
          ...active.baseSelection,
          ...targets,
        ]);
        selection.setSelection(nextSelection);
        setSelectionFocus(nextSelection.at(-1) ?? null);
      };

      const unregisterDeleteProvider = contextMenu.registerProvider(
        "delete-selection",
        ({ scope, activeSelection }) => {
          if (scope === "canvas" || activeSelection.length === 0) {
            return [];
          }
          return [{
            id: "delete-selection",
            label: "Delete",
            priority: 300,
            onSelect: () => {
              selection.setSelection(activeSelection);
              txDeleteSelection(
                { crdt, element, history, renderOrder, selection },
                {},
              );
            },
          }];
        },
      );
      const offSelectionChange = selection.hooks.change.tap((snapshot) => {
        if (snapshot.mode !== CanvasMode.SELECT) {
          stopMarquee();
        }
      });

      ctx.hooks.elementPointerDown.tap((event) => {
        if (
          selection.mode !== CanvasMode.SELECT
          || event.button !== 0
        ) {
          return false;
        }
        // Widget chrome is an action surface, not a selection/transform
        // gesture. Leaving it unhandled here preserves the matching
        // pointer-up click for the widget policy owner.
        if (isWidgetFrameControl(event.hit.part)) {
          return false;
        }
        if (selection.isSelectionHandlingSuppressed()) {
          return true;
        }
        const document = crdt.doc();
        if (isWidgetContentHit(document, event)) {
          selection.setSelection([]);
          selection.setFocusedTarget(event.hit.target, {
            allowUnselected: true,
          });
          return true;
        }

        const path = fnGetSelectionPath({ hit: event.hit });
        const depth = selectionDepth(selection.selection, path);
        const target = path[depth - 1];
        if (target === undefined) {
          return false;
        }
        if (event.modifiers.shift) {
          selection.select(target, "toggle");
          setSelectionFocus(selection.selection.at(-1) ?? null);
          return true;
        }

        const topLevel = path[0];
        const flatMultiSelect = selection.selection.length > 1
          && topLevel !== undefined
          && selection.selection.some((candidate) => {
            return fnCanvasTargetsEqual(candidate, topLevel);
          });
        if (flatMultiSelect) {
          setSelectionFocus(topLevel);
          return true;
        }

        const nextSelection = path.slice(0, depth);
        selection.setSelection(nextSelection);
        setSelectionFocus(nextSelection.at(-1) ?? null);
        return true;
      });

      ctx.hooks.elementPointerDoubleClick.tap((event) => {
        if (
          selection.mode !== CanvasMode.SELECT
          || selection.isSelectionHandlingSuppressed()
        ) {
          return false;
        }
        const path = fnGetSelectionPath({ hit: event.hit });
        if (
          !fnIsSelectionPathPrefix({
            selection: selection.selection,
            path,
          })
          || selection.selection.length >= path.length
        ) {
          return false;
        }
        const nextSelection = path.slice(
          0,
          selection.selection.length + 1,
        );
        selection.setSelection(nextSelection);
        setSelectionFocus(nextSelection.at(-1) ?? null);
        return true;
      });

      ctx.hooks.pointerDown.tap((event) => {
        if (
          selection.mode !== CanvasMode.SELECT
          || event.button !== 0
          || event.hit !== null
          || selection.isSelectionHandlingSuppressed()
        ) {
          return;
        }
        stopMarquee();
        const active = {
          baseSelection: event.modifiers.shift
            ? selection.snapshot.selection
            : [],
        };
        marquee = active;
        if (!event.modifiers.shift) {
          selection.clear();
        }
        scene.product.interactions.beginMarquee(event, {
          onUpdate: (draft) => {
            if (
              marquee !== active
              || selection.mode !== CanvasMode.SELECT
            ) {
              return;
            }
            const hits = scene.input.queryWorldRect({
              rect: draft.worldBounds,
            });
            applyMarqueeTargets(active, fnGetMarqueeTargets({ hits }));
          },
          onCommit: (commit) => {
            if (marquee !== active) {
              return;
            }
            applyMarqueeTargets(
              active,
              fnGetMarqueeTargets({ hits: commit.hits }),
            );
            marquee = null;
          },
          onCancel: () => {
            if (marquee !== active) {
              return;
            }
            marquee = null;
            selection.setSelection(active.baseSelection);
            setSelectionFocus(active.baseSelection.at(-1) ?? null);
          },
        });
      });

      ctx.hooks.keydown.tap((event) => {
        if (
          selection.mode !== CanvasMode.SELECT
          || selection.selection.length === 0
          || (event.key !== "Backspace" && event.key !== "Delete")
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        txDeleteSelection(
          { crdt, element, history, renderOrder, selection },
          {},
        );
      });

      ctx.hooks.destroy.tap(() => {
        stopMarquee();
        offSelectionChange();
        unregisterDeleteProvider();
      });
    },
  };
}
