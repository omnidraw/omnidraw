/**
 * Transport-neutral contracts consumed by the public AI Chat component.
 *
 * These DTOs deliberately describe product meaning rather than any concrete
 * RPC, database, provider, or Effect representation. Application adapters are
 * responsible for translating their private wire protocol to this surface.
 */

export type TAiChatThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export type TAiChatModelRef = Readonly<{
  provider: string;
  modelId: string;
}>;

export type TAiChatModel = Readonly<{
  id: string;
  input: readonly ("text" | "image")[];
  provider: string;
  name: string;
}>;

export type TAiChatApprovalPolicy =
  | Readonly<{ mode: "always-approve" }>
  | Readonly<{ mode: "manual" }>
  | Readonly<{
      mode: "ai-review";
      reviewerModel: TAiChatModelRef;
    }>;

export type TAiChatSettings = Readonly<{
  defaultModel?: string;
  defaultProvider?: string;
  defaultThinkingLevel?: TAiChatThinkingLevel;
  providersWithCredentials: readonly string[];
  providers: readonly string[];
  models: readonly TAiChatModel[];
}>;

export type TAiChatSessionScope = Readonly<{
  /** The mounted AI Chat instance, independent of any Canvas implementation. */
  componentId: string;
  sessionId: string;
}>;

export type TAiChatConnectRequest = TAiChatSessionScope & Readonly<{
  canvasId: string;
  approvalPolicy: TAiChatApprovalPolicy;
  mode?: "reuse" | "replace";
}>;

export type TAiChatHistoryEntry = Readonly<{
  entryId?: string;
  message: unknown;
}>;

export type TAiChatCompletion = Readonly<{
  history: readonly TAiChatHistoryEntry[];
}>;

export type TAiChatPromptImage = Readonly<{
  name?: string;
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  data: string;
}>;

export type TAiChatWidgetReference = Readonly<{
  name: string;
  source: "draft" | "published";
}>;

export type TAiChatPromptRequest = TAiChatSessionScope & Readonly<{
  canvasId: string;
  text: string;
  images?: readonly TAiChatPromptImage[];
  widgetRefs?: readonly TAiChatWidgetReference[];
  model?: TAiChatModelRef;
  thinkingLevel?: TAiChatThinkingLevel;
}>;

export type TAiChatEditRequest = TAiChatSessionScope & Readonly<{
  canvasId: string;
  entryId: string;
  text: string;
  model?: TAiChatModelRef;
  thinkingLevel?: TAiChatThinkingLevel;
}>;

export type TAiChatCancellation = Readonly<{
  canceled: boolean;
  running: boolean;
}>;

export type TAiChatErrorCode =
  | "authentication"
  | "canceled"
  | "conflict"
  | "disconnected"
  | "invalid-request"
  | "not-found"
  | "provider"
  | "rate-limited"
  | "stream-ended"
  | "unavailable"
  | "unknown";

export type TAiChatError = Readonly<{
  code: TAiChatErrorCode;
  message: string;
  retriable: boolean;
  diagnosticCode?: string;
  provider?: string;
  model?: string;
}>;

export class AiChatActionError extends Error {
  readonly detail: TAiChatError;

  constructor(detail: TAiChatError) {
    super(detail.message);
    this.name = "AiChatActionError";
    this.detail = Object.freeze({ ...detail });
  }
}

export type TAiChatApprovalKind =
  | "resource-create"
  | "resource-update"
  | "resource-delete"
  | "resource-data-write";

export type TAiChatApproval = Readonly<{
  id: string;
  chatId: string;
  toolCallId: string;
  kind: TAiChatApprovalKind;
  summary: string;
  risk: "medium" | "high";
  warnings: readonly string[];
  details: unknown;
  createdAtSec: string;
  policyMode: TAiChatApprovalPolicy["mode"];
  decisionSource?: "policy" | "reviewer" | "user";
  reviewerReason?: string;
}>;

export type TAiChatApprovalDecision = "approve" | "reject";

export type TAiChatLoginStatus =
  | Readonly<{ status: "pending" }>
  | Readonly<{
      status: "device-code";
      userCode: string;
      verificationUri: string;
      intervalSeconds?: number;
      expiresInSeconds?: number;
      message?: string;
    }>
  | Readonly<{ status: "progress"; message: string }>
  | Readonly<{ status: "success" }>
  | Readonly<{ status: "aborted" }>
  | Readonly<{ status: "error"; message: string }>;

export type TAiChatToolIcon = Readonly<{
  lucidIcon?: string;
  svgIcon?: string;
}>;

export type TAiChatMention = Readonly<{
  id: string;
  label: string;
  kind: string;
  target?:
    | Readonly<{ type: "resource"; resourceId: string }>
    | Readonly<{
        type: "widget";
        name: string;
        source: "draft" | "published";
      }>;
  icon?:
    | Readonly<{ type: "resource"; kind: "kv" | "secretStore" | "db" }>
    | Readonly<{ type: "widget"; icon: TAiChatToolIcon | null }>;
}>;

export type TAiChatContextCatalog = Readonly<{
  mentions: readonly TAiChatMention[];
  resources: readonly Readonly<{
    id: string;
    kind: "kv" | "secretStore" | "db";
    name: string;
    status?: string;
  }>[];
}>;

