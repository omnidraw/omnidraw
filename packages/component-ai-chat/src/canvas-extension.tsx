import type { ICanvasExtension } from "@omnidraw/canvas";
import {
  CANVAS_WIDGET_EXTENSION_KEY,
  fnReadCanvasWidgetExtension,
  type TWidgetFrameNode,
} from "@omnidraw/canvas";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { AiChat } from "./chat/components/index.js";
import type {
  IAiChatBrowserPort,
  IAiChatHostActions,
  IAiChatPort,
  IAiChatTitleBarPort,
  TAiChatPersistedState,
  TAiChatApprovalPolicy,
  TAiChatThinkingLevel,
} from "./contracts.js";

export type TAiChatCanvasExtensionOptions = Readonly<{
  port: IAiChatPort;
  browser: IAiChatBrowserPort;
  host: IAiChatHostActions;
  createSessionId(): string;
}>;

export const AI_CHAT_CANVAS_WIDGET_KIND = "ai-chat" as const;

export type TAiChatCanvasNodePayload = Readonly<{
  sessionId: string;
  approvalPolicy: TAiChatApprovalPolicy;
  model?: Readonly<{ provider: string; modelId: string }>;
  thinkingLevel?: TAiChatThinkingLevel;
}>;

const THINKING_LEVELS = new Set<TAiChatThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

function approvalPolicy(value: unknown): TAiChatApprovalPolicy | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Readonly<Record<string, unknown>>;
  if (record.mode === "manual" || record.mode === "always-approve") {
    return Object.freeze({ mode: record.mode });
  }
  if (
    record.mode !== "ai-review"
    || typeof record.reviewerModel !== "object"
    || record.reviewerModel === null
    || Array.isArray(record.reviewerModel)
  ) return null;
  const reviewerModel = record.reviewerModel as Readonly<Record<string, unknown>>;
  if (
    typeof reviewerModel.provider !== "string"
    || reviewerModel.provider.length === 0
    || typeof reviewerModel.modelId !== "string"
    || reviewerModel.modelId.length === 0
  ) return null;
  return Object.freeze({
    mode: "ai-review",
    reviewerModel: Object.freeze({
      provider: reviewerModel.provider,
      modelId: reviewerModel.modelId,
    }),
  });
}

function payload(node: Readonly<TWidgetFrameNode>): TAiChatCanvasNodePayload | null {
  const extension = fnReadCanvasWidgetExtension(node);
  if (
    extension?.type !== "ui-widget"
    || extension.kind !== AI_CHAT_CANVAS_WIDGET_KIND
  ) return null;
  const value = extension.payload;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  if (typeof value.sessionId !== "string" || value.sessionId.length === 0) return null;
  const selectedApprovalPolicy = approvalPolicy(value.approvalPolicy);
  if (selectedApprovalPolicy === null) return null;
  const model = typeof value.model === "object"
    && value.model !== null
    && !Array.isArray(value.model)
    && typeof value.model.provider === "string"
    && value.model.provider.length > 0
    && typeof value.model.modelId === "string"
    && value.model.modelId.length > 0
    ? Object.freeze({ provider: value.model.provider, modelId: value.model.modelId })
    : undefined;
  const thinkingLevel = typeof value.thinkingLevel === "string"
    && THINKING_LEVELS.has(value.thinkingLevel as TAiChatThinkingLevel)
    ? value.thinkingLevel as TAiChatThinkingLevel
    : undefined;
  return Object.freeze({
    sessionId: value.sessionId,
    approvalPolicy: selectedApprovalPolicy,
    ...(model === undefined ? {} : { model }),
    ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
  });
}

function persistedState(value: TAiChatCanvasNodePayload): TAiChatPersistedState {
  return Object.freeze({
    sessionId: value.sessionId,
    preference: Object.freeze({
      approvalPolicy: value.approvalPolicy,
      ...(value.model === undefined ? {} : { model: value.model }),
      ...(value.thinkingLevel === undefined
        ? {}
        : { thinkingLevel: value.thinkingLevel }),
    }),
  });
}

function payloadFromState(state: TAiChatPersistedState): TAiChatCanvasNodePayload {
  return Object.freeze({
    sessionId: state.sessionId,
    approvalPolicy: state.preference.approvalPolicy,
    ...(state.preference.model === undefined
      ? {}
      : { model: state.preference.model }),
    ...(state.preference.thinkingLevel === undefined
      ? {}
      : { thinkingLevel: state.preference.thinkingLevel }),
  });
}

