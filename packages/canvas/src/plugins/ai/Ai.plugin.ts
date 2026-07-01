import type { IPlugin } from "@vibecanvas/runtime";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { render } from "solid-js/web";
import { AiWizzard } from "../../components/AiWizzard";
import type { IRuntimeConfig, IRuntimeHooks, IRuntimeServices } from "../../types";

const AI_WIDGET_KIND = "ai";

const AI_WIDGET_ICON = `
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 8V4H8" />
  <rect width="16" height="12" x="4" y="8" rx="2" />
  <path d="M2 14h2" />
  <path d="M20 14h2" />
  <path d="M9 13v2" />
  <path d="M15 13v2" />
</svg>
`;

function mountAiWidget(portal: {apiService: IRuntimeConfig['apiService']}, args: { root: HTMLDivElement; element: TElement }) {
  args.root.replaceChildren();

  render(() => AiWizzard({apiService: portal.apiService}), args.root)

  return () => {
    args.root.replaceChildren();
  };
}

export function createAiPlugin(): IPlugin<IRuntimeServices, IRuntimeHooks, IRuntimeConfig> {
  return {
    name: "ai",
    apply(ctx) {
      const tool = ctx.services.require("tool");
      const widgetManager = ctx.services.require("widgetManager");

      widgetManager.registerWidget({
        id: AI_WIDGET_KIND,
        dataType: "ui-widget",
        tool: {
          label: "Widget AI Wizzard",
          icon: AI_WIDGET_ICON,
          shortcuts: ["8"],
          priority: 77,
        },
        initialPayload: {},
        renderDom: ({ root, element }) => mountAiWidget({apiService: ctx.config.apiService}, { root, element }),
      });

      ctx.hooks.destroy.tap(() => {
        tool.unregisterTool(AI_WIDGET_KIND);
      });
    },
  };
}
