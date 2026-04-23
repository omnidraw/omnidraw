import type { IPlugin } from "@vibecanvas/runtime";
import type { ThemeService } from "@vibecanvas/service-theme";
import Konva from "konva";
import { createComponent, createMemo, createSignal } from "solid-js";
import { render as renderSolid } from "solid-js/web";
import type { ElementService, SessionService, ToolService, CrdtService, HistoryService, SceneService, SelectionService } from "../../services";
import { SelectionStyleMenu } from "../../components/SelectionStyleMenu";
import { txApplySelectionStyleChange, txApplySelectionStyleChangeRuntime, txCommitSelectionStyleChange, txCreateSelectionStyleChangePlan } from "../../core/tx.apply-selection-style-change";
import type { IRuntimeHooks } from "../../types";
import { fxMountSelectionStyleMenu } from "./fx.mount-selection-style-menu";

type TSelectionStyleMenuTimer = number | ReturnType<typeof globalThis.setTimeout>;

export function createSelectionStyleMenuPlugin(): IPlugin<{
  element: ElementService;
  crdt: CrdtService;
  history: HistoryService;
  scene: SceneService;
  selection: SelectionService;
  theme: ThemeService;
  tool: ToolService;
  session: SessionService;
}, IRuntimeHooks> {
  let menuMount: ReturnType<typeof fxMountSelectionStyleMenu> | null = null;

  return {
    name: "selection-style-menu",
    apply(ctx) {
      const element = ctx.services.require("element");
      const tool = ctx.services.require("tool");
      const session = ctx.services.require("session");
      const crdt = ctx.services.require("crdt");
      const history = ctx.services.require("history");
      const scene = ctx.services.require("scene");
      const selection = ctx.services.require("selection");
      const theme = ctx.services.require("theme");

      ctx.hooks.init.tap(() => {
        const setSelectionStyleMenuTimeout = (handler: () => void, timeout?: number): TSelectionStyleMenuTimer => {
          const view = scene.container.ownerDocument.defaultView;
          if (view) {
            return view.setTimeout(handler, timeout);
          }

          return globalThis.setTimeout(handler, timeout);
        };

        const clearSelectionStyleMenuTimeout = (timer: TSelectionStyleMenuTimer | null) => {
          if (timer === null) {
            return;
          }

          const view = scene.container.ownerDocument.defaultView;
          if (view && typeof timer === "number") {
            view.clearTimeout(timer);
            return;
          }

          globalThis.clearTimeout(timer);
        };

        menuMount = fxMountSelectionStyleMenu({
          Konva,
          SelectionStyleMenu,
          createComponent,
          createMemo,
          createSignal,
          renderSolid,
          txApplySelectionStyleChange,
          txApplySelectionStyleChangeRuntime,
          txCommitSelectionStyleChange,
          txCreateSelectionStyleChangePlan,
          setTimeout: setSelectionStyleMenuTimeout,
          clearTimeout: clearSelectionStyleMenuTimeout,
          element,
          crdt,
          history,
          scene,
          selection,
          theme,
          session,
          tool
        }, {});
      });

      ctx.hooks.destroy.tap(() => {
        menuMount?.dispose();
        menuMount = null;
      });
    },
  };
}
