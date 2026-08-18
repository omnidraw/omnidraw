import { showErrorToast, showSuccessToast } from "@/shell/framework/components/ui/Toast";
import {
  type TSidebarApiPort,
  type TSidebarController,
} from "@/shell/framework/feature/sidebar";
import {
  AiChatActionError,
  createAiChatCanvasExtension,
  type IAiChatActions,
  type IAiChatBrowserPort,
  type IAiChatPort,
  type TAiChatApproval,
  type TAiChatContextCatalog,
  type TAiChatHistoryEntry,
  type TAiChatStreamEvent,
} from "@omnidraw/component-ai-chat";
import type { TCanvasImagePort } from "@omnidraw/canvas";
import type { TFrontendRuntime } from "@/shell/runtime/frontend-runtime";
import { isPrivateRpcError } from "@/core/app/private-rpc-error";
import { fnAdvanceAgentEventCursor } from "@/core/chat/fn.agent-event-cursor";
import {
  fnChatConnectBusyHistoryFallback,
  fnRecoverChatStreamAfterDomainError,
} from "@/core/chat/fn.recover-chat-stream";
import { fxRecoverChat } from "@/core/chat/fx.recover-chat";
import type {
  TPrivateRequestArguments,
  TPrivateRequestOutput,
  TPrivateRequestPath,
} from "@/core/app/private-operation-contract";
import { FRONTEND_IDEMPOTENT_MUTATION_PATHS } from "../transport/frontend-api";

function createChatBrowserPort(runtime: TFrontendRuntime): IAiChatBrowserPort {
  const ownerWindow = runtime.ownerWindow as Window & typeof globalThis;
  return {
  document: runtime.ownerDocument,
  createResizeObserver: (callback) => new ownerWindow.ResizeObserver(callback),
  createId: () => ownerWindow.crypto.randomUUID(),
  createObjectUrl: (file) => ownerWindow.URL.createObjectURL(file),
  revokeObjectUrl: (url) => ownerWindow.URL.revokeObjectURL(url),
  readFileAsDataUrl: (file) => new Promise<string>((resolve, reject) => {
    const reader = new ownerWindow.FileReader();
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("Image file did not produce a data URL"));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image file"));
    reader.readAsDataURL(file);
  }),
  writeClipboardText: (text) => ownerWindow.navigator.clipboard.writeText(text),
  formatTime: (value) => new ownerWindow.Date(value).toLocaleTimeString(),
  requestAnimationFrame: (callback) => ownerWindow.requestAnimationFrame(callback),
  cancelAnimationFrame: (handle) => ownerWindow.cancelAnimationFrame(handle),
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function actionError(error: unknown, fallback: string): AiChatActionError {
  const value = record(error);
  const message = error instanceof Error
    ? error.message
    : typeof value.message === "string" ? value.message : fallback;
  const code = isPrivateRpcError(error)
    ? error.code
    : typeof value.code === "string" ? value.code : "";
  const status = isPrivateRpcError(error) ? error.status : 0;
  const kind = code === "CHAT_BUSY" || code.includes("CONFLICT")
    ? "conflict" as const
    : code.includes("INVALID") || code.includes("REQUIRED") || status === 400
      ? "invalid-request" as const
      : code.includes("SCOPE") || status === 404
        ? "not-found" as const
        : status === 429 || code.includes("RATE")
          ? "rate-limited" as const
          : status === 503 || code.includes("UNAVAILABLE") || code.includes("STOPPING")
            ? "unavailable" as const
            : code.includes("AUTH")
              ? "authentication" as const
              : code.includes("PROVIDER")
                ? "provider" as const
                : error instanceof DOMException && error.name === "AbortError"
                  ? "canceled" as const
                  : status === 0 || code === "TRANSPORT_FAILURE"
                    ? "disconnected" as const
                    : "unknown" as const;
  return new AiChatActionError({
    code: kind,
    message,
    retriable: kind === "disconnected" || kind === "rate-limited" || kind === "unavailable" || kind === "provider",
    ...(code === "" ? {} : { diagnosticCode: code }),
  });
}

function loginProviderId(value: string): "openai-codex" | "github-copilot" {
  if (value === "openai-codex" || value === "github-copilot") return value;
  throw new AiChatActionError({
    code: "invalid-request",
    message: `Unsupported interactive login provider '${value}'.`,
    retriable: false,
  });
}

export async function recoverChatEventStream<T>(
  error: unknown,
  cursor: number,
  recoverHistory: () => Promise<T>,
): Promise<Readonly<{ cursor: number; events: readonly T[] }> | null> {
  const recovery = fnRecoverChatStreamAfterDomainError(error, cursor);
  if (recovery === null) return null;
  if (recovery.kind === "keep-listening") return { cursor, events: [] };
  try {
    return { cursor: recovery.cursor, events: [await recoverHistory()] };
  } catch (recoveryError) {
    if (fnRecoverChatStreamAfterDomainError(recoveryError, recovery.cursor)?.kind === "keep-listening") {
      return { cursor: recovery.cursor, events: [] };
    }
    throw recoveryError;
  }
}

function history(value: unknown): readonly TAiChatHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const item = record(entry);
    return "message" in item
      ? { ...(typeof item.entryId === "string" ? { entryId: item.entryId } : {}), message: item.message }
      : { message: entry };
  });
}

