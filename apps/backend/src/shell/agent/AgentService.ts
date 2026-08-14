import { createAgentSessionFromServices, createAgentSessionServices, ModelRuntime, SessionManager, sessionEntryToContextMessages, SettingsManager, type AgentSession } from '@earendil-works/pi-coding-agent';
import type { IEventPublisherService } from '#backend/shell/events/types';
import {
  ZWidgetManifestV1,
  type TWidgetManifestV1,
} from '@omnidraw/sdk/contract';
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fnLatestWidgetDbChangeProposalRecord } from '../../core/agent/fn.session-records';
import { normalizeSessionCwd } from './workspace/normalize-session-cwd';
import { appendWidgetDbChangeProposalRecord } from './session-records';
import {
  AgentServiceError,
  type TAgentServiceErrorCode,
} from '../../core/agent/error.agent-service';
import { WIDGET_CHAT_SYSTEM_PROMPT } from './prompts/index';
import { ApprovalCoordinator } from './approval/ApprovalCoordinator';
import { ApprovalPolicyStore } from './approval/ApprovalPolicyStore';
import {
  fnNormalizeApprovalPolicy,
  fnNormalizeApprovalReviewDecision,
} from './approval/fn.approval-policy';
import type {
  TApprovalDecision,
  TApprovalPolicy,
  TApprovalReviewer,
  TApprovalReviewInput,
  TApprovalView,
  TToolAuthorizer,
} from './approval/types';
import { createToolRegistry } from './tools/ToolRegistry';
import type { TAgentResourceService } from './tools/resource-service';
import type { TAgentBashCapability } from './tools/tool.bash';
import { fnRedactSecretResourceWriteMessage } from './tools/fn.redact-secret-resource-write';
import { fnIsStructuredToolErrorDetails } from './tools/fn.result';
import { fnFindEditableUserMessage, fnProjectActiveChatHistory, type TAgentChatHistoryItem } from './fn.chat-history';
import type {
  TWidgetDbChangeProposalRecord,
  TWidgetPreviewBuildCheck,
  TWidgetPreviewInspectionCapability,
} from './tools/types';
import { WidgetWorkspace } from './workspace/WidgetWorkspace';
import type { TWidgetMount } from './workspace/types';
import {
  fnWidgetPromptSelectionMessage,
  type TWidgetPromptSelectionContext,
  type TWidgetReferenceResolver,
} from './widget-reference';

interface IPublicMethods {
  logout(providerId: string): Promise<void>;
  setApiKey(providerId: string, key: string): Promise<void>;
  removeApiKey(providerId: string): Promise<void>;
}

export interface IAgentServiceConfig {
  world: Readonly<{
    platform: NodeJS.Platform;
    createId: () => string;
    now: () => Date;
  }>;
  dataPath: string;
  widgetDraftsRoot: string;
  npmUserConfigPath?: string;
  prepareWidgetNpmDependencies?: () => Promise<void>;
  /** Notified after any agent-owned draft change so the app can rescan the
   * shared widget root and invalidate catalogs. */
  onWidgetDraftsChanged?: () => void;
  /** Runs the real host Preview build for one draft slug during validation. */
  previewBuild?: TWidgetPreviewBuildCheck;
  /** Runs one exact draft artifact in a fresh isolated browser for agent inspection. */
  previewInspection?: TWidgetPreviewInspectionCapability;
  eventPublisherService: IEventPublisherService,
  chats: Readonly<{
    get(args: Readonly<{ id: string }>): Promise<Readonly<{
      status: 'active' | 'archived' | 'error';
      canvasId: string | null;
    }> | null>;
    create(args: Readonly<{
      id: string;
      canvasId: string | null;
      name: string;
      workspaceRelativePath: string;
      historyRelativePath: string;
    }>): Promise<unknown>;
    update(args: Readonly<{
      id: string;
      name?: string;
      status?: 'active' | 'archived' | 'error';
      canvasId?: string | null;
    }>): Promise<unknown>;
  }>;
  chatScope: Readonly<{
    defaultCanvasId?: string;
    validate(args: Readonly<{ canvasId: string; widgetId: string }>): Promise<boolean>;
  }>;
  widgetReferenceResolver: TWidgetReferenceResolver;
  resourceService?: TAgentResourceService;
  bashCapability?: TAgentBashCapability;
  authorizeToolCall?: TToolAuthorizer;
  approvalReviewer?: TApprovalReviewer;
  approvalPolicyStore?: Readonly<{
    load(): Promise<TApprovalPolicy>;
    save(policy: TApprovalPolicy): Promise<TApprovalPolicy>;
  }>;
}

type TWidgetId = string;
// Persisted/API `sessionId` is the Omnidraw chat identity. Pi owns a separate
// session ID inside each JSONL transcript header and filename.
type TOmnidrawChatId = string;
type TLoginId = string;
type TChatConnectMode = 'reuse' | 'replace';
type TPromptModel = {
  provider: string;
  modelId: string;
};
type TPromptImage = {
  type: 'image';
  data: string;
  mimeType: string;
};
type TPromptInputImage = {
  name?: string;
  data: string;
  mimeType: string;
};
type TPromptSelection = {
  canvasId?: string;
  images?: TPromptInputImage[];
  model?: TPromptModel;
  widgetRefs?: Array<{ name: string; source: 'draft' | 'published' }>;
  thinkingLevel?: TThinkingLevel;
};
type TThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
type TAgentLoginStatus =
  | { status: 'pending' }
  | { status: 'device-code'; userCode: string; verificationUri: string; intervalSeconds?: number; expiresInSeconds?: number; message?: string }
  | { status: 'progress'; message: string }
  | { status: 'success' }
  | { status: 'aborted' }
  | { status: 'error'; message: string };
type TLoginSession = {
  controller: AbortController;
  status: TAgentLoginStatus;
};

type TAgentConnectResult = {
  vcJson: TWidgetManifestV1 | null;
  messageHistory: TAgentChatHistoryItem[];
};
type TAgentCancelResult = {
  canceled: boolean;
  running: boolean;
};
type TChatSessionEntry = {
  unsub: () => void;
  session: AgentSession;
  sessionManager: SessionManager;
};
type TChatConnectGenerationResult =
  | { status: 'connected'; result: TAgentConnectResult }
  | { status: 'superseded' };

