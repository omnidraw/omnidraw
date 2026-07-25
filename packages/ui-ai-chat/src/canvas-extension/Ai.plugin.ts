import type { IPlugin } from "@vibecanvas/runtime";
import { fnCreateChatId } from "@vibecanvas/shared-functions/chat/fn.chat-id";
import type { TElement, TUiWidgetData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { render } from "solid-js/web";
import type { CrdtService } from "@vibecanvas/canvas/services";
import type { IRuntimeConfig, IRuntimeHooks, IRuntimeServices } from "@vibecanvas/canvas";
import { AiChat } from "../chat/components";
import type { TAiChatApiPort, TAiChatApplicationPort, TAiChatBrowserPort } from "../ports";
import type { TWidgetTitleBarPortal } from "../widget/interface";
import type { WidgetManagerService } from "../widget/WidgetManagerService";
import type { TChatWidgetDraftReference } from "../chat/components/tabs/fn.tool-call";

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

function createAiSessionId(portal: { nowDate: () => Date; createId: () => string }): string {
  return fnCreateChatId({ now: portal.nowDate(), uuid: portal.createId() });
}

function createAiWidgetPayload(portal: { createSessionId: () => string }): TAiWidgetPayload {
  return { sessionId: portal.createSessionId() };
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

  args.crdt.build()
    .patchElement(args.elementId, "data", nextData)
    .commit();
}

function mountAiWidget(portal: {
  api: TAiChatApiPort;
  application: TAiChatApplicationPort;
  browser: TAiChatBrowserPort;
  crdt: CrdtService;
  createSessionId: () => string;
  openWidgetPreview: (args: { draftId?: string; draftName: string; originChatElementId: string }) => Promise<void>;
}, args: { root: HTMLDivElement; element: TElement, id: string; titleBar: TWidgetTitleBarPortal }) {
  args.root.replaceChildren();

  const initialSessionId = getAiSessionId({ element: args.element }) ?? portal.createSessionId();
  let currentSessionId = initialSessionId;
  if (initialSessionId !== getAiSessionId({ element: args.element })) {
    persistAiPayload({
      crdt: portal.crdt,
      elementId: args.id,
      payload: { sessionId: initialSessionId },
    });
  }

  const dispose = render(() => AiChat({
    apiService: portal.api,
    application: portal.application,
    browser: portal.browser,
    id: args.id,
    titleBar: args.titleBar,
    sessionId: initialSessionId,
    aiChatPreference: getAiWidgetPayload({ element: args.element }),
    onAiChatPreferenceChange: (preference) => {
      persistAiPayload({
        crdt: portal.crdt,
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
        elementId: args.id,
        payload: { sessionId },
      });
      return sessionId;
    },
    onOpenWidgetPreview: (reference: TChatWidgetDraftReference) => portal.openWidgetPreview({
      ...(reference.draftId ? { draftId: reference.draftId } : {}),
      draftName: reference.name,
      originChatElementId: args.id,
    }),
  }), args.root)

  return () => {
    dispose();
    args.root.replaceChildren();
  };
}

export function createAiPlugin(portal: {
  api: TAiChatApiPort;
  application: TAiChatApplicationPort;
  browser: TAiChatBrowserPort;
  createId: () => string;
  nowDate: () => Date;
  widgetManager: WidgetManagerService;
  openWidgetPreview: (args: { draftId?: string; draftName: string; originChatElementId: string }) => Promise<void>;
}): IPlugin<IRuntimeServices, IRuntimeHooks, IRuntimeConfig> {
  const createSessionId = () => createAiSessionId({ createId: portal.createId, nowDate: portal.nowDate });
  return {
    name: "ai",
    apply(ctx) {
      const crdt = ctx.services.require("crdt");
      const widgetManager = portal.widgetManager;

      ctx.hooks.init.tap(() => {
        widgetManager.registerWidget({
          id: AI_WIDGET_KIND,
          dataType: "ui-widget",
          tool: {
            label: "AI Chat",
            icon: AI_WIDGET_ICON,
            shortcuts: ["Q"],
            priority: 5,
          },
          createInitialPayload: () => createAiWidgetPayload({ createSessionId }),
          createClonePayload: (sourcePayload) => ({
            ...sourcePayload,
            sessionId: createSessionId(),
          } satisfies TAiWidgetPayload),
          titleBarActions: [{
            id: "settings",
            label: "Settings",
          }],
          renderDom: ({ root, element, titleBar }) => {
            if (!titleBar) throw new Error("AI Chat title bar actions are unavailable");
            return mountAiWidget({
              api: portal.api,
              application: portal.application,
              browser: portal.browser,
              crdt,
              createSessionId,
              openWidgetPreview: portal.openWidgetPreview,
            }, { root, element, id: element.id, titleBar });
          },
        });
      });

      ctx.hooks.destroy.tap(() => {
        widgetManager.unregisterWidget(AI_WIDGET_KIND);
      });
    },
  };
}