function approval(value: unknown): TAiChatApproval {
  const item = record(value);
  return {
    id: String(item.id ?? ""),
    chatId: String(item.chatId ?? item.sessionId ?? ""),
    toolCallId: String(item.toolCallId ?? ""),
    kind: (item.kind === "resource-update" || item.kind === "resource-delete" || item.kind === "resource-data-write")
      ? item.kind
      : "resource-create",
    summary: String(item.summary ?? "Approval required"),
    risk: item.risk === "high" ? "high" : "medium",
    warnings: Array.isArray(item.warnings) ? item.warnings.map(String) : [],
    details: item.details,
    createdAtSec: String(item.createdAtSec ?? item.createdAt ?? ""),
    policyMode: item.policyMode === "always-approve" || item.policyMode === "ai-review"
      ? item.policyMode
      : "manual",
    ...(item.decisionSource === "policy" || item.decisionSource === "reviewer" || item.decisionSource === "user"
      ? { decisionSource: item.decisionSource }
      : {}),
    ...(typeof item.reviewerReason === "string" ? { reviewerReason: item.reviewerReason } : {}),
  };
}

export function normalizeAgentEvent(value: unknown): TAiChatStreamEvent | null {
  const item = record(value);
  if (item.kind === "widget-catalog") {
    return { kind: "catalog", catalog: "widgets" };
  }
  if (item.kind === "recovered-history") {
    return {
      kind: "session",
      componentId: String(item.componentId ?? ""),
      sessionId: String(item.sessionId ?? ""),
      event: {
        type: "agent-end",
        messages: history(item.history).map((entry) => entry.message),
        willRetry: false,
      },
    };
  }
  if (item.kind === "catalog" && (item.catalog === "resources" || item.catalog === "widgets")) {
    return { kind: "catalog", catalog: item.catalog };
  }
  const componentId = typeof item.componentId === "string"
    ? item.componentId
    : typeof item.widgetId === "string" ? item.widgetId : "";
  const sessionId = typeof item.sessionId === "string" ? item.sessionId : "";
  if (item.kind === "approval") {
    const type = item.type === "created" || item.type === "resolved" || item.type === "canceled"
      ? item.type
      : null;
    if (type === null) return null;
    return {
      kind: "approval",
      componentId,
      sessionId,
      type,
      approval: approval(item.approval),
      ...(item.decision === "approve" || item.decision === "reject" ? { decision: item.decision } : {}),
      ...(typeof item.reason === "string" ? { reason: item.reason } : {}),
    };
  }
  const rawEvent = record(item.event);
  const rawType = String(rawEvent.type ?? "").replaceAll("_", "-");
  if (rawType === "agent-start" || rawType === "turn-start") {
    return { kind: "session", componentId, sessionId, event: { type: rawType } };
  }
  if (rawType === "agent-end") {
    return {
      kind: "session",
      componentId,
      sessionId,
      event: {
        type: "agent-end",
        messages: Array.isArray(rawEvent.messages) ? rawEvent.messages : [],
        willRetry: rawEvent.willRetry === true,
      },
    };
  }
  if (rawType === "message-start" || rawType === "message-update" || rawType === "message-end" || rawType === "turn-end") {
    return { kind: "session", componentId, sessionId, event: { type: rawType, message: rawEvent.message } };
  }
  return null;
}

