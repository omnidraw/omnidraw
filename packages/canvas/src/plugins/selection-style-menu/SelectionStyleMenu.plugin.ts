import type { IPlugin } from "@vibecanvas/runtime";
import {
  createComponent,
  createMemo,
  createSignal,
} from "solid-js";
import { render } from "solid-js/web";
import { SelectionStyleMenu } from "../../components/SelectionStyleMenu";
import type {
  IRuntimeConfig,
  IRuntimeHooks,
  IRuntimeServices,
} from "../../types";
import { txMountSelectionStyleMenu } from "./tx.mount-selection-style-menu";

export function createSelectionStyleMenuPlugin(): IPlugin<
  IRuntimeServices,
  IRuntimeHooks,
  IRuntimeConfig
> {
  return {
    name: "selection-style-menu",
    apply(ctx) {
      const crdt = ctx.services.require("crdt");
      const element = ctx.services.require("element");
      const history = ctx.services.require("history");
      const scene = ctx.services.require("scene");
      const selection = ctx.services.require("selection");
      const session = ctx.services.require("session");
      const theme = ctx.services.require("theme");
      const tool = ctx.services.require("tool");
      let mount: ReturnType<typeof txMountSelectionStyleMenu> | null = null;

      ctx.hooks.init.tap(() => {
        const view = scene.container.ownerDocument.defaultView;
        mount = txMountSelectionStyleMenu(
          {
            SelectionStyleMenu,
            createComponent,
            createMemo,
            createSignal,
            render,
            now: () => Date.now(),
            setTimeout: (handler, timeout) => {
              if (view === null) {
                handler();
                return -1;
              }
              return view.setTimeout(handler, timeout);
            },
            clearTimeout: (timer) => {
              view?.clearTimeout(timer);
            },
            crdt,
            element,
            history,
            scene,
            selection,
            session,
            theme,
            tool,
          },
          {},
        );
      });
      ctx.hooks.destroy.tap(() => {
        mount?.dispose();
        mount = null;
      });
    },
  };
}