export type TAiChatSessionEvent = Readonly<{
  kind: "session";
  componentId: string;
  sessionId: string;
  event:
    | Readonly<{ type: "agent-start" | "turn-start" }>
    | Readonly<{
        type: "agent-end";
        messages: readonly unknown[];
        willRetry: boolean;
      }>
    | Readonly<{
        type: "message-start" | "message-update" | "message-end" | "turn-end";
        message: unknown;
      }>;
}>;

export type TAiChatApprovalEvent = Readonly<{
  kind: "approval";
  componentId: string;
  sessionId: string;
  type: "created" | "resolved" | "canceled";
  approval: TAiChatApproval;
  decision?: TAiChatApprovalDecision;
  reason?: string;
}>;

export type TAiChatCatalogEvent = Readonly<{
  kind: "catalog";
  catalog: "resources" | "widgets";
}>;

export type TAiChatStreamEvent =
  | TAiChatSessionEvent
  | TAiChatApprovalEvent
  | TAiChatCatalogEvent;

export type TAiChatStreamRequest = TAiChatSessionScope & Readonly<{
  /** Re-establishes the durable chat preference during semantic recovery. */
  approvalPolicy: TAiChatApprovalPolicy;
  /** Opaque cursor acknowledged by a host adapter, if its transport supports it. */
  afterCursor?: string;
}>;

export interface IAiChatActions {
  getSettings(): Promise<TAiChatSettings>;
  setApprovalPolicy(
    request: TAiChatSessionScope & Readonly<{ policy: TAiChatApprovalPolicy }>,
  ): Promise<TAiChatApprovalPolicy>;
  connect(request: TAiChatConnectRequest): Promise<TAiChatCompletion>;
  getHistory(scope: TAiChatSessionScope): Promise<readonly TAiChatHistoryEntry[]>;
  prompt(request: TAiChatPromptRequest): Promise<void>;
  edit(request: TAiChatEditRequest): Promise<readonly TAiChatHistoryEntry[]>;
  cancel(scope: TAiChatSessionScope): Promise<TAiChatCancellation>;
  resetSession(scope: TAiChatSessionScope): Promise<void>;
  listApprovals(scope: TAiChatSessionScope): Promise<readonly TAiChatApproval[]>;
  resolveApproval(
    request: TAiChatSessionScope & Readonly<{
      approvalId: string;
      decision: TAiChatApprovalDecision;
    }>,
  ): Promise<void>;
  getContextCatalog(): Promise<TAiChatContextCatalog>;
  beginLogin(providerId: string): Promise<Readonly<{ loginId: string }>>;
  getLoginStatus(loginId: string): Promise<TAiChatLoginStatus>;
  abortLogin(loginId: string): Promise<void>;
  logout(providerId: string): Promise<void>;
  setApiKey(providerId: string, key: string): Promise<void>;
  removeApiKey(providerId: string): Promise<void>;
}

export interface IAiChatPort {
  readonly actions: IAiChatActions;
  events(
    request: TAiChatStreamRequest,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): AsyncIterable<TAiChatStreamEvent>;
  /** Signals a new physical transport generation that needs semantic reuse. */
  subscribeReconnect?(listener: () => void): () => void;
}

export interface IAiChatBrowserPort {
  readonly document: Document;
  createResizeObserver(
    callback: ResizeObserverCallback,
  ): Pick<ResizeObserver, "observe" | "disconnect">;
  createId(): string;
  createObjectUrl(file: File): string;
  revokeObjectUrl(url: string): void;
  readFileAsDataUrl(file: File): Promise<string>;
  writeClipboardText(text: string): Promise<void>;
  formatTime(value: string | number | Date): string;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
}

export interface IAiChatHostActions {
  openResource?(resourceId: string): void;
  openWidgetPreview?(request: Readonly<{ name: string }>): void | Promise<void>;
  invalidateCatalog?(catalog: "resources" | "widgets"): void;
  subscribeCatalogInvalidation?(
    catalog: "resources" | "widgets",
    listener: () => void,
  ): () => void;
  logError(error: unknown): void;
}

export type TAiChatTitleBarActionState = Readonly<{
  pressed?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  label?: string;
  content?: string;
}>;

export interface IAiChatTitleBarPort {
  onAction(id: string, handler: () => void): () => void;
  setActionState(id: string, state: TAiChatTitleBarActionState): void;
}

export type TAiChatPreference = Readonly<{
  approvalPolicy: TAiChatApprovalPolicy;
  model?: TAiChatModelRef;
  thinkingLevel?: TAiChatThinkingLevel;
}>;

export type TAiChatPersistedState = Readonly<{
  sessionId: string;
  preference: TAiChatPreference;
}>;

export type TAiChatProps = Readonly<{
  id: string;
  canvasId: string;
  port: IAiChatPort;
  host: IAiChatHostActions;
  browser: IAiChatBrowserPort;
  titleBar: IAiChatTitleBarPort;
  sessionId: string;
  preference?: TAiChatPreference;
  onPreferenceChange?(preference: TAiChatPreference): void;
  onStateChange?(state: TAiChatPersistedState): void;
  onResetSessionId(): string;
}>;