function createChatPort(runtime: TFrontendRuntime, canvasId: string): IAiChatPort {
  const action = async <Path extends TPrivateRequestPath>(
    path: Path,
    ...args: TPrivateRequestArguments<Path>
  ): Promise<TPrivateRequestOutput<Path>> => {
    try {
      const [input, options] = args;
      return await runtime.rpc.request(path, input as never, {
        ...options,
        ...(FRONTEND_IDEMPOTENT_MUTATION_PATHS.has(path)
          ? { idempotencyKey: runtime.ownerWindow.crypto.randomUUID() }
          : {}),
      });
    } catch (error) {
      throw actionError(error, `${path} failed.`);
    }
  };
  const chatActions: IAiChatActions = {
    getSettings: () => action("agent.settings.get"),
    setApprovalPolicy: (request) => action("agent.chat.approvalPolicy.update", {
      widgetId: request.componentId,
      sessionId: request.sessionId,
      policy: request.policy,
    }),
    async connect(request) {
      try {
        const response = record(await runtime.rpc.request("agent.chat.connect", {
          canvasId: request.canvasId,
          widgetId: request.componentId,
          sessionId: request.sessionId,
          approvalPolicy: request.approvalPolicy,
          mode: request.mode,
        }));
        return { history: history(response.history ?? response.messageHistory) };
      } catch (error) {
        if (
          isPrivateRpcError(error)
          && error.code === "CHAT_BUSY"
          && fnChatConnectBusyHistoryFallback(request.mode)
        ) {
          return { history: await chatActions.getHistory({
            componentId: request.componentId,
            sessionId: request.sessionId,
          }) };
        }
        throw actionError(error, "agent.chat.connect failed.");
      }
    },
    getHistory: async (scope) => history(await action("agent.chat.history", {
      widgetId: scope.componentId,
      sessionId: scope.sessionId,
    })),
    prompt: async (request) => { await action("agent.chat.prompt", {
      canvasId: request.canvasId,
      widgetId: request.componentId,
      sessionId: request.sessionId,
      text: request.text,
      images: request.images,
      ...(request.widgetRefs === undefined ? {} : { widgetRefs: request.widgetRefs }),
      ...(request.model === undefined ? {} : { model: request.model }),
      ...(request.thinkingLevel === undefined ? {} : { thinkingLevel: request.thinkingLevel }),
    }); },
    edit: async (request) => history(await action("agent.chat.edit", {
      canvasId: request.canvasId,
      widgetId: request.componentId,
      sessionId: request.sessionId,
      entryId: request.entryId,
      text: request.text,
      ...(request.model === undefined ? {} : { model: request.model }),
      ...(request.thinkingLevel === undefined ? {} : { thinkingLevel: request.thinkingLevel }),
    })),
    cancel: (scope) => action("agent.chat.cancel", {
      widgetId: scope.componentId,
      sessionId: scope.sessionId,
    }),
    resetSession: async (scope) => { await action("agent.chat.newSession", { widgetId: scope.componentId, sessionId: scope.sessionId }); },
    listApprovals: async (scope) => {
      const values = await action("agent.approval.list", { widgetId: scope.componentId, sessionId: scope.sessionId });
      return values.map(approval);
    },
    resolveApproval: async (request) => {
      await action("agent.approval.resolve", {
        widgetId: request.componentId,
        sessionId: request.sessionId,
        approvalId: request.approvalId,
        decision: request.decision,
      });
    },
    async getContextCatalog(): Promise<TAiChatContextCatalog> {
      const [[resourceError, resources], [widgetError, widgets]] = await Promise.all([
        runtime.api.safeRequest("resource.resources.list"),
        runtime.api.safeRequest("widget.catalog.get"),
      ]);
      if (resourceError) throw resourceError;
      if (widgetError) throw widgetError;
      const resourceMentions = (resources ?? []).map((resource) => ({
        id: `resource:${resource.id}`,
        label: resource.name,
        kind: "resource",
        target: { type: "resource" as const, resourceId: resource.id },
        icon: { type: "resource" as const, kind: resource.kind },
      }));
      const widgetMentions = (widgets?.entries ?? []).flatMap((entry) => {
        const values = [];
        if (entry.published?.config) values.push({
          id: `widget:published:${entry.widgetKey}`,
          label: entry.published.config.name,
          kind: "widget",
          target: { type: "widget" as const, name: entry.widgetKey, source: "published" as const },
          icon: { type: "widget" as const, icon: entry.published.config.tool.icon },
        });
        if (entry.draft?.config) values.push({
          id: `widget:draft:${entry.widgetKey}`,
          label: entry.draft.config.name,
          kind: "widget",
          target: { type: "widget" as const, name: entry.widgetKey, source: "draft" as const },
          icon: { type: "widget" as const, icon: entry.draft.config.tool.icon },
        });
        return values;
      });
      return {
        mentions: [...resourceMentions, ...widgetMentions],
        resources: (resources ?? []).map(({ id, kind, name, status }) => ({ id, kind, name, status })),
      };
    },
    beginLogin: (providerId) => action("agent.auth.login", { providerId: loginProviderId(providerId) }),
    getLoginStatus: (loginId) => action("agent.auth.status", { loginId }),
    abortLogin: async (loginId) => { await action("agent.auth.abort", { loginId }); },
    logout: async (providerId) => { await action("agent.auth.logout", { providerId: loginProviderId(providerId) }); },
    setApiKey: async (providerId, key) => { await action("agent.auth.apiKey.set", { providerId, key }); },
    removeApiKey: async (providerId) => { await action("agent.auth.apiKey.remove", { providerId }); },
  };

  const chatPort: IAiChatPort = {
  actions: Object.freeze(chatActions),
  events(request, options) {
    const events = runtime.rpc.resumableStream<"agent.events", number, Readonly<{
      kind: "recovered-history";
      componentId: string;
      sessionId: string;
      history: readonly unknown[];
    }>>({
      path: "agent.events",
      initialCursor: 0,
      input: (afterSequence) => ({ afterSequence }),
      advance: (cursor, event) => fnAdvanceAgentEventCursor(cursor, record(event)),
      isDuplicate: (cursor, event) => typeof event.sequence === "number" && event.sequence <= cursor,
      recoverAfterDomainError: async (error, cursor) => recoverChatEventStream(
        error,
        cursor,
        () => runtime.runPromise(fxRecoverChat({
          canvasId,
          componentId: request.componentId,
          sessionId: request.sessionId,
          approvalPolicy: request.approvalPolicy,
        })),
      ),
      signal: options?.signal,
    });
    return {
      async *[Symbol.asyncIterator]() {
        for await (const value of events) {
          const normalized = normalizeAgentEvent(value);
          if (normalized !== null) yield normalized;
        }
      },
    };
  },
  subscribeReconnect(listener) {
    let previous = runtime.rpc.generations.snapshot();
    return runtime.rpc.generations.subscribe((next) => {
      const reconnected = next.connected
        && next.generation > 1
        && next.generation > previous.generation;
      previous = next;
      if (reconnected) listener();
    });
  },
  };
  return chatPort;
}

