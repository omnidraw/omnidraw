import type { IPlugin } from "@vibecanvas/runtime";
import { fnCreateChatId } from "@vibecanvas/shared-functions/chat/fn.chat-id";
import type { TElement, TUiWidgetData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import Konva from "konva";
import { render } from "solid-js/web";
import { ELEMENT_DATA_ATTR } from "../../core/CONSTANTS";
import { isKonvaGroup } from "../../core/GUARDS";
import { AiChat } from "../../components/AiChat";
import type { CrdtService, SceneService, ToolService } from "../../services";
import type { TWidgetTitleBarPortal } from "../../services/widget/interface";
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

function createAiSessionId(): string {
  return fnCreateChatId({ now: new Date(), uuid: crypto.randomUUID() });
}

function createAiWidgetPayload(): TAiWidgetPayload {
  return { sessionId: createAiSessionId() };
}

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
  onOpenResource: IRuntimeConfig['onOpenResource'];
  onResourceCatalogChanged: IRuntimeConfig['onResourceCatalogChanged'];
  crdt: CrdtService;
  scene: SceneService;
  tool: ToolService;
  createSessionId: () => string;
}, args: { root: HTMLDivElement; element: TElement, id: string; titleBar: TWidgetTitleBarPortal }) {
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

  const dispose = render(() => AiChat({
    apiService: portal.apiService,
    id: args.id,
    titleBar: args.titleBar,
    sessionId: initialSessionId,
    aiChatPreference: getAiWidgetPayload({ element: args.element }),
    onAiChatPreferenceChange: (preference) => {
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
    onOpenResource: portal.onOpenResource,
    onResourceCatalogChanged: portal.onResourceCatalogChanged,
  }), args.root)

  return () => {
    dispose();
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
          label: "AI Chat",
          icon: AI_WIDGET_ICON,
          shortcuts: ["Q"],
          priority: 5,
        },
        createInitialPayload: createAiWidgetPayload,
        createClonePayload: (sourcePayload) => ({
          ...sourcePayload,
          sessionId: createAiSessionId(),
        } satisfies TAiWidgetPayload),
        titleBarActions: [{ id: "settings", label: "Settings" }],
        renderDom: ({ root, element, titleBar }) => {
          if (!titleBar) throw new Error("AI Chat title bar actions are unavailable");
          return mountAiWidget({
            apiService: ctx.config.apiService,
            onOpenResource: ctx.config.onOpenResource,
            onResourceCatalogChanged: ctx.config.onResourceCatalogChanged,
            crdt,
            scene,
            tool,
            createSessionId: createAiSessionId,
          }, { root, element, id: element.id, titleBar });
        },
      });

      ctx.hooks.destroy.tap(() => {
        tool.unregisterTool(AI_WIDGET_KIND);
      });
    },
  };
}
