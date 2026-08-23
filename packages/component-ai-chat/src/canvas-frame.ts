import type {
  ICanvasExtension,
  TCanvasExtensionLoader,
  TCanvasWidgetCreationContext,
} from "@omnidraw/canvas";
import {
  CANVAS_WIDGET_EXTENSION_KEY,
  fnReadCanvasWidgetExtension,
  type TWidgetFrameNode,
} from "@omnidraw/canvas";

export const AI_CHAT_CANVAS_WIDGET_KIND = "ai-chat" as const;

function createAiChatNode(
  context: TCanvasWidgetCreationContext,
  sessionId: string,
): TWidgetFrameNode {
  const bounds = context.draft.worldBounds;
  return {
    id: context.nodeId,
    kind: "widget-frame",
    parentId: context.parentId,
    orderKey: "m",
    transform: {
      position: { x: bounds.x, y: bounds.y },
      rotation: 0,
      scale: { x: 1, y: 1 },
      skew: { x: 0, y: 0 },
      origin: { x: 0, y: 0 },
    },
    size: {
      width: Math.max(240, bounds.width),
      height: Math.max(160, bounds.height),
    },
    title: "AI Chat",
    resizable: true,
    minSize: { width: 240, height: 160 },
    headerItems: [{
      type: "button",
      id: "settings",
      label: "Settings",
      content: { type: "text", text: "Settings" },
    }],
    extensions: {
      [CANVAS_WIDGET_EXTENSION_KEY]: {
        schemaVersion: 1,
        type: "ui-widget",
        kind: AI_CHAT_CANVAS_WIDGET_KIND,
        payload: { sessionId, approvalPolicy: { mode: "manual" } },
      },
    },
  };
}

export function fnIsAiChatCanvasNode(
  node: Parameters<TCanvasExtensionLoader["match"]>[0],
): boolean {
  if (node.kind !== "widget-frame") return false;
  const extension = fnReadCanvasWidgetExtension(node);
  return extension?.type === "ui-widget"
    && extension.kind === AI_CHAT_CANVAS_WIDGET_KIND;
}

export function createAiChatCanvasFrameContribution(
  createSessionId: () => string,
): Pick<
  TCanvasExtensionLoader,
  "name" | "match" | "oneShotWidgetCreation" | "createWidgetNodes"
> {
  return Object.freeze({
    name: "omnidraw.ai-chat",
    oneShotWidgetCreation: true,
    match: fnIsAiChatCanvasNode,
    createWidgetNodes(context) {
      return context.kind === "widget"
        ? [createAiChatNode(context, createSessionId())]
        : null;
    },
  });
}

export function createAiChatCanvasExtensionLoaderDescriptor(args: Readonly<{
  createSessionId(): string;
  load(signal: AbortSignal): Promise<ICanvasExtension>;
}>): TCanvasExtensionLoader {
  return Object.freeze({
    ...createAiChatCanvasFrameContribution(args.createSessionId),
    loadingLabel: "Loading AI Chat…",
    failureLabel: "AI Chat failed to load.",
    load: args.load,
  });
}
