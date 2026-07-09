import type { IPlugin } from "@vibecanvas/runtime";
import type { TElement, TUiWidgetData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import Konva from "konva";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { ELEMENT_DATA_ATTR } from "../../core/CONSTANTS";
import { isKonvaGroup } from "../../core/GUARDS";
import { AiWizzard } from "../../components/AiWizzard";
import type { CrdtService, SceneService, ToolService } from "../../services";
import type { IRuntimeConfig, IRuntimeHooks, IRuntimeServices } from "../../types";

const AI_WIDGET_KIND = "ai";

type TAiWidgetPayload = {
  sessionId: string;
  model?: {
    provider: string;
    modelId: string;
  };
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
};

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

function getAiSessionId(args: { element: TElement }) {
  if (args.element.data.type !== "ui-widget") {
    return null;
  }

  const sessionId = args.element.data.payload?.sessionId;
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
}

function getAiWidgetPayload(args: { element: TElement }): Partial<TAiWidgetPayload> | undefined {
  if (args.element.data.type !== "ui-widget") {
    return undefined;
  }

  return args.element.data.payload as Partial<TAiWidgetPayload> | undefined;
}

function persistAiPayload(args: {
  crdt: CrdtService;
  scene: SceneService;
  elementId: string;
  payload: TAiWidgetPayload;
}) {
  const currentElement = args.crdt.doc()?.elements[args.elementId];
  if (!currentElement || currentElement.data.type !== "ui-widget") {
    return;
  }

  const nextData: TUiWidgetData = {
    ...currentElement.data,
    payload: {
      ...(currentElement.data.payload ?? {}),
      ...args.payload,
    },
  };

  const node = args.scene.staticForegroundLayer.findOne((candidate: Konva.Node) => {
    return isKonvaGroup(candidate) && candidate.id() === args.elementId;
  });
  if (isKonvaGroup(node)) {
    node.setAttr(ELEMENT_DATA_ATTR, nextData);
  }

  args.crdt.build()
    .patchElement(args.elementId, "data", nextData)
    .commit();
}

function mountAiWidget(portal: {
  apiService: IRuntimeConfig['apiService'];
  crdt: CrdtService;
  scene: SceneService;
  tool: ToolService;
  createSessionId: () => string;
}, args: { root: HTMLDivElement; element: TElement, id: string }) {
  args.root.replaceChildren();

  const initialSessionId = getAiSessionId({ element: args.element }) ?? portal.createSessionId();
  let currentSessionId = initialSessionId;
  if (initialSessionId !== getAiSessionId({ element: args.element })) {
    persistAiPayload({
      crdt: portal.crdt,
      scene: portal.scene,
      elementId: args.id,
      payload: { sessionId: initialSessionId },
    });
  }

  const readToolGroups = () => {
    return [...new Set(portal.tool.getTools()
      .map((tool) => tool.group)
      .filter((group): group is string => typeof group === "string" && group.trim().length > 0))]
      .sort((left, right) => left.localeCompare(right));
  };
  const [toolGroups, setToolGroups] = createSignal(readToolGroups());
  portal.tool.hooks.toolsChange.tap(() => setToolGroups(readToolGroups()));

  render(() => AiWizzard({
    apiService: portal.apiService,
    id: args.id,
    sessionId: initialSessionId,
    toolGroups: toolGroups(),
    aiWizardPreference: getAiWidgetPayload({ element: args.element }),
    onAiWizardPreferenceChange: (preference) => {
      persistAiPayload({
        crdt: portal.crdt,
        scene: portal.scene,
        elementId: args.id,
        payload: {
          ...preference,
          sessionId: currentSessionId,
        },
      });
    },
    onResetSessionId: () => {
      const sessionId = portal.createSessionId();
      currentSessionId = sessionId;
      persistAiPayload({
        crdt: portal.crdt,
        scene: portal.scene,
        elementId: args.id,
        payload: { sessionId },
      });
      return sessionId;
    },
  }), args.root)

  return () => {
    args.root.replaceChildren();
  };
}

export function createAiPlugin(): IPlugin<IRuntimeServices, IRuntimeHooks, IRuntimeConfig> {
  return {
    name: "ai",
    apply(ctx) {
      const crdt = ctx.services.require("crdt");
      const scene = ctx.services.require("scene");
      const tool = ctx.services.require("tool");
      const widgetManager = ctx.services.require("widgetManager");

      widgetManager.registerWidget({
        id: AI_WIDGET_KIND,
        dataType: "ui-widget",
        tool: {
          label: "Widget AI Wizzard",
          icon: AI_WIDGET_ICON,
          shortcuts: ["Q"],
          priority: 5,
        },
        initialPayload: { sessionId: crypto.randomUUID() } satisfies TAiWidgetPayload,
        renderDom: ({ root, element }) => mountAiWidget({
          apiService: ctx.config.apiService,
          crdt,
          scene,
          tool,
          createSessionId: () => crypto.randomUUID(),
        }, { root, element, id: element.id }),
      });

      ctx.hooks.destroy.tap(() => {
        tool.unregisterTool(AI_WIDGET_KIND);
      });
    },
  };
}
