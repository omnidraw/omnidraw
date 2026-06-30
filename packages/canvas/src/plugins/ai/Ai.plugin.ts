import type { IPlugin } from "@vibecanvas/runtime";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { ToolService, WidgetManagerService } from "../../services";
import type { IRuntimeConfig, IRuntimeHooks } from "../../types";

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

function mountAiWidget(args: { root: HTMLDivElement; element: TElement }) {
  args.root.replaceChildren();

  const shell = document.createElement("div");
  shell.style.display = "flex";
  shell.style.flexDirection = "column";
  shell.style.gap = "12px";
  shell.style.height = "100%";
  shell.style.boxSizing = "border-box";
  shell.style.padding = "16px";
  shell.style.background = "#111827";
  shell.style.color = "#f9fafb";
  shell.style.fontFamily = "Inter, ui-sans-serif, system-ui, sans-serif";

  const title = document.createElement("div");
  title.textContent = "AI Chat";
  title.style.fontSize = "16px";
  title.style.fontWeight = "700";

  const message = document.createElement("div");
  message.textContent = `Hello world from AI widget (${args.element.id})`;
  message.style.padding = "12px";
  message.style.border = "1px solid #374151";
  message.style.borderRadius = "10px";
  message.style.background = "#1f2937";

  const input = document.createElement("input");
  input.placeholder = "Example input only — no real chat yet";
  input.style.marginTop = "auto";
  input.style.padding = "10px 12px";
  input.style.border = "1px solid #4b5563";
  input.style.borderRadius = "8px";
  input.style.background = "#030712";
  input.style.color = "#f9fafb";

  shell.append(title, message, input);
  args.root.appendChild(shell);

  return () => {
    args.root.replaceChildren();
  };
}

export function createAiPlugin(): IPlugin<{
  tool: ToolService;
  widgetManager: WidgetManagerService;
}, IRuntimeHooks, IRuntimeConfig> {
  return {
    name: "ai",
    apply(ctx) {
      const tool = ctx.services.require("tool");
      const widgetManager = ctx.services.require("widgetManager");

      widgetManager.registerWidget({
        id: AI_WIDGET_KIND,
        dataType: "ui-widget",
        tool: {
          label: "AI Chat",
          icon: AI_WIDGET_ICON,
          shortcuts: ["8"],
          priority: 77,
        },
        initialPayload: {},
        renderDom: ({ root, element }) => mountAiWidget({ root, element }),
      });

      ctx.hooks.destroy.tap(() => {
        tool.unregisterTool(AI_WIDGET_KIND);
      });
    },
  };
}