async function fileJson<T>(runtime: TFrontendRuntime, path: string, init: RequestInit): Promise<T> {
  const response = await runtime.ownerWindow.fetch(path, init);
  if (!response.ok) throw new Error(`File request failed (${response.status}).`);
  return await response.json() as T;
}

export function createCanvasImagePort(runtime: TFrontendRuntime): TCanvasImagePort {
  const ownerWindow = runtime.ownerWindow as Window & typeof globalThis;
  return {
  async uploadImage(body) {
    const form = new ownerWindow.FormData();
    form.set("file", new ownerWindow.Blob([new Uint8Array(body.data)], { type: body.mime_type }));
    form.set("mimeType", body.mime_type);
    return fileJson(runtime, "/files", { method: "POST", body: form });
  },
  cloneImage: (body) => fileJson(runtime, "/files/clone", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }),
  deleteImage: (body) => fileJson(runtime, "/files", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }),
  };
}

export function createFrontendAiChatExtension(runtime: TFrontendRuntime, args: {
  canvasId: string;
  navigate(path: string): void;
  ensureWidgetPreview?(name: string): void | Promise<void>;
}) {
  return createAiChatCanvasExtension({
    port: createChatPort(runtime, args.canvasId),
    browser: createChatBrowserPort(runtime),
    createSessionId: () => runtime.ownerWindow.crypto.randomUUID(),
    host: {
      openResource: (resourceId) => args.navigate(`/resources/${encodeURIComponent(resourceId)}`),
      openWidgetPreview: ({ name }) => args.ensureWidgetPreview?.(name)
        ?? args.navigate(`/widgets/draft/${encodeURIComponent(name)}`),
      invalidateCatalog: (kind) => runtime.catalogInvalidation.invalidate(kind),
      subscribeCatalogInvalidation: (kind, listener) => runtime.catalogInvalidation.subscribe(kind, listener),
      logError: (error) => console.error(error),
    },
  });
}