function samePayload(
  left: TAiChatCanvasNodePayload,
  right: TAiChatCanvasNodePayload,
): boolean {
  return left.sessionId === right.sessionId
    && JSON.stringify(left.approvalPolicy) === JSON.stringify(right.approvalPolicy)
    && left.model?.provider === right.model?.provider
    && left.model?.modelId === right.model?.modelId
    && left.thinkingLevel === right.thinkingLevel;
}

function createAiChatNode(
  nodeId: string,
  parentId: string | null,
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>,
  sessionId: string,
): TWidgetFrameNode {
  const width = Math.max(240, bounds.width);
  const height = Math.max(160, bounds.height);
  return {
    id: nodeId,
    kind: "widget-frame",
    parentId,
    orderKey: "m",
    transform: {
      position: { x: bounds.x, y: bounds.y },
      rotation: 0,
      scale: { x: 1, y: 1 },
      skew: { x: 0, y: 0 },
      origin: { x: 0, y: 0 },
    },
    size: { width, height },
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

/** Contributes AI Chat through Canvas' renderer-neutral widget host. */
export function createAiChatCanvasExtension(
  options: TAiChatCanvasExtensionOptions,
): ICanvasExtension {
  return {
    name: "omnidraw.ai-chat",
    oneShotWidgetCreation: true,
    createWidgetNodes(context) {
      if (context.kind !== "widget") return null;
      return [createAiChatNode(
        context.nodeId,
        context.parentId,
        context.draft.worldBounds,
        options.createSessionId(),
      )];
    },
    install(context) {
      const actionHandlers = new Map<string, Map<string, () => void>>();
      const unregister = context.widgets.register({
        id: "omnidraw.ai-chat",
        match: (node) => payload(node) !== null,
        mount(args) {
          const currentPayload = payload(args.node);
          if (currentPayload === null) return;
          let currentNode = args.node;
          const [state, setState] = createSignal(persistedState(currentPayload));
          const actions = new Map<string, () => void>();
          actionHandlers.set(args.node.id, actions);
          const titleBar: IAiChatTitleBarPort = {
            onAction(id, handler) {
              actions.set(id, handler);
              return () => { if (actions.get(id) === handler) actions.delete(id); };
            },
            // Cangine renders the canonical authored header item. Publishing a
            // second extension titlebar would duplicate both title and action.
            setActionState() {},
          };
          const persist = (next: TAiChatPersistedState): void => {
            const extension = fnReadCanvasWidgetExtension(currentNode);
            if (extension?.type !== "ui-widget") return;
            const nextPayload = payloadFromState(next);
            const current = payload(currentNode);
            if (current !== null && samePayload(current, nextPayload)) return;
            context.document.commit({
              source: "omnidraw.ai-chat.state",
              coalesceKey: `omnidraw.ai-chat.state:${currentNode.id}`,
              commands: [{
                type: "upsert",
                node: {
                  ...currentNode,
                  extensions: {
                    ...(currentNode.extensions ?? {}),
                    [CANVAS_WIDGET_EXTENSION_KEY]: {
                      ...extension,
                      kind: AI_CHAT_CANVAS_WIDGET_KIND,
                      payload: nextPayload,
                    },
                  },
                },
              }],
            });
          };
          const releaseNode = args.onNodeChange?.((nextNode) => {
            currentNode = nextNode;
            const nextPayload = payload(nextNode);
            if (nextPayload !== null) setState(persistedState(nextPayload));
          });
          const dispose = render(() => AiChat({
            id: args.node.id,
            canvasId: context.config.canvasId,
            port: options.port,
            host: options.host,
            browser: options.browser,
            titleBar,
            get sessionId() { return state().sessionId; },
            get preference() { return state().preference; },
            onStateChange: persist,
            onResetSessionId: options.createSessionId,
          }), args.container);
          return () => {
            dispose();
            releaseNode?.();
            actionHandlers.delete(args.node.id);
          };
        },
        onAction({ node, actionId }) {
          actionHandlers.get(node.id)?.get(actionId)?.();
        },
      });
      return {
        dispose() {
          unregister();
          actionHandlers.clear();
        },
      };
    },
  };
}
