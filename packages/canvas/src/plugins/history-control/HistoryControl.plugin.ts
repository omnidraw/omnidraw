import type { IPlugin } from "@vibecanvas/runtime";
import type { IRuntimeConfig, IRuntimeHooks, IRuntimeServices } from "../../types";

/**
 * Handles keyboard shortcuts for undo and redo.
 * Mirrors old cmd/ctrl+z and cmd/ctrl+shift+z behavior.
 */
export function createHistoryControlPlugin(): IPlugin<IRuntimeServices, IRuntimeHooks, IRuntimeConfig> {
  return {
    name: "history-control",
    apply(ctx) {
      const history = ctx.services.require("history");

      ctx.hooks.keydown.tap((event) => {
        const isUndo = (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z";
        const isRedo = (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "z";

        if (!isUndo && !isRedo) {
          return false;
        }

        event.preventDefault();

        if (isRedo) {
          history.redo();
          return true;
        }

        history.undo();
        return true;
      });
    },
  };
}