export function createFrontendSidebarController(runtime: TFrontendRuntime, args: {
  pathname(): string;
  navigate(path: string, options?: { replace?: boolean }): void;
}): TSidebarController {
  const api = {
    canvas: {
      create: (input) => runtime.api.safeRequest("canvas.create", input),
      list: (input = {}) => runtime.api.safeRequest("canvas.list", input),
      update: (input) => runtime.api.safeRequest("canvas.update", input),
      deletionPlan: (input) => runtime.api.safeRequest("canvas.deletionPlan", input),
      remove: (input) => runtime.api.safeRequest("canvas.remove", input),
    },
    resource: {
      resources: {
        list: (input = {}) => runtime.api.safeRequest("resource.resources.list", input),
        create: (input) => runtime.api.safeRequest("resource.resources.create", input),
      },
    },
    widget: {
      catalog: {
        get: () => runtime.api.safeRequest("widget.catalog.get"),
        events: async (input) => [null, runtime.api.widgetCatalogEvents(input)] as const,
        files: {
          list: (input) => runtime.api.safeRequest("widget.catalog.files.list", input),
          read: (input) => runtime.api.safeRequest("widget.catalog.files.read", input),
        },
      },
      config: {
        saveDraft: (input) => runtime.api.safeRequest("widget.config.saveDraft", input),
      },
      deletion: {
        plan: (input) => runtime.api.safeRequest("widget.deletion.plan", input),
        commit: (input) => runtime.api.safeRequest("widget.deletion.commit", input),
      },
      preview: {
        rebuildDraft: (input) => runtime.api.safeRequest("widget.preview.rebuildDraft", input),
      },
      publication: {
        publishMetadata: (input) => runtime.api.safeRequest("widget.publication.publishMetadata", input),
        updateIcon: (input) => runtime.api.safeRequest("widget.publication.updateIcon", input),
        buildAndPublish: (input) => runtime.api.safeRequest("widget.publication.buildAndPublish", input),
      },
    },
  } satisfies TSidebarApiPort["api"];
  return {
    apiService: { api },
    browser: {
      createIdempotencyKey: () => runtime.ownerWindow.crypto.randomUUID(),
      setTimeout: (callback, timeout) => runtime.ownerWindow.setTimeout(callback, timeout),
      clearTimeout: (timer) => runtime.ownerWindow.clearTimeout(timer as number),
    },
    invalidation: runtime.catalogInvalidation,
    lifecycle: Object.freeze({ fork: runtime.fork }),
    subscribeReconnect(listener) {
      let previous = runtime.rpc.generations.snapshot().generation;
      return runtime.rpc.generations.subscribe((state) => {
        if (state.connected && state.generation > previous) listener();
        previous = Math.max(previous, state.generation);
      });
    },
    widgetPlacement: runtime.widgetPlacement,
    application: {
      pathname: args.pathname,
      canvases: () => runtime.store.state.canvases,
      navigate: args.navigate,
      canvasCreated: (canvas) => runtime.store.set("canvases", (current) => [...current, canvas]),
      canvasUpdated: (canvas) => runtime.store.set("canvases", (current) => current.map((item) => item.id === canvas.id ? canvas : item)),
      canvasesReplaced: (canvases) => runtime.store.set("canvases", [...canvases]),
      themeAppearance: () => {
        void runtime.store.state.theme;
        return runtime.theme.service.getTheme().appearance;
      },
      setThemeAppearance: (appearance) => runtime.theme.setAppearance(appearance),
      toggleSidebar: () => runtime.store.set("sidebarVisible", (visible) => !visible),
      notifyError: showErrorToast,
      notifySuccess: showSuccessToast,
    },
  };
}
