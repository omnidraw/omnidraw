import type {
  IAiChatActions,
  IAiChatBrowserPort,
  IAiChatHostActions,
  IAiChatPort,
  TAiChatStreamEvent,
} from "../src/index.js";

export function ensureDom(): void {
  if (typeof document === "undefined" || typeof window === "undefined") {
    throw new Error("AI Chat tests require the jsdom environment");
  }
}

export function createTestChatBrowser(): IAiChatBrowserPort {
  ensureDom();
  return {
    document,
    createResizeObserver: () => ({ observe: () => {}, disconnect: () => {} }),
    createId: () => "00000000-0000-4000-8000-000000000001",
    createObjectUrl: () => "blob:test",
    revokeObjectUrl: () => {},
    readFileAsDataUrl: async () => "data:image/png;base64,dGVzdA==",
    writeClipboardText: async () => {},
    formatTime: () => "12:00:00 AM",
    requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
    cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
  };
}

export function createTestHostActions(
  overrides: Partial<IAiChatHostActions> = {},
): IAiChatHostActions {
  return { logError: () => {}, ...overrides };
}

function idleEvents(signal?: AbortSignal): AsyncIterable<TAiChatStreamEvent> {
  return {
    [Symbol.asyncIterator]() {
      let finish: (() => void) | undefined;
      const finished = new Promise<void>((resolve) => { finish = resolve; });
      signal?.addEventListener("abort", () => finish?.(), { once: true });
      return {
        async next() {
          await finished;
          return { done: true as const, value: undefined };
        },
        async return() {
          finish?.();
          return { done: true as const, value: undefined };
        },
      };
    },
  };
}

export function createTestAiChatPort(
  overrides: Partial<IAiChatActions> = {},
  events: IAiChatPort["events"] = (_request, options) => idleEvents(options?.signal),
): IAiChatPort {
  const actions: IAiChatActions = {
    getSettings: async () => ({
      defaultThinkingLevel: "minimal",
      models: [],
      providers: [],
      providersWithCredentials: ["test-provider"],
      approvalPolicy: { mode: "manual" },
    }),
    setApprovalPolicy: async (policy) => policy,
    connect: async () => ({ history: [] }),
    getHistory: async () => [],
    prompt: async () => {},
    edit: async () => [],
    cancel: async () => ({ canceled: false, running: false }),
    resetSession: async () => {},
    listApprovals: async () => [],
    resolveApproval: async () => {},
    getContextCatalog: async () => ({ mentions: [], resources: [] }),
    beginLogin: async () => ({ loginId: "test-login" }),
    getLoginStatus: async () => ({ status: "success" }),
    abortLogin: async () => {},
    logout: async () => {},
    setApiKey: async () => {},
    removeApiKey: async () => {},
    ...overrides,
  };
  return { actions, events };
}