const PROMPT_IMAGE_FALLBACK_TEXT = 'Please use the attached image.'
const PROMPT_IMAGE_MAX_COUNT = 5
const PROMPT_IMAGE_MAX_BYTES = 10 * 1024 * 1024
const PROMPT_IMAGE_MAX_BASE64_LENGTH = Math.ceil(PROMPT_IMAGE_MAX_BYTES / 3) * 4
const PROMPT_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const PROMPT_IMAGE_BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/
export class AgentService implements IPublicMethods {
  name = 'agent-service'
  #config: IAgentServiceConfig;
  #piAgentDir: string;
  modelRuntime!: ModelRuntime;
  settingsManager: SettingsManager;
  sessionMap: Record<TWidgetId, Record<TOmnidrawChatId, TChatSessionEntry>> = {}
  #loginMap: Record<TLoginId, TLoginSession> = {}
  #dbChangeProposalResolutions = new Set<string>();
  #workspace: WidgetWorkspace;
  #approvals: ApprovalCoordinator;
  #approvalPolicy: TApprovalPolicy = Object.freeze({ mode: 'manual' });
  #approvalPolicyStore: NonNullable<IAgentServiceConfig['approvalPolicyStore']>;
  #chatWidgetIds = new Map<TOmnidrawChatId, TWidgetId>();
  #chatCanvasIds = new Map<TOmnidrawChatId, string>();
  #promptWidgetSelections = new Map<TOmnidrawChatId, TWidgetPromptSelectionContext>();
  #chatConnectionGenerations = new Map<TOmnidrawChatId, number>();
  #chatConnectionLanes = new Map<TOmnidrawChatId, Promise<void>>();
  #chatConnectionCanvasScopes = new Map<TOmnidrawChatId, Map<string, number>>();
  #chatReplacementGenerations = new Map<TOmnidrawChatId, number>();
  #chatMutations = new Map<TOmnidrawChatId, {
    count: number;
    kind: 'connect' | 'edit' | 'new' | 'prompt';
    settled: Promise<void>;
    settle(): void;
  }>();
  #chatEditPromptStarts = new Map<TOmnidrawChatId, { promise: Promise<boolean>; resolve: (started: boolean) => void }>();
  #chatCanceling = new Set<TOmnidrawChatId>();
  #retiringCanvasIds = new Set<string>();
  #isStopping = false;

  constructor(config: IAgentServiceConfig) {
    this.#config = config
    this.#piAgentDir = join(config.dataPath, 'pi', 'agent')
    this.#workspace = new WidgetWorkspace({
      dataPath: config.dataPath,
      draftRoot: config.widgetDraftsRoot,
      platform: config.world.platform,
      createId: config.world.createId,
      npmUserConfigPath: config.npmUserConfigPath,
      prepareNpmDependencies: config.prepareWidgetNpmDependencies,
    })
    this.#approvalPolicyStore = config.approvalPolicyStore
      ?? new ApprovalPolicyStore(join(this.#piAgentDir, 'approval-policy.json'))
    this.#approvals = new ApprovalCoordinator({
      createId: config.world.createId,
      now: config.world.now,
      authorize: config.authorizeToolCall,
      policy: () => this.#approvalPolicy,
      reviewer: config.approvalReviewer ?? {
        review: (input, signal) => this.#reviewProtectedOperation(input, signal),
      },
      onChanged: (event) => {
        const widgetId = this.#chatWidgetIds.get(event.approval.chatId)
        if (!widgetId) return
        this.#config.eventPublisherService.publishAgentEvent({
          kind: 'approval',
          widgetId,
          sessionId: event.approval.chatId,
          type: event.type,
          approval: event.approval,
          decision: event.decision,
          reason: event.reason,
        })
      },
    })
    this.settingsManager = SettingsManager.create(this.#piAgentDir, this.#piAgentDir, { projectTrusted: true })
  }

  async start(): Promise<void> {
    this.#isStopping = false
    this.modelRuntime = await ModelRuntime.create({
      authPath: join(this.#piAgentDir, 'auth.json'),
      modelsPath: join(this.#piAgentDir, 'models.json'),
    })
    this.#approvalPolicy = fnNormalizeApprovalPolicy(
      await this.#approvalPolicyStore.load(),
    )
    await this.#workspace.init()
  }

  async stop(): Promise<void> {
    this.#isStopping = true
    const failures: unknown[] = []
    for (const sessionId of this.#chatConnectionGenerations.keys()) {
      this.#chatConnectionGenerations.set(sessionId, (this.#chatConnectionGenerations.get(sessionId) ?? 0) + 1)
    }
    const connectionResults = await Promise.allSettled(this.#chatConnectionLanes.values())
    failures.push(...connectionResults
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason))
    const chatDisposals: Promise<void>[] = []
    for (const [id, sessions] of Object.entries(this.sessionMap)) {
      for (const sessionId of Object.keys(sessions)) {
        chatDisposals.push(this.#disposeChatSession(id, sessionId))
      }
    }
    const disposalResults = await Promise.allSettled(chatDisposals)
    failures.push(...disposalResults
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason))
    this.#chatWidgetIds.clear()
    this.#chatCanvasIds.clear()
    this.#promptWidgetSelections.clear()
    this.#chatConnectionGenerations.clear()
    this.#chatConnectionLanes.clear()
    this.#chatConnectionCanvasScopes.clear()
    this.#chatReplacementGenerations.clear()
    this.#chatMutations.clear()
    for (const promptStart of this.#chatEditPromptStarts.values()) promptStart.resolve(false)
    this.#chatEditPromptStarts.clear()
    this.#chatCanceling.clear()
    this.#retiringCanvasIds.clear()
    try {
      this.#approvals.close()
    } catch (error) {
      failures.push(error)
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Agent service shutdown failed.')
  }

  async connectChat(
    id: TWidgetId,
    sessionId: string,
    canvasIdOrMode?: string,
    requestedMode?: TChatConnectMode,
  ): Promise<TAgentConnectResult> {
    const mode = requestedMode
      ?? (canvasIdOrMode === 'reuse' || canvasIdOrMode === 'replace'
        ? canvasIdOrMode
        : 'reuse')
    const canvasId = requestedMode === undefined
      && (canvasIdOrMode === undefined || canvasIdOrMode === 'reuse' || canvasIdOrMode === 'replace')
        ? this.#config.chatScope.defaultCanvasId
        : canvasIdOrMode
    if (canvasId === undefined) {
      throw this.#chatConnectionError('CHAT_CANVAS_REQUIRED', 'Verified canvas scope is required.')
    }
    this.#assertCanvasNotRetiring(canvasId)
    const releaseMutation = this.#claimChatMutation(sessionId, 'connect', true)
    const releaseCanvasScope = this.#trackChatConnectionCanvasScope(sessionId, canvasId)
    try {
      const generation = this.#nextChatConnectionGeneration(sessionId)
      if (mode === 'replace') this.#chatReplacementGenerations.set(sessionId, generation)
      const outcome = await this.#runChatConnectionLane(
        sessionId,
        async () => {
          await this.#assertVerifiedChatCanvas(id, sessionId, canvasId)
          return this.#connectChatGeneration(id, sessionId, canvasId, generation)
        },
      )
      if (outcome.status === 'connected') return outcome.result

      await this.#waitForChatConnectionLaneIdle(sessionId)
      if (this.#isStopping) throw this.#chatConnectionError('CHAT_SERVICE_STOPPING', 'Agent service is stopping.')
      if (this.#chatReplacementGenerations.has(sessionId)) {
        throw this.#chatConnectionError('CHAT_REPLACEMENT_INCOMPLETE', 'The chat runtime replacement did not complete.')
      }
      const committedEntry = this.#chatWidgetIds.get(sessionId) === id
        ? this.sessionMap[id]?.[sessionId]
        : undefined
      if (!committedEntry) {
        throw this.#chatConnectionError('CHAT_CONNECTION_SUPERSEDED', 'The chat connection was superseded by another owner.')
      }
      return this.#chatConnectResult(id, sessionId, committedEntry)
    } finally {
      releaseMutation()
      releaseCanvasScope()
    }
  }

  async newChatSession(id: TWidgetId, sessionId: string): Promise<void> {
    // Canvas-authored preference changes can remount the component and start a
    // reuse connection immediately before the user chooses New chat. Retiring
    // the old session is ordered after those connection attempts instead of
    // surfacing CHAT_BUSY. Prompt and edit mutations remain true conflicts.
    const releaseMutation = await this.#claimChatMutationAfterConnections(sessionId, 'new')
    try {
      const generation = this.#nextChatConnectionGeneration(sessionId)
      await this.#runChatConnectionLane(sessionId, async () => {
        if (generation !== this.#chatConnectionGenerations.get(sessionId)) return
        const currentWidgetId = this.#chatWidgetIds.get(sessionId)
        if (currentWidgetId && currentWidgetId !== id) throw new Error(`Chat '${sessionId}' is connected to a different widget.`)
        await this.#disposeChatSession(id, sessionId)
        this.#chatReplacementGenerations.delete(sessionId)
      })
    } finally {
      releaseMutation()
    }
  }

  async promptChat(id: TWidgetId, sessionId: string, text: string, promptSelection?: TPromptSelection): Promise<void> {
    const releaseMutation = this.#claimChatMutation(sessionId, 'prompt')
    try {
      await this.#promptChat(id, sessionId, text, promptSelection)
    } finally {
      releaseMutation()
    }
  }

  async getChatHistory(id: TWidgetId, sessionId: string): Promise<TAgentChatHistoryItem[]> {
    await this.#waitForChatConnectionLaneIdle(sessionId)
    const sessionEntry = this.sessionMap[id]?.[sessionId]
    if (!sessionEntry || this.#chatWidgetIds.get(sessionId) !== id) {
      throw new Error(`No connected agent session for widget '${id}' and session '${sessionId}'`)
    }
    return this.#projectChatHistory(sessionEntry.sessionManager)
  }

  async editChatMessage(
    id: TWidgetId,
    sessionId: string,
    entryId: string,
    text: string,
    selection?: Pick<TPromptSelection, 'canvasId' | 'model' | 'thinkingLevel'>,
  ): Promise<TAgentChatHistoryItem[]> {
    const releaseMutation = this.#claimChatMutation(sessionId, 'edit')
    const promptStart = this.#createChatEditPromptStart(sessionId)
    try {
      const sessionEntry = this.sessionMap[id]?.[sessionId]
      if (!sessionEntry || this.#chatWidgetIds.get(sessionId) !== id) {
        throw new Error(`No connected agent session for widget '${id}' and session '${sessionId}'`)
      }
      const session = sessionEntry.session
      if (this.#chatCanceling.has(sessionId) || session.isIdle === false || session.isStreaming || session.isCompacting || session.isRetrying) {
        throw this.#chatConnectionError('CHAT_BUSY', 'Stop the current response before editing chat history.')
      }

      const activeEntries = sessionEntry.sessionManager.buildContextEntries()
      const editable = fnFindEditableUserMessage(activeEntries, entryId)
      if (!editable) {
        throw this.#chatConnectionError('CHAT_EDIT_TARGET_INVALID', 'The selected user message is not on the active chat branch.')
      }
      if (text.trim().length === 0 && editable.images.length === 0) {
        throw this.#chatConnectionError('CHAT_EDIT_EMPTY', 'Prompt text or at least one preserved image is required.')
      }
      if (selection?.model && !this.modelRuntime.getModel(selection.model.provider, selection.model.modelId)) {
        throw new Error(`Model not found: ${selection.model.provider}/${selection.model.modelId}`)
      }

      const navigation = await session.navigateTree(entryId, { summarize: false })
      if (navigation.cancelled) throw new Error('Chat history edit was canceled before the branch changed.')
      this.#approvals.cancelChat(sessionId, 'Approval belongs to an abandoned chat branch.')
      await this.#promptChat(id, sessionId, text, {
        canvasId: selection?.canvasId,
        images: editable.images,
        model: selection?.model,
        thinkingLevel: selection?.thinkingLevel,
      }, () => promptStart.resolve(true))
      return this.#projectChatHistory(sessionEntry.sessionManager)
    } finally {
      promptStart.resolve(false)
      if (this.#chatEditPromptStarts.get(sessionId) === promptStart) this.#chatEditPromptStarts.delete(sessionId)
      releaseMutation()
    }
  }

  async #promptChat(
    id: TWidgetId,
    sessionId: string,
    text: string,
    promptSelection?: TPromptSelection,
    onPromptStarted?: () => void,
  ): Promise<void> {
    const connectedEntry = this.sessionMap[id]?.[sessionId]
    if (!connectedEntry) {
      throw new Error(`No connected agent session for widget '${id}' and session '${sessionId}'`)
    }
    const canvasId = promptSelection?.canvasId
      ?? this.#chatCanvasIds.get(sessionId)
      ?? this.#config.chatScope.defaultCanvasId
    if (canvasId === undefined) {
      throw this.#chatConnectionError('CHAT_CANVAS_REQUIRED', 'Verified canvas scope is required for prompting.')
    }
    await this.#assertVerifiedChatCanvas(id, sessionId, canvasId)
    this.#assertCanvasNotRetiring(canvasId)
    const widgetSelection = await this.#resolvePromptWidgetSelection(
      id,
      sessionId,
      canvasId,
      promptSelection?.widgetRefs ?? [],
      connectedEntry.sessionManager,
    )
    this.#assertCanvasNotRetiring(canvasId)

    const sessionEntry = this.sessionMap[id]?.[sessionId]
    if (!sessionEntry) {
      throw new Error(`No connected agent session for widget '${id}' and session '${sessionId}'`)
    }

    const session = sessionEntry.session

    if (promptSelection?.model) {
      const model = this.modelRuntime.getModel(promptSelection.model.provider, promptSelection.model.modelId)
      if (!model) {
        throw new Error(`Model not found: ${promptSelection.model.provider}/${promptSelection.model.modelId}`)
      }

      if (session.model?.provider !== model.provider || session.model?.id !== model.id) {
        await session.setModel(model)
        this.#assertCanvasNotRetiring(canvasId)
      }
    }

    if (promptSelection?.thinkingLevel) {
      session.setThinkingLevel(promptSelection.thinkingLevel)
    }

    const images = this.#normalizePromptImages(promptSelection?.images)
    const promptText = text.trim().length > 0 ? text : PROMPT_IMAGE_FALLBACK_TEXT

    this.#assertCanvasNotRetiring(canvasId)
    this.#promptWidgetSelections.set(sessionId, widgetSelection)
    try {
      const prompting = session.prompt(promptText, images.length > 0 ? { images } : undefined)
      onPromptStarted?.()
      await prompting
    } finally {
      if (this.#promptWidgetSelections.get(sessionId) === widgetSelection) {
        this.#promptWidgetSelections.delete(sessionId)
      }
    }
  }

  async approveChatDbChange(id: TWidgetId, sessionId: TOmnidrawChatId, proposalId: string): Promise<TWidgetDbChangeProposalRecord> {
    const releaseResolution = this.#claimDbChangeProposalResolution(id, sessionId, proposalId)
    try {
      const sessionEntry = this.sessionMap[id]?.[sessionId]
      if (!sessionEntry) throw new Error(`No connected agent session for widget '${id}' and session '${sessionId}'`)
      const proposal = fnLatestWidgetDbChangeProposalRecord({
        entries: sessionEntry.sessionManager.getEntries(),
        proposalId,
      })
      if (!proposal) throw new Error('Database change proposal was not found.')
      if (proposal.status !== 'pending') throw new Error(`Database change proposal is already ${proposal.status}.`)

      const resourceService = this.#config.resourceService
      if (!resourceService?.createDbDraft || !resourceService.executeDbDraftSql || !resourceService.discardDbDraft || !resourceService.previewDbApply || !resourceService.confirmDbApply) {
        throw new Error('Coordinated database changes are unavailable in this host.')
      }

      const details = await resourceService.createDbDraft(proposal.resourceId, `AI Chat: ${proposal.reason}`)
      const draftId = details.draft.id
      let preview: { warnings: readonly string[] }
      let apply: Awaited<ReturnType<NonNullable<TAgentResourceService['confirmDbApply']>>>
      try {
        await resourceService.executeDbDraftSql(draftId, proposal.sql)
        preview = await resourceService.previewDbApply(draftId)
        apply = await resourceService.confirmDbApply(draftId)
      } catch (error) {
        await resourceService.discardDbDraft(draftId).catch(() => undefined)
        throw error
      }
      const approved = {
        ...proposal,
        status: 'approved' as const,
        resolvedAt: new Date().toISOString(),
        draftId,
        applyId: apply.id,
        warnings: [...preview.warnings],
      }
      appendWidgetDbChangeProposalRecord({ sessionManager: sessionEntry.sessionManager }, approved)
      return approved
    } finally {
      releaseResolution()
    }
  }

  rejectChatDbChange(id: TWidgetId, sessionId: TOmnidrawChatId, proposalId: string): TWidgetDbChangeProposalRecord {
    const releaseResolution = this.#claimDbChangeProposalResolution(id, sessionId, proposalId)
    try {
      const sessionEntry = this.sessionMap[id]?.[sessionId]
      if (!sessionEntry) throw new Error(`No connected agent session for widget '${id}' and session '${sessionId}'`)
      const proposal = fnLatestWidgetDbChangeProposalRecord({
        entries: sessionEntry.sessionManager.getEntries(),
        proposalId,
      })
      if (!proposal) throw new Error('Database change proposal was not found.')
      if (proposal.status !== 'pending') throw new Error(`Database change proposal is already ${proposal.status}.`)

      const rejected = {
        ...proposal,
        status: 'rejected' as const,
        resolvedAt: new Date().toISOString(),
      }
      appendWidgetDbChangeProposalRecord({ sessionManager: sessionEntry.sessionManager }, rejected)
      return rejected
    } finally {
      releaseResolution()
    }
  }

  async cancelChat(id: TWidgetId, sessionId: string): Promise<TAgentCancelResult> {
    this.#promptWidgetSelections.delete(sessionId)
    let session = this.sessionMap[id]?.[sessionId]?.session
    if (!session) {
      return { canceled: false, running: false }
    }
    if (!session.isStreaming) {
      const promptStart = this.#chatEditPromptStarts.get(sessionId)
      if (!promptStart) return { canceled: false, running: false }
      const started = await promptStart.promise
      session = this.sessionMap[id]?.[sessionId]?.session
      if (!started || !session) return { canceled: false, running: false }
    }

    if (this.#chatCanceling.has(sessionId)) return { canceled: false, running: session.isStreaming }
    this.#chatCanceling.add(sessionId)
    try {
      this.#approvals.cancelChat(sessionId, 'Chat prompt was canceled before approval.')
      await session.abort()
    } finally {
      this.#chatCanceling.delete(sessionId)
    }

    return { canceled: true, running: session.isStreaming }
  }

  async disposeCanvasChats(args: Readonly<{ canvasId: string }>): Promise<void> {
    this.#retiringCanvasIds.add(args.canvasId)
    const chatIds = new Set([...this.#chatCanvasIds.entries()]
      .filter(([, canvasId]) => canvasId === args.canvasId)
      .map(([chatId]) => chatId))
    for (const [chatId, scopes] of this.#chatConnectionCanvasScopes) {
      if (scopes.has(args.canvasId)) chatIds.add(chatId)
    }
    const retiringChatIds = [...chatIds]

    for (const chatId of retiringChatIds) {
      this.#nextChatConnectionGeneration(chatId)
      this.#chatReplacementGenerations.delete(chatId)
      this.#promptWidgetSelections.delete(chatId)
      this.#approvals.cancelChat(chatId, 'The Canvas owning this chat is being deleted.')
      this.#chatEditPromptStarts.get(chatId)?.resolve(false)
      this.#chatEditPromptStarts.delete(chatId)
      const entry = this.#chatSessionEntry(chatId)
      if (entry?.session.isStreaming) await entry.session.abort()
    }

    await Promise.all(retiringChatIds.map((chatId) => this.#waitForChatConnectionLaneIdle(chatId)))
    await Promise.all(retiringChatIds.map(async (chatId) => {
      const mutation = this.#chatMutations.get(chatId)
      if (mutation !== undefined) await mutation.settled
      this.#promptWidgetSelections.delete(chatId)
      this.#approvals.cancelChat(chatId, 'The Canvas owning this chat was deleted.')
      const widgetId = this.#chatWidgetIds.get(chatId)
      if (widgetId !== undefined) await this.#disposeChatSession(widgetId, chatId)
      this.#chatCanvasIds.delete(chatId)
      this.#chatWidgetIds.delete(chatId)
      this.#chatConnectionLanes.delete(chatId)
      this.#chatMutations.delete(chatId)
      this.#chatCanceling.delete(chatId)
    }))
  }

  resumeCanvasChats(args: Readonly<{ canvasId: string }>): void {
    this.#retiringCanvasIds.delete(args.canvasId)
  }

  listChatApprovals(id: TWidgetId, sessionId: TOmnidrawChatId): TApprovalView[] {
    this.#assertChatScope(id, sessionId)
    return this.#approvals.list(sessionId)
  }

  getChatApproval(id: TWidgetId, sessionId: TOmnidrawChatId, approvalId: string): TApprovalView | null {
    this.#assertChatScope(id, sessionId)
    return this.#approvals.get(sessionId, approvalId)
  }

  resolveChatApproval(
    id: TWidgetId,
    sessionId: TOmnidrawChatId,
    approvalId: string,
    decision: TApprovalDecision,
  ): Promise<{
    resolved: true;
    decision: TApprovalDecision;
    decisionSource: 'user';
  }> {
    this.#assertChatScope(id, sessionId)
    return this.#approvals.resolve(sessionId, approvalId, decision)
  }

  login(providerId: 'openai-codex' | 'github-copilot') {
    const loginId = crypto.randomUUID()
    const controller = new AbortController()
    const session: TLoginSession = { controller, status: { status: 'pending' } }
    this.#loginMap[loginId] = session

    void this.modelRuntime.login(providerId, 'oauth', {
      signal: controller.signal,
      async prompt(prompt) {
        if (prompt.type !== 'select') return ''
        return prompt.options.find((option) => option.id === 'device_code')?.id
          ?? prompt.options[0]?.id
          ?? ''
      },
      notify(event) {
        if (event.type === 'device_code') {
          session.status = {
            status: 'device-code',
            userCode: event.userCode,
            verificationUri: event.verificationUri,
            intervalSeconds: event.intervalSeconds,
            expiresInSeconds: event.expiresInSeconds,
          }
          return
        }
        if (event.type === 'auth_url') return
        const message = event.message
        if (session.status.status === 'device-code') {
          session.status = { ...session.status, message }
          return
        }
        session.status = { status: 'progress', message }
      },
    }).then(() => {
      session.status = { status: 'success' }
    }).catch((error) => {
      if (controller.signal.aborted) {
        session.status = { status: 'aborted' }
        return
      }
      session.status = { status: 'error', message: error instanceof Error ? error.message : String(error) }
    })

    return loginId
  }

  getLoginStatus(loginId: TLoginId): TAgentLoginStatus {
    return this.#loginMap[loginId]?.status ?? { status: 'aborted' }
  }

  abortLogin(loginId: TLoginId) {
    const session = this.#loginMap[loginId]
    if (session) {
      session.controller.abort()
      session.status = { status: 'aborted' }
    }
  }

  async logout(providerId: string): Promise<void> {
    await this.modelRuntime.logout(providerId)
  }

  async setApiKey(providerId: string, key: string): Promise<void> {
    await this.modelRuntime.login(providerId, 'api_key', {
      async prompt() { return key },
      notify() {},
    })
  }

  async removeApiKey(providerId: string): Promise<void> {
    await this.modelRuntime.logout(providerId)
  }

  async settings() {
    const defaultModel = this.settingsManager.getDefaultModel()
    const defaultProvider = this.settingsManager.getDefaultProvider()
    const configuredThinkingLevel = this.settingsManager.getDefaultThinkingLevel()
    const defaultThinkingLevel: TThinkingLevel | undefined = configuredThinkingLevel === 'max'
      ? 'xhigh'
      : configuredThinkingLevel
    const providersWithCredentials = (await this.modelRuntime.listCredentials()).map(credential => credential.providerId)
    const providers = Array.from(new Set(this.modelRuntime.getModels().map(m => m.provider)))
    const models = this.modelRuntime.getAvailableSnapshot().map(m => ({ id: m.id, input: m.input, provider: m.provider, name: m.name }))

    return {
      ...(defaultModel === undefined ? {} : { defaultModel }),
      ...(defaultProvider === undefined ? {} : { defaultProvider }),
      ...(defaultThinkingLevel === undefined ? {} : { defaultThinkingLevel }),
      providersWithCredentials,
      providers,
      models,
      approvalPolicy: this.#approvalPolicy,
    }
  }

  async updateApprovalPolicy(policy: TApprovalPolicy): Promise<TApprovalPolicy> {
    const normalized = fnNormalizeApprovalPolicy(policy)
    if (normalized.mode === 'ai-review') {
      const model = this.modelRuntime.getModel(
        normalized.reviewerModel.provider,
        normalized.reviewerModel.modelId,
      )
      if (!model) throw new Error('The selected approval reviewer model is unavailable.')
    }
    this.#approvalPolicy = await this.#approvalPolicyStore.save(normalized)
    return this.#approvalPolicy
  }

  async #reviewProtectedOperation(
    input: TApprovalReviewInput,
    signal?: AbortSignal,
  ) {
    const model = this.modelRuntime.getModel(input.model.provider, input.model.modelId)
    if (!model || !this.modelRuntime.hasConfiguredAuth(input.model.provider)) {
      throw new Error('The configured approval reviewer model is unavailable or unauthenticated.')
    }
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(abort, 30_000)
    timeout.unref?.()
    try {
      const message = await this.modelRuntime.completeSimple(model, {
        systemPrompt: [
          'You are an independent security reviewer for one protected operation.',
          'Use only the supplied redacted record. Return exactly one JSON object',
          'with decision equal to approve or reject and a concise reason.',
          'Reject when the stated intent, scope, or risk is unclear.',
        ].join(' '),
        messages: [{
          role: 'user',
          content: JSON.stringify({
            kind: input.kind,
            summary: input.summary,
            risk: input.risk,
            warnings: input.warnings,
            details: input.details,
          }),
          timestamp: Date.now(),
        }],
      }, {
        signal: controller.signal,
        maxTokens: 160,
        reasoning: 'low',
        timeoutMs: 30_000,
        maxRetries: 0,
      })
      if (message.stopReason !== 'stop') {
        throw new Error(message.errorMessage ?? 'Approval reviewer did not complete.')
      }
      const text = message.content
        .flatMap((part) => part.type === 'text' ? [part.text] : [])
        .join('')
        .trim()
      const parsed = JSON.parse(text) as unknown
      const decision = fnNormalizeApprovalReviewDecision(parsed)
      if (decision === null) throw new Error('Approval reviewer returned malformed output.')
      return decision
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }

  #nextChatConnectionGeneration(sessionId: TOmnidrawChatId): number {
    const generation = (this.#chatConnectionGenerations.get(sessionId) ?? 0) + 1
    this.#chatConnectionGenerations.set(sessionId, generation)
    return generation
  }

  async #runChatConnectionLane<TResult>(sessionId: TOmnidrawChatId, operation: () => Promise<TResult>): Promise<TResult> {
    const previous = this.#chatConnectionLanes.get(sessionId) ?? Promise.resolve()
    let release = () => {}
    const gate = new Promise<void>((resolveGate) => { release = resolveGate })
    const tail = previous.catch(() => undefined).then(() => gate)
    this.#chatConnectionLanes.set(sessionId, tail)

    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (this.#chatConnectionLanes.get(sessionId) === tail) this.#chatConnectionLanes.delete(sessionId)
    }
  }

  async #waitForChatConnectionLaneIdle(sessionId: TOmnidrawChatId): Promise<void> {
    while (true) {
      const tail = this.#chatConnectionLanes.get(sessionId)
      if (!tail) return
      await tail.catch(() => undefined)
    }
  }

  async #connectChatGeneration(
    id: TWidgetId,
    sessionId: TOmnidrawChatId,
    canvasId: string,
    generation: number,
  ): Promise<TChatConnectGenerationResult> {
    if (this.#isStopping) throw new Error('Agent service is stopping.')
    this.#assertCanvasNotRetiring(canvasId)
    if (generation !== this.#chatConnectionGenerations.get(sessionId)) return { status: 'superseded' }

    const connectedEntry = this.#chatWidgetIds.get(sessionId) === id
      ? this.sessionMap[id]?.[sessionId]
      : undefined
    const replacementGeneration = this.#chatReplacementGenerations.get(sessionId)
    if (connectedEntry && replacementGeneration === undefined) {
      await this.#ensureChatMetadata(sessionId, canvasId)
      this.#assertCanvasNotRetiring(canvasId)
      return { status: 'connected', result: await this.#chatConnectResult(id, sessionId, connectedEntry) }
    }

    const cwd = await this.#workspace.ensureChat(sessionId)
    this.#assertCanvasNotRetiring(canvasId)
    const sessionDir = this.#workspace.getChatHistoryRoot(sessionId)
    await normalizeSessionCwd({ readdir, readFile, writeFile, rename, rm, join }, { sessionDir, cwd })
    await this.#ensureChatMetadata(sessionId, canvasId)
    this.#assertCanvasNotRetiring(canvasId)
    const sessionManager = SessionManager.continueRecent(cwd, sessionDir)
    const sessionEntry = await this.#createChatSessionEntry(id, sessionId, sessionManager)
    try {
      this.#assertCanvasNotRetiring(canvasId)
    } catch (error) {
      this.#releaseUnpublishedChatSessionEntry(sessionEntry)
      throw error
    }

    if (this.#isStopping) {
      this.#releaseUnpublishedChatSessionEntry(sessionEntry)
      throw new Error('Agent service is stopping.')
    }
    if (generation !== this.#chatConnectionGenerations.get(sessionId)) {
      this.#releaseUnpublishedChatSessionEntry(sessionEntry)
      return { status: 'superseded' }
    }

    let installed = false
    try {
      if (this.#isStopping) {
        throw new Error('Agent service is stopping.')
      }
      if (generation !== this.#chatConnectionGenerations.get(sessionId)) {
        this.#releaseUnpublishedChatSessionEntry(sessionEntry)
        return { status: 'superseded' }
      }
      await this.#installChatSessionEntry(
        id,
        sessionId,
        sessionEntry,
        replacementGeneration !== undefined
          ? 'Chat runtime was intentionally replaced.'
          : 'Chat ownership changed before approval.',
      )
      installed = true
      if (replacementGeneration !== undefined && replacementGeneration <= generation) {
        this.#chatReplacementGenerations.delete(sessionId)
      }
    } catch (error) {
      if (!installed) this.#releaseUnpublishedChatSessionEntry(sessionEntry)
      throw error
    }
    return { status: 'connected', result: await this.#chatConnectResult(id, sessionId, sessionEntry) }
  }

  async #chatConnectResult(id: TWidgetId, sessionId: TOmnidrawChatId, sessionEntry: TChatSessionEntry): Promise<TAgentConnectResult> {
    const activeMount = await this.#resolveActiveMount(id, sessionId).catch(() => null)
    const vcJson = activeMount ? await this.#readMountedManifest(activeMount).catch(() => null) : null
    return {
      vcJson,
      messageHistory: this.#projectChatHistory(sessionEntry.sessionManager),
    }
  }

  #projectChatHistory(sessionManager: SessionManager): TAgentChatHistoryItem[] {
    return fnProjectActiveChatHistory(
      sessionManager.buildContextEntries(),
      sessionEntryToContextMessages,
    )
  }

  #createChatEditPromptStart(sessionId: TOmnidrawChatId): { promise: Promise<boolean>; resolve: (started: boolean) => void } {
    let settle!: (started: boolean) => void
    const promise = new Promise<boolean>((resolve) => { settle = resolve })
    let settled = false
    const promptStart = {
      promise,
      resolve: (started: boolean) => {
        if (settled) return
        settled = true
        settle(started)
      },
    }
    this.#chatEditPromptStarts.set(sessionId, promptStart)
    return promptStart
  }

  #claimChatMutation(
    sessionId: TOmnidrawChatId,
    kind: 'connect' | 'edit' | 'new' | 'prompt',
    allowSameKind = false,
  ): () => void {
    const current = this.#chatMutations.get(sessionId)
    if (current && (!allowSameKind || current.kind !== kind)) {
      throw this.#chatConnectionError('CHAT_BUSY', `Chat ${current.kind} operation is already active.`)
    }
    let settleMutation = () => {}
    const mutation = current ?? {
      count: 0,
      kind,
      settled: new Promise<void>((resolve) => { settleMutation = resolve }),
      settle: () => settleMutation(),
    }
    mutation.count += 1
    this.#chatMutations.set(sessionId, mutation)
    let released = false
    return () => {
      if (released) return
      released = true
      mutation.count -= 1
      if (mutation.count === 0 && this.#chatMutations.get(sessionId) === mutation) {
        this.#chatMutations.delete(sessionId)
        mutation.settle()
      }
    }
  }

  #trackChatConnectionCanvasScope(
    sessionId: TOmnidrawChatId,
    canvasId: string,
  ): () => void {
    const scopes = this.#chatConnectionCanvasScopes.get(sessionId) ?? new Map<string, number>()
    scopes.set(canvasId, (scopes.get(canvasId) ?? 0) + 1)
    this.#chatConnectionCanvasScopes.set(sessionId, scopes)
    let released = false
    return () => {
      if (released) return
      released = true
      const remaining = (scopes.get(canvasId) ?? 1) - 1
      if (remaining === 0) scopes.delete(canvasId)
      else scopes.set(canvasId, remaining)
      if (scopes.size === 0 && this.#chatConnectionCanvasScopes.get(sessionId) === scopes) {
        this.#chatConnectionCanvasScopes.delete(sessionId)
      }
    }
  }

  async #claimChatMutationAfterConnections(
    sessionId: TOmnidrawChatId,
    kind: 'new',
  ): Promise<() => void> {
    while (true) {
      const current = this.#chatMutations.get(sessionId)
      if (current === undefined) return this.#claimChatMutation(sessionId, kind)
      if (current.kind !== 'connect') {
        throw this.#chatConnectionError('CHAT_BUSY', `Chat ${current.kind} operation is already active.`)
      }
      await current.settled
    }
  }

  #chatSessionEntry(sessionId: TOmnidrawChatId): TChatSessionEntry | undefined {
    const widgetId = this.#chatWidgetIds.get(sessionId)
    return widgetId ? this.sessionMap[widgetId]?.[sessionId] : undefined
  }

  #chatConnectionError(code: TAgentServiceErrorCode, message: string): AgentServiceError {
    return new AgentServiceError(code, message)
  }

  async #installChatSessionEntry(id: TWidgetId, sessionId: TOmnidrawChatId, sessionEntry: TChatSessionEntry, approvalReason: string): Promise<void> {
    const previousWidgetId = this.#chatWidgetIds.get(sessionId)
    const previousEntry = previousWidgetId ? this.sessionMap[previousWidgetId]?.[sessionId] : undefined

    if (previousEntry) this.#approvals.cancelChat(sessionId, approvalReason)
    if (!this.sessionMap[id]) this.sessionMap[id] = {}
    this.sessionMap[id][sessionId] = sessionEntry
    this.#chatWidgetIds.set(sessionId, id)

    if (previousWidgetId && previousEntry) {
      this.#releaseChatSessionEntry(previousWidgetId, sessionId, previousEntry)
    }
  }

  async #createChatSessionEntry(
    id: TWidgetId,
    sessionId: TOmnidrawChatId,
    sessionManager: SessionManager,
    previousSession?: AgentSession,
  ): Promise<TChatSessionEntry> {
    const cwd = await this.#workspace.ensureChat(sessionId)
    const sensitiveToolArgs = new Map<string, unknown>()
    const registry = createToolRegistry({
      chatId: sessionId,
      cwd,
      authorize: this.#config.authorizeToolCall,
      workspace: this.#workspace,
      approvals: this.#approvals,
      resourceService: this.#config.resourceService,
      bashCapability: this.#config.bashCapability,
      onMounted: (mount) => this.#recordActiveMount(sessionManager, mount),
      onDraftChanged: () => this.#publishWidgetDraftsChanged(),
      ...(this.#config.previewBuild === undefined
        ? {}
        : { previewBuild: this.#config.previewBuild }),
      ...(this.#config.previewInspection === undefined
        ? {}
        : { previewInspection: this.#config.previewInspection }),
      resolvePreviewScope: (name) => this.#resolvePreviewInspectionScope(
        id,
        sessionId,
        name,
      ),
      takeSensitiveToolArgs: (toolCallId) => {
        const stored = sensitiveToolArgs.get(toolCallId)
        sensitiveToolArgs.delete(toolCallId)
        return stored
      },
    })
    const services = await createAgentSessionServices({
      cwd,
      agentDir: this.#piAgentDir,
      modelRuntime: this.modelRuntime,
      settingsManager: this.settingsManager,
      resourceLoaderOptions: {
        systemPrompt: WIDGET_CHAT_SYSTEM_PROMPT,
        noExtensions: true,
        extensionFactories: [
          {
            name: 'omnidraw-widget-selection',
            factory: (pi) => {
              pi.on('before_agent_start', () => {
                const selection = this.#promptWidgetSelections.get(sessionId)
                if (selection === undefined) return undefined
                this.#promptWidgetSelections.delete(sessionId)
                return {
                  message: {
                    customType: 'omnidraw.widget-selection',
                    content: fnWidgetPromptSelectionMessage(selection),
                    display: false,
                  },
                }
              })
            },
          },
          {
            name: 'omnidraw-secret-redaction',
            factory: (pi) => {
            pi.on('message_end', (event) => {
              const redacted = fnRedactSecretResourceWriteMessage(event.message)
              for (const captured of redacted.captured) sensitiveToolArgs.set(captured.toolCallId, captured.args)
              return redacted.captured.length > 0 ? { message: redacted.message } : undefined
            })
            pi.on('tool_result', (event) => (
              !event.isError && fnIsStructuredToolErrorDetails(event.details)
                ? { isError: true }
                : undefined
            ))
            pi.on('tool_execution_end', (event) => {
              sensitiveToolArgs.delete(event.toolCallId)
            })
          },
          },
        ],
      }
    });
    const { session } = await createAgentSessionFromServices({
      services,
      sessionManager,
      model: previousSession?.model,
      thinkingLevel: previousSession?.thinkingLevel,
      tools: registry.toolNames,
      customTools: registry.customTools,
    })
    const unsub = session.subscribe((event) => {
      this.#config.eventPublisherService.publishAgentEvent({
        widgetId: id,
        sessionId,
        event,
      })
    })

    return { session, sessionManager, unsub }
  }

  async #ensureChatMetadata(sessionId: TOmnidrawChatId, canvasId: string): Promise<void> {
    const existing = await this.#config.chats.get({ id: sessionId })
    if (existing) {
      if (existing.canvasId !== null && existing.canvasId !== canvasId) {
        throw this.#chatConnectionError(
          'CHAT_CANVAS_CONFLICT',
          'This chat is already attached to a different canvas.',
        )
      }
      if (existing.status !== 'active') {
        await this.#config.chats.update({ id: sessionId, status: 'active' })
      }
      if (existing.canvasId === null) {
        await this.#config.chats.update({ id: sessionId, canvasId })
      }
      this.#chatCanvasIds.set(sessionId, canvasId)
      return
    }
    const portableRelativePath = (path: string) => (
      relative(this.#config.dataPath, path).split(sep).join('/')
    )
    await this.#config.chats.create({
      id: sessionId,
      canvasId,
      name: 'AI Chat',
      workspaceRelativePath: portableRelativePath(this.#workspace.getChatRoot(sessionId)),
      historyRelativePath: portableRelativePath(this.#workspace.getChatHistoryRoot(sessionId)),
    })
    this.#chatCanvasIds.set(sessionId, canvasId)
  }

  async #assertVerifiedChatCanvas(
    widgetId: TWidgetId,
    sessionId: TOmnidrawChatId,
    canvasId: string,
  ): Promise<void> {
    this.#assertCanvasNotRetiring(canvasId)
    if (canvasId.length < 1 || canvasId.length > 200) {
      throw this.#chatConnectionError('CHAT_CANVAS_INVALID', 'Canvas identity is invalid.')
    }
    const attached = this.#chatCanvasIds.get(sessionId)
    if (attached !== undefined && attached !== canvasId) {
      throw this.#chatConnectionError(
        'CHAT_CANVAS_CONFLICT',
        'This chat is attached to a different canvas.',
      )
    }
    if (!await this.#config.chatScope.validate({ canvasId, widgetId })) {
      throw this.#chatConnectionError(
        'CHAT_SCOPE_INVALID',
        'The AI Chat element is not present on the requested canvas.',
      )
    }
  }

  #assertCanvasNotRetiring(canvasId: string): void {
    if (this.#retiringCanvasIds.has(canvasId)) {
      throw this.#chatConnectionError('CHAT_CANVAS_DELETING', 'This Canvas is being deleted.')
    }
  }

  #flushSessionManager(sessionManager: SessionManager): void {
    const writableSessionManager = sessionManager as unknown as {
      _rewriteFile?: () => void;
      flushed?: boolean;
    }
    writableSessionManager._rewriteFile?.()
    if (writableSessionManager._rewriteFile !== undefined) {
      writableSessionManager.flushed = true
    }
  }

  #recordActiveMount(sessionManager: SessionManager, mount: TWidgetMount): void {
    sessionManager.appendCustomEntry('omnidraw.activeWidgetMount', {
      name: mount.name,
      selectedAt: new Date().toISOString(),
    })
    this.#flushSessionManager(sessionManager)
  }

  #clearActiveMount(sessionManager: SessionManager): void {
    sessionManager.appendCustomEntry('omnidraw.activeWidgetMount', {
      name: null,
      selectedAt: new Date().toISOString(),
    })
    this.#flushSessionManager(sessionManager)
  }

  async #resolvePromptWidgetSelection(
    id: TWidgetId,
    sessionId: TOmnidrawChatId,
    canvasId: string,
    references: readonly NonNullable<TPromptSelection['widgetRefs']>[number][],
    sessionManager: SessionManager,
  ): Promise<TWidgetPromptSelectionContext> {
    const resolution = references.length === 0
      ? null
      : await this.#config.widgetReferenceResolver.resolve(references)
    if (resolution !== null) {
      for (const reference of resolution.references) {
        if (reference.editableDraft === null) continue
        const mount = await this.#workspace.loadWidget(sessionId, reference.editableDraft.name)
        const mountedManifest = await this.#readMountedManifest(mount)
        if (
          mountedManifest.slug !== reference.editableDraft.slug
          || mountedManifest.name !== reference.editableDraft.name
        ) throw this.#chatConnectionError(
          'WIDGET_REFERENCE_AMBIGUOUS',
          'The mounted draft identity does not match the mentioned widget.',
        )
      }
      await this.#config.widgetReferenceResolver.assertCurrent(resolution)
      if (resolution.references.length === 1 && resolution.references[0]!.editableDraft !== null) {
        const editable = resolution.references[0]!.editableDraft!
        const mount = await this.#workspace.findMountedWidget(sessionId, editable.name)
        this.#recordActiveMount(sessionManager, mount)
      } else {
        this.#clearActiveMount(sessionManager)
      }
    }
    const activeMount = await this.#resolveActiveMount(id, sessionId).catch(() => null)
    const activeManifest = activeMount === null
      ? null
      : await this.#readMountedManifest(activeMount).catch(() => null)
    return Object.freeze({
      canvasId,
      explicitlyMentioned: resolution?.references ?? Object.freeze([]),
      activeEditableTarget: activeMount === null || activeManifest === null
        ? null
        : Object.freeze({
            widgetKey: activeManifest.slug,
            name: activeManifest.name,
            mountedPath: `widgets/${activeManifest.name}`,
          }),
    })
  }

  #publishWidgetDraftsChanged(): void {
    this.#config.eventPublisherService.publishAgentEvent({
      kind: 'widget-catalog',
      type: 'changed',
    })
    this.#config.onWidgetDraftsChanged?.()
  }

  async #resolveActiveMount(id: TWidgetId, sessionId: TOmnidrawChatId): Promise<TWidgetMount> {
    const sessionEntry = this.sessionMap[id]?.[sessionId]
    if (!sessionEntry) throw new Error(`No connected agent session for widget '${id}' and session '${sessionId}'`)
    const record = [...sessionEntry.sessionManager.buildContextEntries()].reverse().find((entry) => (
      entry.type === 'custom'
      && entry.customType === 'omnidraw.activeWidgetMount'
      && entry.data
      && typeof entry.data === 'object'
      && (typeof (entry.data as { name?: unknown }).name === 'string'
        || (entry.data as { name?: unknown }).name === null)
    ))
    const name = record?.type === 'custom'
      ? (record.data as { name: string | null }).name
      : undefined
    if (name === null) throw new Error('No active editable widget target is selected.')
    return this.#workspace.findMountedWidget(sessionId, name)
  }

  async #resolvePreviewInspectionScope(
    id: TWidgetId,
    sessionId: TOmnidrawChatId,
    name: string,
  ): Promise<Readonly<{ canvasId: string; aiChatElementId: string }> | null> {
    const sessionEntry = this.sessionMap[id]?.[sessionId]
    const canvasId = this.#chatCanvasIds.get(sessionId)
    if (sessionEntry === undefined || canvasId === undefined) return null
    const record = [...sessionEntry.sessionManager.buildContextEntries()].reverse().find((entry) => (
      entry.type === 'custom'
      && entry.customType === 'omnidraw.activeWidgetMount'
      && entry.data
      && typeof entry.data === 'object'
      && typeof (entry.data as { name?: unknown }).name === 'string'
    ))
    if (record?.type !== 'custom') return null
    const activeName = (record.data as { name: string }).name
    if (activeName !== name) return null
    const mount = await this.#workspace.findMountedWidget(sessionId, activeName)
    const manifest = await this.#readMountedManifest(mount)
    if (manifest.name !== name) return null
    await this.#assertVerifiedChatCanvas(id, sessionId, canvasId)
    return Object.freeze({ canvasId, aiChatElementId: id })
  }

  async #readMountedManifest(mount: TWidgetMount): Promise<TWidgetManifestV1> {
    return ZWidgetManifestV1.parse(
      JSON.parse(await readFile(join(mount.targetPath, 'omnidraw.json'), 'utf8')),
    )
  }

  #assertChatScope(id: TWidgetId, sessionId: TOmnidrawChatId): void {
    if (this.#chatWidgetIds.get(sessionId) !== id || !this.sessionMap[id]?.[sessionId]) {
      throw new Error(`No connected agent session for widget '${id}' and session '${sessionId}'`)
    }
  }

  #normalizePromptImages(images: TPromptInputImage[] | undefined): TPromptImage[] {
    if (!images || images.length === 0) {
      return []
    }

    if (images.length > PROMPT_IMAGE_MAX_COUNT) {
      throw new Error(`Too many prompt images: max ${PROMPT_IMAGE_MAX_COUNT}`)
    }

    return images.map((image) => {
      if (!PROMPT_IMAGE_MIME_TYPES.has(image.mimeType)) {
        throw new Error(`Unsupported prompt image MIME type: ${image.mimeType}`)
      }

      if (image.data.length > PROMPT_IMAGE_MAX_BASE64_LENGTH || !PROMPT_IMAGE_BASE64_PATTERN.test(image.data)) {
        throw new Error('Invalid prompt image data')
      }

      return {
        type: 'image',
        data: image.data,
        mimeType: image.mimeType,
      }
    })
  }

  async #disposeChatSession(id: TWidgetId, sessionId: TOmnidrawChatId): Promise<void> {
    this.#disposeAgentSession(id, sessionId)
  }

  #claimDbChangeProposalResolution(id: TWidgetId, sessionId: TOmnidrawChatId, proposalId: string): () => void {
    const key = JSON.stringify([id, sessionId, proposalId])
    if (this.#dbChangeProposalResolutions.has(key)) {
      throw new Error('Database change proposal is already being resolved.')
    }
    this.#dbChangeProposalResolutions.add(key)
    return () => { this.#dbChangeProposalResolutions.delete(key) }
  }

  #disposeAgentSession(id: TWidgetId, sessionId: TOmnidrawChatId): void {
    const sessionEntry = this.sessionMap[id]?.[sessionId]
    this.#approvals.cancelChat(sessionId)
    if (!sessionEntry) {
      if (this.#chatWidgetIds.get(sessionId) === id) {
        this.#chatWidgetIds.delete(sessionId)
        this.#chatCanvasIds.delete(sessionId)
      }
      return
    }
    this.#releaseChatSessionEntry(id, sessionId, sessionEntry)
  }

  #releaseChatSessionEntry(id: TWidgetId, sessionId: TOmnidrawChatId, sessionEntry: TChatSessionEntry): void {
    sessionEntry.unsub()
    sessionEntry.session.dispose()

    if (this.sessionMap[id]?.[sessionId] === sessionEntry) {
      delete this.sessionMap[id][sessionId]
      if (this.#chatWidgetIds.get(sessionId) === id) {
        this.#chatWidgetIds.delete(sessionId)
        this.#chatCanvasIds.delete(sessionId)
        this.#promptWidgetSelections.delete(sessionId)
      }
    }

    if (this.sessionMap[id] && Object.keys(this.sessionMap[id]).length === 0) {
      delete this.sessionMap[id]
    }
  }

  #releaseUnpublishedChatSessionEntry(sessionEntry: TChatSessionEntry): void {
    sessionEntry.unsub()
    sessionEntry.session.dispose()
  }

}
