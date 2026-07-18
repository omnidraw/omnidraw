import { AuthStorage, createAgentSessionFromServices, createAgentSessionServices, ModelRegistry, SessionManager, SettingsManager, type AgentSession } from '@earendil-works/pi-coding-agent';
import { Actor, type TActorEvent } from '@vibecanvas/service-actor/Actor';
import { ActorResourceError } from '@vibecanvas/service-actor';
import type { TActorData, TActorState, TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import { ZVibecanvasJson } from '@vibecanvas/service-actor/core/vibecanvasjson.zod';
import type { IEventPublisherService, TAgentDraftActorEvent } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import type { IServiceContext } from '@vibecanvas/runtime/interface.ts';
import { execFile } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative as relativePath, resolve } from 'node:path';
import { fnMergeDraftResourceSelections } from './core/fn.draft-resource-bindings';
import { fnPatchDraftManifest, type TWidgetManifestPatch } from './core/fn.patch-draft-manifest';
import { fxEffectiveWidgetDraftResourceBindingSelectionRecord, fxLatestWidgetDbChangeProposalRecord, fxLatestWidgetEditSessionRecord } from './core/fx.session-records';
import { txPublishWidgetDraft } from './core/tx.publish-widget-draft';
import { txNormalizeSessionCwd } from './core/tx.session-cwd';
import { txValidateWidgetFiles } from './core/tx.validate-widget-files';
import { txAppendWidgetDbChangeProposalRecord, txAppendWidgetDraftResourceBindingSelectionRecord, txAppendWidgetEditSessionRecord, txAppendWidgetResourceSelectionRecord } from './core/tx.session-records';
import { WIDGET_CHAT_SYSTEM_PROMPT } from './prompts/index';
import { ApprovalCoordinator } from './approval/ApprovalCoordinator';
import type { TApprovalDecision, TApprovalView, TToolAuthorizationContext, TToolAuthorizer } from './approval/types';
import { createToolRegistry } from './tools/ToolRegistry';
import { fnRedactSecretResourceWriteMessage } from './tools/fn.redact-secret-resource-write';
import { planImplicitResourceSelections, planSelectedResourceBindings, type TResourceBindingPlan } from './tools/resource-bindings';
import type { TActorServiceReloader, TToolEvent, TWidgetDbChangeProposalRecord, TWidgetEditSessionRecord, TWidgetResourceSelection } from './tools/types';
import { WidgetWorkspace } from './workspace/WidgetWorkspace';
import type { TWidgetMount } from './workspace/types';
import { WidgetDraftController } from './widget-drafts/WidgetDraftController';
import { WidgetManagement } from './widget-management/WidgetManagement';
import type { TWidgetCatalogGroup, TWidgetDraftMetadataPatch, TWidgetDraftToolPatch, TWidgetSource } from './widget-management/types';

interface IPublicMethods {
  logout(providerId: string): void;
  setApiKey(providerId: string, key: string): void;
  removeApiKey(providerId: string): void;
}

interface IActorServiceConfig {
  cachePath: string;
  dataPath: string;
  configPath: string;
  eventPublisherService: IEventPublisherService,
  actorService?: TActorServiceReloader;
  authorizeToolCall?: TToolAuthorizer;
  approvalTimeoutMs?: number;
}

type TWidgetId = string;
// Persisted/API `sessionId` is the Vibecanvas chat identity. Pi owns a separate
// session ID inside each JSONL transcript header and filename.
type TVibecanvasChatId = string;
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
  images?: TPromptInputImage[];
  model?: TPromptModel;
  resourceIds?: string[];
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
  vcJson: TVibecanvasJson | null;
  messageHistory: AgentSession['messages'];
  editSession: TWidgetEditSessionRecord | null;
};
type TAgentCancelResult = {
  canceled: boolean;
  running: boolean;
};
type TChatSessionEntry = {
  unsub: () => void;
  session: AgentSession;
  sessionManager: SessionManager;
  authorizationContext?: TToolAuthorizationContext;
};
type TChatConnectGenerationResult =
  | { status: 'connected'; result: TAgentConnectResult }
  | { status: 'superseded' };

type TDraftActorKey = `${TWidgetId}:${TVibecanvasChatId}`;

type TAgentDraftActorSnapshot = {
  state: TActorState;
  context: TActorData;
};

type TDraftActorEntry = {
  actor: Actor;
  rootDir: string;
  manifest: TVibecanvasJson;
  unlisten: () => void;
};

type TDraftActorNotReadyReason =
  | 'manifest-missing'
  | 'manifest-invalid'
  | 'actor-functions-missing'
  | 'session-missing'
  | 'resource-binding-invalid'
  | 'actor-not-running';

type TAgentDraftActorReadyResult = {
  ready: true;
  actorId: string;
  snapshot: TAgentDraftActorSnapshot;
};

type TAgentDraftActorNotReadyResult = {
  ready: false;
  reason: TDraftActorNotReadyReason;
  message: string;
};

type TAgentDraftActorResult = TAgentDraftActorReadyResult | TAgentDraftActorNotReadyResult;

type TAgentDraftActorSendResult =
  | { ready: true; messageId: string; snapshot: TAgentDraftActorSnapshot }
  | TAgentDraftActorNotReadyResult;

type TAgentDraftActorStopResult = {
  stopped: boolean;
};

type TAgentPreviewSourceResult =
  | { ready: true; manifest: TVibecanvasJson; sources: Record<string, string> }
  | TAgentDraftActorNotReadyResult;

type TAgentDraftManifestReadResult =
  | { ready: true; source: 'file'; manifest: TVibecanvasJson }
  | { ready: false; reason: 'session-missing' | 'manifest-missing' | 'manifest-invalid'; message: string };

type TAgentDraftManifestPatch = TWidgetManifestPatch;

type TAgentDraftManifestPatchResult =
  | { ok: true; source: 'file'; manifest: TVibecanvasJson }
  | { ok: false; reason: 'session-missing' | 'manifest-missing' | 'manifest-invalid' | 'edit-invalid'; message: string; issues?: string[] };

type TAgentChatPublishResult =
  | { published: true; manifest: TVibecanvasJson; destination: string; files: string[] }
  | { published: false; manifest: TVibecanvasJson | null; destination: null; message: string; errors?: string[]; warnings?: string[] };

type TAgentChatStartWidgetEditResult =
  | { ok: true; vcJson: TVibecanvasJson; editSession: TWidgetEditSessionRecord; messageHistory: AgentSession['messages'] }
  | { ok: false; message: string };

const PROMPT_IMAGE_FALLBACK_TEXT = 'Please use the attached image.'
const PROMPT_IMAGE_MAX_COUNT = 5
const PROMPT_IMAGE_MAX_BYTES = 10 * 1024 * 1024
const PROMPT_IMAGE_MAX_BASE64_LENGTH = Math.ceil(PROMPT_IMAGE_MAX_BYTES / 3) * 4
const PROMPT_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const PROMPT_IMAGE_BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/

export class AgentService implements IService, IStartableService, IStoppableService, IPublicMethods {
  name = 'agent-service'
  #config: IActorServiceConfig;
  #piAgentDir: string;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  settingsManager: SettingsManager;
  sessionMap: Record<TWidgetId, Record<TVibecanvasChatId, TChatSessionEntry>> = {}
  #loginMap: Record<TLoginId, TLoginSession> = {}
  #draftActorMap = new Map<TDraftActorKey, TDraftActorEntry>();
  #dbChangeProposalResolutions = new Set<string>();
  #workspace: WidgetWorkspace;
  #widgetDrafts: WidgetDraftController;
  #widgetManagement: WidgetManagement;
  #approvals: ApprovalCoordinator;
  #chatWidgetIds = new Map<TVibecanvasChatId, TWidgetId>();
  #chatConnectionGenerations = new Map<TVibecanvasChatId, number>();
  #chatConnectionLanes = new Map<TVibecanvasChatId, Promise<void>>();
  #chatReplacementGenerations = new Map<TVibecanvasChatId, number>();
  #isStopping = false;

  constructor(config: IActorServiceConfig) {
    this.#config = config
    this.#piAgentDir = join(config.dataPath, 'pi', 'agent')
    this.#workspace = new WidgetWorkspace({ dataPath: config.dataPath, configPath: config.configPath })
    this.#widgetDrafts = new WidgetDraftController({
      configPath: config.configPath,
      workspace: this.#workspace,
      eventPublisher: config.eventPublisherService,
      actorService: config.actorService,
    })
    this.#widgetManagement = new WidgetManagement({
      workspace: this.#workspace,
      drafts: this.#widgetDrafts,
      deletePublishedDefinition: config.actorService?.deleteDefinition
        ? (name) => config.actorService!.deleteDefinition!(name)
        : undefined,
    })
    this.#approvals = new ApprovalCoordinator({
      timeoutMs: config.approvalTimeoutMs,
      authorize: config.authorizeToolCall,
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
    this.authStorage = AuthStorage.create(join(this.#piAgentDir, 'auth.json'))
    this.modelRegistry = ModelRegistry.create(this.authStorage, join(this.#piAgentDir, 'models.json'))
    this.settingsManager = SettingsManager.create(this.#piAgentDir, this.#piAgentDir, { projectTrusted: true })
  }

  async start(ctx: IServiceContext<object, object>): Promise<void> {
    void ctx
    this.#isStopping = false
    await this.#workspace.init()
    console.log('start', this.name)
  }

  async stop(): Promise<void> {
    this.#isStopping = true
    for (const sessionId of this.#chatConnectionGenerations.keys()) {
      this.#chatConnectionGenerations.set(sessionId, (this.#chatConnectionGenerations.get(sessionId) ?? 0) + 1)
    }
    await Promise.all(this.#chatConnectionLanes.values())
    for (const [id, sessions] of Object.entries(this.sessionMap)) {
      for (const sessionId of Object.keys(sessions)) {
        this.#disposeChatSession(id, sessionId)
      }
    }
    this.#chatWidgetIds.clear()
    this.#chatConnectionGenerations.clear()
    this.#chatConnectionLanes.clear()
    this.#chatReplacementGenerations.clear()
    this.#approvals.close()
    await this.#widgetDrafts.close()
    this.#disposeAllDraftActors()
    console.log('stop', this.name)
  }

  async connectChat(
    id: TWidgetId,
    sessionId: string,
    authorization: TToolAuthorizationContext = {},
    mode: TChatConnectMode = 'reuse',
  ): Promise<TAgentConnectResult> {
    const existingEntry = this.#chatSessionEntry(sessionId)
    if (existingEntry) this.#assertChatAuthorizationOwner(existingEntry, authorization)
    const generation = this.#nextChatConnectionGeneration(sessionId)
    if (mode === 'replace') this.#chatReplacementGenerations.set(sessionId, generation)
    const outcome = await this.#runChatConnectionLane(sessionId, () => this.#connectChatGeneration(id, sessionId, authorization, generation))
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
    this.#assertChatAuthorizationOwner(committedEntry, authorization)
    return this.#chatConnectResult(id, sessionId, committedEntry)
  }

  async newChatSession(id: TWidgetId, sessionId: string): Promise<void> {
    const generation = this.#nextChatConnectionGeneration(sessionId)
    await this.#runChatConnectionLane(sessionId, async () => {
      if (generation !== this.#chatConnectionGenerations.get(sessionId)) return
      const currentWidgetId = this.#chatWidgetIds.get(sessionId)
      if (currentWidgetId && currentWidgetId !== id) throw new Error(`Chat '${sessionId}' is connected to a different widget.`)
      this.#disposeChatSession(id, sessionId)
      this.#chatReplacementGenerations.delete(sessionId)
    })
  }

  async startWidgetEditChat(
    id: TWidgetId,
    sessionId: string,
    definitionName: string,
    authorization: TToolAuthorizationContext = {},
  ): Promise<TAgentChatStartWidgetEditResult> {
    const existingEntry = this.#chatSessionEntry(sessionId)
    if (existingEntry) this.#assertChatAuthorizationOwner(existingEntry, authorization)
    const generation = this.#nextChatConnectionGeneration(sessionId)
    return this.#runChatConnectionLane(sessionId, () => this.#startWidgetEditChatGeneration(id, sessionId, definitionName, authorization, generation))
  }

  async promptChat(id: TWidgetId, sessionId: string, text: string, promptSelection?: TPromptSelection): Promise<void> {
    const connectedEntry = this.sessionMap[id]?.[sessionId]
    if (!connectedEntry) {
      throw new Error(`No connected agent session for widget '${id}' and session '${sessionId}'`)
    }
    if (promptSelection?.resourceIds !== undefined) {
      const resources = await this.#resolveChatResourceSelections(promptSelection?.resourceIds ?? [])
      txAppendWidgetResourceSelectionRecord({ sessionManager: connectedEntry.sessionManager }, {
        resources,
        selectedAt: new Date().toISOString(),
      })
      if (resources.length > 0) {
        const current = fxEffectiveWidgetDraftResourceBindingSelectionRecord({ sessionManager: connectedEntry.sessionManager }, {})
        txAppendWidgetDraftResourceBindingSelectionRecord({ sessionManager: connectedEntry.sessionManager }, {
          resources: fnMergeDraftResourceSelections({ current: current?.resources ?? [], mentioned: resources }),
          selectedAt: new Date().toISOString(),
          source: 'mention',
        })
      }
    }

    const sessionEntry = this.sessionMap[id]?.[sessionId]
    if (!sessionEntry) {
      throw new Error(`No connected agent session for widget '${id}' and session '${sessionId}'`)
    }

    const session = sessionEntry.session

    if (promptSelection?.model) {
      const model = this.modelRegistry.find(promptSelection.model.provider, promptSelection.model.modelId)
      if (!model) {
        throw new Error(`Model not found: ${promptSelection.model.provider}/${promptSelection.model.modelId}`)
      }

      if (session.model?.provider !== model.provider || session.model?.id !== model.id) {
        await session.setModel(model)
      }
    }

    if (promptSelection?.thinkingLevel) {
      session.setThinkingLevel(promptSelection.thinkingLevel)
    }

    const images = this.#normalizePromptImages(promptSelection?.images)
    const promptText = text.trim().length > 0 ? text : PROMPT_IMAGE_FALLBACK_TEXT

    await session.prompt(promptText, images.length > 0 ? { images } : undefined)
  }

  clearDraftResourceBindingsChat(id: TWidgetId, sessionId: string): { cleared: true } {
    const connectedEntry = this.sessionMap[id]?.[sessionId]
    if (!connectedEntry) {
      throw new Error(`No connected agent session for widget '${id}' and session '${sessionId}'`)
    }
    txAppendWidgetDraftResourceBindingSelectionRecord({ sessionManager: connectedEntry.sessionManager }, {
      resources: [],
      selectedAt: new Date().toISOString(),
      source: 'explicit-clear',
    })
    return { cleared: true }
  }

  async approveChatDbChange(id: TWidgetId, sessionId: TVibecanvasChatId, proposalId: string): Promise<TWidgetDbChangeProposalRecord> {
    const releaseResolution = this.#claimDbChangeProposalResolution(id, sessionId, proposalId)
    try {
      const sessionEntry = this.sessionMap[id]?.[sessionId]
      if (!sessionEntry) throw new Error(`No connected agent session for widget '${id}' and session '${sessionId}'`)
      const proposal = fxLatestWidgetDbChangeProposalRecord({ sessionManager: sessionEntry.sessionManager }, { proposalId })
      if (!proposal) throw new Error('Database change proposal was not found.')
      if (proposal.status !== 'pending') throw new Error(`Database change proposal is already ${proposal.status}.`)

      const actorService = this.#config.actorService
      if (!actorService?.createDbDraft || !actorService.executeDbDraftSql || !actorService.discardDbDraft || !actorService.previewDbApply || !actorService.confirmDbApply) {
        throw new Error('Coordinated database changes are unavailable in this host.')
      }

      const details = await actorService.createDbDraft(proposal.resourceId, `AI Chat: ${proposal.reason}`)
      const draftId = details.draft.id
      let preview: { warnings: string[] }
      let apply: Awaited<ReturnType<NonNullable<TActorServiceReloader['confirmDbApply']>>>
      try {
        await actorService.executeDbDraftSql(draftId, proposal.sql)
        preview = await actorService.previewDbApply(draftId)
        apply = await actorService.confirmDbApply(draftId)
      } catch (error) {
        await actorService.discardDbDraft(draftId).catch(() => undefined)
        throw error
      }
      const approved = {
        ...proposal,
        status: 'approved' as const,
        resolvedAt: new Date().toISOString(),
        draftId,
        applyId: apply.id,
        warnings: preview.warnings,
      }
      txAppendWidgetDbChangeProposalRecord({ sessionManager: sessionEntry.sessionManager }, approved)
      return approved
    } finally {
      releaseResolution()
    }
  }

  rejectChatDbChange(id: TWidgetId, sessionId: TVibecanvasChatId, proposalId: string): TWidgetDbChangeProposalRecord {
    const releaseResolution = this.#claimDbChangeProposalResolution(id, sessionId, proposalId)
    try {
      const sessionEntry = this.sessionMap[id]?.[sessionId]
      if (!sessionEntry) throw new Error(`No connected agent session for widget '${id}' and session '${sessionId}'`)
      const proposal = fxLatestWidgetDbChangeProposalRecord({ sessionManager: sessionEntry.sessionManager }, { proposalId })
      if (!proposal) throw new Error('Database change proposal was not found.')
      if (proposal.status !== 'pending') throw new Error(`Database change proposal is already ${proposal.status}.`)

      const rejected = {
        ...proposal,
        status: 'rejected' as const,
        resolvedAt: new Date().toISOString(),
      }
      txAppendWidgetDbChangeProposalRecord({ sessionManager: sessionEntry.sessionManager }, rejected)
      return rejected
    } finally {
      releaseResolution()
    }
  }

  async cancelChat(id: TWidgetId, sessionId: string): Promise<TAgentCancelResult> {
    const session = this.sessionMap[id]?.[sessionId]?.session
    if (!session || !session.isStreaming) {
      return { canceled: false, running: false }
    }

    this.#approvals.cancelChat(sessionId, 'Chat prompt was canceled before approval.')
    await session.abort()

    return { canceled: true, running: session.isStreaming }
  }

  listChatApprovals(id: TWidgetId, sessionId: TVibecanvasChatId): TApprovalView[] {
    this.#assertChatScope(id, sessionId)
    return this.#approvals.list(sessionId)
  }

  getChatApproval(id: TWidgetId, sessionId: TVibecanvasChatId, approvalId: string): TApprovalView | null {
    this.#assertChatScope(id, sessionId)
    return this.#approvals.get(sessionId, approvalId)
  }

  resolveChatApproval(
    id: TWidgetId,
    sessionId: TVibecanvasChatId,
    approvalId: string,
    decision: TApprovalDecision,
    authorization: TToolAuthorizationContext = {},
  ): Promise<{ resolved: true; decision: TApprovalDecision }> {
    this.#assertChatScope(id, sessionId)
    return this.#approvals.resolve(sessionId, approvalId, decision, authorization)
  }

  listWidgetDrafts() {
    return this.#widgetDrafts.list()
  }

  getWidgetDraft(name: string) {
    return this.#widgetDrafts.get(name)
  }

  validateWidgetDraft(name: string, expectedRevision?: string) {
    return this.#widgetDrafts.validate(name, expectedRevision)
  }

  getWidgetPreview(name: string) {
    return this.#widgetDrafts.getPreview(name)
  }

  buildWidgetPreview(name: string, expectedRevision: string) {
    return this.#widgetDrafts.buildPreview(name, expectedRevision)
  }

  refreshWidgetPreview(name: string, expectedRevision: string) {
    return this.#widgetDrafts.refreshPreview(name, expectedRevision)
  }

  resetWidgetPreview(name: string, expectedRevision: string) {
    return this.#widgetDrafts.resetPreview(name, expectedRevision)
  }

  sendWidgetPreview(name: string, expectedRevision: string, messageName: string, payload: unknown) {
    return this.#widgetDrafts.sendPreview(name, expectedRevision, messageName, payload)
  }

  publishWidgetDraft(name: string, expectedRevision: string) {
    return this.#widgetDrafts.publish(name, expectedRevision)
  }

  getWidgetCatalog(groups: TWidgetCatalogGroup[]) {
    return this.#widgetManagement.catalog(groups)
  }

  getWidgetDetail(name: string, source: TWidgetSource) {
    return this.#widgetManagement.detail(name, source)
  }

  listWidgetFiles(name: string, source: TWidgetSource) {
    return this.#widgetManagement.files(name, source)
  }

  readWidgetFile(name: string, source: TWidgetSource, path: string) {
    return this.#widgetManagement.file(name, source, path)
  }

  ensureWidgetDraft(name: string, expectedPublishedFingerprint?: string) {
    return this.#widgetManagement.ensureDraft(name, expectedPublishedFingerprint)
  }

  patchWidgetDraftTool(name: string, expectedRevision: string, patch: TWidgetDraftToolPatch) {
    return this.#widgetManagement.patchDraftTool(name, expectedRevision, patch)
  }

  patchWidgetDraftMetadata(name: string, expectedRevision: string, patch: TWidgetDraftMetadataPatch) {
    return this.#widgetManagement.patchDraftMetadata(name, expectedRevision, patch)
  }

  deleteWidget(name: string, source: TWidgetSource) {
    return this.#widgetManagement.delete(name, source)
  }

  inspectDraftActorChat(id: TWidgetId, sessionId: string): TAgentDraftActorResult {
    const entry = this.#draftActorMap.get(this.#draftActorKey(id, sessionId))
    if (!entry) {
      return this.#draftActorNotReady(id, sessionId, 'actor-not-running')
    }

    return {
      ready: true,
      actorId: entry.actor.getId(),
      snapshot: this.#draftActorSnapshot(entry.actor),
    }
  }

  async startDraftActorChat(id: TWidgetId, sessionId: string): Promise<TAgentDraftActorResult> {
    const sessionEntry = this.sessionMap[id]?.[sessionId]
    if (!sessionEntry) {
      return this.#draftActorNotReady(id, sessionId, 'session-missing')
    }

    const mount = await this.#resolveActiveMount(id, sessionId).catch(() => null)
    if (!mount) return this.#draftActorNotReady(id, sessionId, 'manifest-missing')
    const rootDir = mount.targetPath
    const manifestResult = await this.#readDraftActorManifest(rootDir)
    if (!manifestResult.ready) return manifestResult

    const actorFunctionPath = join(rootDir, manifestResult.manifest.actor.relFunctionPath)
    if (!await Bun.file(actorFunctionPath).exists()) {
      return {
        ready: false,
        reason: 'actor-functions-missing',
        message: `Draft actor functions file does not exist: ${manifestResult.manifest.actor.relFunctionPath}`,
      }
    }

    this.#disposeDraftActor(id, sessionId)

    const bindingPlan = await this.#chatResourceBindingPlan(manifestResult.manifest, sessionEntry.sessionManager)
    if (!bindingPlan.ok) {
      return { ready: false, reason: 'resource-binding-invalid', message: bindingPlan.message }
    }
    if (bindingPlan.bindings.length > 0 && !this.#config.actorService?.callWithDirectResourceBinding) {
      return {
        ready: false,
        reason: 'resource-binding-invalid',
        message: 'Selected resources cannot be used by Preview in this host.',
      }
    }
    const directBindings = new Map(bindingPlan.bindings.map((binding) => [binding.slot, binding]))
    const resourceGateway = this.#config.actorService?.callWithDirectResourceBinding
      ? (call: Parameters<NonNullable<TActorServiceReloader['callWithDirectResourceBinding']>>[0]) => {
          const binding = directBindings.get(call.slot)
          const requirement = manifestResult.manifest.actor.resources?.[call.slot]
          if (!binding || !requirement) {
            throw new ActorResourceError('RESOURCE_NOT_BOUND', `Draft resource slot '${call.slot}' has no selected Preview binding.`)
          }
          return this.#config.actorService!.callWithDirectResourceBinding!(call, {
            resourceId: binding.resource.id,
            requirement,
            scope: binding.scope,
          })
        }
      : undefined

    const actor = new Actor({
      id: `draft:${id}:${sessionId}`,
      vsJson: manifestResult.manifest,
      rootDir,
      resourceGateway,
    })

    const unlisten = actor.listen((event) => {
      this.#publishDraftActorEvent(id, sessionId, actor, event)
    })

    actor.start()

    this.#draftActorMap.set(this.#draftActorKey(id, sessionId), {
      actor,
      rootDir,
      manifest: manifestResult.manifest,
      unlisten,
    })

    return {
      ready: true,
      actorId: actor.getId(),
      snapshot: this.#draftActorSnapshot(actor),
    }
  }

  async reloadDraftActorChat(id: TWidgetId, sessionId: string): Promise<TAgentDraftActorResult> {
    return this.startDraftActorChat(id, sessionId)
  }

  async resetDraftActorChat(id: TWidgetId, sessionId: string): Promise<TAgentDraftActorResult> {
    return this.startDraftActorChat(id, sessionId)
  }

  stopDraftActorChat(id: TWidgetId, sessionId: string): TAgentDraftActorStopResult {
    const key = this.#draftActorKey(id, sessionId)
    const stopped = this.#draftActorMap.has(key)

    this.#disposeDraftActor(id, sessionId)

    return { stopped }
  }

  sendDraftActorChat(id: TWidgetId, sessionId: string, name: string, payload: unknown): TAgentDraftActorSendResult {
    const entry = this.#draftActorMap.get(this.#draftActorKey(id, sessionId))
    if (!entry) {
      return this.#draftActorNotReady(id, sessionId, 'actor-not-running')
    }

    const messageId = entry.actor.inbox(name, payload)

    return {
      ready: true,
      messageId,
      snapshot: this.#draftActorSnapshot(entry.actor),
    }
  }

  async previewSourceChat(id: TWidgetId, sessionId: string): Promise<TAgentPreviewSourceResult> {
    if (!this.sessionMap[id]?.[sessionId]) {
      return this.#draftActorNotReady(id, sessionId, 'session-missing')
    }

    const mount = await this.#resolveActiveMount(id, sessionId).catch(() => null)
    if (!mount) return this.#draftActorNotReady(id, sessionId, 'manifest-missing')
    const rootDir = mount.targetPath
    const manifestResult = await this.#readDraftActorManifest(rootDir)
    if (!manifestResult.ready) return manifestResult

    return {
      ready: true,
      manifest: manifestResult.manifest,
      sources: await this.#readWidgetSourceMap(rootDir, manifestResult.manifest.widget.relWidgetDir),
    }
  }

  async readDraftManifestChat(id: TWidgetId, sessionId: string): Promise<TAgentDraftManifestReadResult> {
    const sessionEntry = this.sessionMap[id]?.[sessionId]
    if (!sessionEntry) {
      return {
        ready: false,
        reason: 'session-missing',
        message: this.#draftManifestMessage(id, sessionId, 'session-missing'),
      }
    }

    const mount = await this.#resolveActiveMount(id, sessionId).catch(() => null)
    if (!mount) {
      return {
        ready: false,
        reason: 'manifest-missing',
        message: 'No widget is selected in this chat. Load or create a widget first.',
      }
    }
    const rootDir = mount.targetPath
    const manifestResult = await this.#readDraftActorManifest(rootDir)
    if (manifestResult.ready) {
      return {
        ready: true,
        source: 'file',
        manifest: manifestResult.manifest,
      }
    }

    return {
      ready: false,
      reason: manifestResult.reason === 'session-missing' ? 'session-missing' : manifestResult.reason === 'manifest-missing' ? 'manifest-missing' : 'manifest-invalid',
      message: manifestResult.message,
    }
  }

  async patchDraftManifestChat(id: TWidgetId, sessionId: string, patch: TAgentDraftManifestPatch): Promise<TAgentDraftManifestPatchResult> {
    if (!this.sessionMap[id]?.[sessionId]) {
      return {
        ok: false,
        reason: 'session-missing',
        message: this.#draftManifestMessage(id, sessionId, 'session-missing'),
      }
    }

    const sessionEntry = this.sessionMap[id]?.[sessionId]
    if (!sessionEntry) {
      return {
        ok: false,
        reason: 'session-missing',
        message: this.#draftManifestMessage(id, sessionId, 'session-missing'),
      }
    }

    const mount = await this.#resolveActiveMount(id, sessionId).catch(() => null)
    if (!mount) return { ok: false, reason: 'manifest-missing', message: 'No widget is selected in this chat. Load or create a widget first.' }
    const currentManifest = await this.#readDraftActorManifest(mount.targetPath)
    if (!currentManifest.ready) {
      return {
        ok: false,
        reason: currentManifest.reason === 'session-missing' ? 'session-missing' : currentManifest.reason === 'manifest-missing' ? 'manifest-missing' : 'manifest-invalid',
        message: currentManifest.message,
      }
    }

    const editResult = this.#applyDraftManifestPatch(currentManifest.manifest, patch)
    if (!editResult.ok) return editResult
    if (editResult.manifest.name !== mount.name) {
      return {
        ok: false,
        reason: 'edit-invalid',
        message: `Published identity is '${mount.name}'. Renaming requires creating and publishing a new widget.`,
        issues: ['In-place widget rename is not supported.'],
      }
    }

    await this.#workspace.writeMountedFileAtomic(sessionId, `widgets/${mount.name}/vibecanvas.json`, `${JSON.stringify(editResult.manifest, null, 2)}\n`)

    return {
      ...editResult,
      source: 'file',
    }
  }

  async publishChat(id: TWidgetId, sessionId: string): Promise<TAgentChatPublishResult> {
    if (!this.sessionMap[id]?.[sessionId]) {
      return {
        published: false,
        manifest: null,
        destination: null,
        message: this.#draftManifestMessage(id, sessionId, 'session-missing'),
      }
    }

    const mount = await this.#resolveActiveMount(id, sessionId).catch(() => null)
    if (!mount) {
      return {
        published: false,
        manifest: null,
        destination: null,
        message: 'No widget is selected in this chat. Load or create a widget first.',
      }
    }
    let rootDir = mount.targetPath
    const manifestResult = await this.#readDraftActorManifest(rootDir)
    if (!manifestResult.ready) {
      return {
        published: false,
        manifest: null,
        destination: null,
        message: manifestResult.message,
      }
    }
    if (manifestResult.manifest.name !== mount.name) {
      return {
        published: false,
        manifest: manifestResult.manifest,
        destination: null,
        message: `Published identity is '${mount.name}', but vibecanvas.json declares '${manifestResult.manifest.name}'. Create a new widget to rename it.`,
      }
    }

    const validation = await txValidateWidgetFiles({ readdir, readFile, writeFile, rm, execFile, join, relative: relativePath }, {
      cwd: rootDir,
      sdkActorTypePath: join(this.#workspace.sdkPackagePath, 'src', 'actor.ts'),
    })
    if (!validation.ok) {
      return {
        published: false,
        manifest: manifestResult.manifest,
        destination: null,
        message: validation.errors.join('\n') || 'Widget is invalid and was not published.',
        errors: validation.errors,
        warnings: validation.warnings,
      }
    }

    const editSession = fxLatestWidgetEditSessionRecord({ sessionManager: this.sessionMap[id][sessionId].sessionManager })
    const bindingPlan = await this.#chatResourceBindingPlan(manifestResult.manifest, this.sessionMap[id][sessionId].sessionManager)
    if (!bindingPlan.ok) {
      return {
        published: false,
        manifest: manifestResult.manifest,
        destination: null,
        message: bindingPlan.message,
      }
    }
    if (this.#config.actorService && (
      !this.#config.actorService.transitionDefinitionPublication
      || !this.#config.actorService.listResourceBindingsForDefinition
    )) {
      return {
        published: false,
        manifest: manifestResult.manifest,
        destination: null,
        message: 'This host cannot coordinate definition, binding, and instance publication atomically.',
      }
    }
    const previousCanonicalPath = join(this.#workspace.publishedRoot, mount.name)
    if (await stat(previousCanonicalPath).catch(() => null)) {
      const previousManifest = await this.#readDraftActorManifest(previousCanonicalPath)
      if (!previousManifest.ready) {
        return {
          published: false,
          manifest: manifestResult.manifest,
          destination: null,
          message: `The existing published manifest for '${mount.name}' is invalid: ${previousManifest.message}`,
        }
      }
      if (previousManifest.manifest.slug !== manifestResult.manifest.slug) {
        return {
          published: false,
          manifest: manifestResult.manifest,
          destination: null,
          message: `Published slug '${previousManifest.manifest.slug}' is immutable. Create a new widget to publish as '${manifestResult.manifest.slug}'.`,
        }
      }
    }
    let previousBindings: Awaited<ReturnType<NonNullable<TActorServiceReloader['listResourceBindingsForDefinition']>>> = []
    try {
      previousBindings = await this.#config.actorService?.listResourceBindingsForDefinition?.(manifestResult.manifest.name) ?? []
    } catch (error) {
      return {
        published: false,
        manifest: manifestResult.manifest,
        destination: null,
        message: error instanceof Error ? error.message : String(error),
      }
    }
    const previousBindingSet = previousBindings.map((binding) => ({
      slot: binding.slot_name,
      resourceId: binding.resource_id,
      scope: [
        ...(binding.allow_read ? ['read' as const] : []),
        ...(binding.allow_write ? ['write' as const] : []),
      ],
    }))
    const desiredBindingSet = bindingPlan.bindings.map((binding) => ({
      slot: binding.slot,
      resourceId: binding.resource.id,
      scope: binding.scope,
    }))
    const shouldReloadEditedInstances = editSession !== null
      && editSession.sourceName === manifestResult.manifest.name
      && editSession.sourceSlug === manifestResult.manifest.slug
    const finalWidgetsDir = join(this.#config.configPath, 'widgets')
    const publishSnapshot = await this.#workspace.beginDraftPublish(mount.name, manifestResult.manifest.slug)
    rootDir = publishSnapshot.canonicalPath
    if (!publishSnapshot.wasExisting && await stat(join(finalWidgetsDir, manifestResult.manifest.slug)).catch(() => null)) {
      await publishSnapshot.rollback()
      return {
        published: false,
        manifest: manifestResult.manifest,
        destination: null,
        message: `A published widget already uses slug '${manifestResult.manifest.slug}'.`,
      }
    }

    let result: Awaited<ReturnType<typeof txPublishWidgetDraft>>
    let transitionAttempted = false
    let bindingReplacementCommitted = false
    try {
      publishSnapshot.markInstalledMutation()
      result = await txPublishWidgetDraft({ readdir, readFile, writeFile, mkdir, rm, cp, execFile, join, relative: relativePath, resolve, basename }, {
        cwd: rootDir,
        finalWidgetsDir,
        actorService: undefined,
        sdkActorTypePath: join(this.#workspace.sdkPackagePath, 'src', 'actor.ts'),
      })
      if (!result.published) {
        await publishSnapshot.rollback()
        return {
          published: false,
          manifest: result.manifest,
          destination: null,
          message: result.validation.errors.join('\n') || 'Widget draft is invalid and was not published.',
          errors: result.validation.errors,
          warnings: result.validation.warnings,
        }
      }
      if (this.#config.actorService) {
        transitionAttempted = true
        try {
          await this.#config.actorService.transitionDefinitionPublication!({
            definitionName: result.manifest.name,
            expectedBindings: previousBindingSet,
            bindings: desiredBindingSet,
            reloadInstances: publishSnapshot.wasExisting || shouldReloadEditedInstances,
          })
          bindingReplacementCommitted = true
        } catch (transitionError) {
          bindingReplacementCommitted = Boolean(
            typeof transitionError === 'object'
            && transitionError !== null
            && (transitionError as { bindingReplacementCommitted?: unknown }).bindingReplacementCommitted,
          )
          throw transitionError
        }
      }
      this.#disposeDraftActor(id, sessionId)
      if (!result.destination) throw new Error('Widget publish completed without a destination path.')
      await publishSnapshot.commit()
    } catch (error) {
      const recoveryErrors: string[] = []
      try {
        await publishSnapshot.rollback()
      } catch (recoveryError) {
        recoveryErrors.push(`filesystem rollback: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`)
      }
      if (transitionAttempted && this.#config.actorService?.transitionDefinitionPublication) {
        try {
          await this.#config.actorService.transitionDefinitionPublication({
            definitionName: manifestResult.manifest.name,
            expectedBindings: bindingReplacementCommitted ? desiredBindingSet : previousBindingSet,
            bindings: previousBindingSet,
            reloadInstances: publishSnapshot.wasExisting || shouldReloadEditedInstances,
          })
        } catch (recoveryError) {
          recoveryErrors.push(`actor publication restore: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`)
        }
      }
      const originalMessage = error instanceof Error ? error.message : String(error)
      const recoveryMessage = recoveryErrors.length > 0
        ? `Publication failed: ${originalMessage}. Recovery also failed: ${recoveryErrors.join('; ')}`
        : originalMessage
      return {
        published: false,
        manifest: manifestResult.manifest,
        destination: null,
        message: recoveryMessage,
        errors: recoveryErrors.length > 0 ? [`PUBLISH_RECOVERY_FAILED: ${recoveryErrors.join('; ')}`] : undefined,
      }
    }

    this.#publishToolEvent(id, sessionId, { type: 'widgetupdate', cwd: result.destination, files: result.files })

    return {
      published: true,
      manifest: result.manifest,
      destination: result.destination,
      files: result.files,
    }
  }

  login(providerId: 'openai-codex' | 'github-copilot') {
    const loginId = crypto.randomUUID()
    const controller = new AbortController()
    const session: TLoginSession = { controller, status: { status: 'pending' } }
    this.#loginMap[loginId] = session

    void this.authStorage.login(providerId, {
      onAuth(info) { void info },
      onDeviceCode(info) {
        session.status = {
          status: 'device-code',
          userCode: info.userCode,
          verificationUri: info.verificationUri,
          intervalSeconds: info.intervalSeconds,
          expiresInSeconds: info.expiresInSeconds,
        }
      },
      async onPrompt(prompt) { void prompt; return '' },
      async onSelect(prompt) {
        return prompt.options.find((option) => option.id === 'device_code')?.id
      },
      onProgress(message) {
        if (session.status.status === 'device-code') {
          session.status = { ...session.status, message }
          return
        }
        session.status = { status: 'progress', message }
      },
      signal: controller.signal,
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

  logout(providerId: string): void {
    this.authStorage.logout(providerId)
  }

  setApiKey(providerId: string, key: string): void {
    this.authStorage.set(providerId, {
      type: 'api_key',
      key,
    })
  }

  removeApiKey(providerId: string): void {
    this.authStorage.remove(providerId)
  }

  async settings() {
    const defaultModel = this.settingsManager.getDefaultModel()
    const defaultProvider = this.settingsManager.getDefaultProvider()
    const configuredThinkingLevel = this.settingsManager.getDefaultThinkingLevel()
    const defaultThinkingLevel: TThinkingLevel | undefined = configuredThinkingLevel === 'max'
      ? 'xhigh'
      : configuredThinkingLevel
    const providersWithCredentials = this.authStorage.list()
    const providers = Array.from(new Set(this.modelRegistry.getAll().map(m => m.provider)))
    const models = this.modelRegistry.getAvailable().map(m => ({ id: m.id, input: m.input, provider: m.provider, name: m.name }))

    return {
      defaultModel,
      defaultProvider,
      defaultThinkingLevel,
      providersWithCredentials,
      providers,
      models
    }
  }

  #applyDraftManifestPatch(manifest: TVibecanvasJson, patch: TAgentDraftManifestPatch): TAgentDraftManifestPatchResult {
    const plan = fnPatchDraftManifest({ manifest, patch })
    if (plan.issues.length > 0) {
      return {
        ok: false,
        reason: 'edit-invalid',
        message: plan.issues.join('; '),
        issues: plan.issues,
      }
    }
    const parsedManifest = ZVibecanvasJson.safeParse(plan.manifest)
    if (!parsedManifest.success) {
      const manifestIssues = parsedManifest.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      const reason = 'initialData' in patch || 'dataSchema' in patch || patch.tool !== undefined
        ? 'edit-invalid' as const
        : 'manifest-invalid' as const
      return {
        ok: false,
        reason,
        message: manifestIssues.join('; '),
        issues: manifestIssues,
      }
    }

    return {
      ok: true,
      source: 'file',
      manifest: parsedManifest.data as TVibecanvasJson,
    }
  }

  #draftActorKey(id: TWidgetId, sessionId: TVibecanvasChatId): TDraftActorKey {
    return `${id}:${sessionId}`;
  }

  #nextChatConnectionGeneration(sessionId: TVibecanvasChatId): number {
    const generation = (this.#chatConnectionGenerations.get(sessionId) ?? 0) + 1
    this.#chatConnectionGenerations.set(sessionId, generation)
    return generation
  }

  async #runChatConnectionLane<TResult>(sessionId: TVibecanvasChatId, operation: () => Promise<TResult>): Promise<TResult> {
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

  async #waitForChatConnectionLaneIdle(sessionId: TVibecanvasChatId): Promise<void> {
    while (true) {
      const tail = this.#chatConnectionLanes.get(sessionId)
      if (!tail) return
      await tail.catch(() => undefined)
    }
  }

  async #connectChatGeneration(
    id: TWidgetId,
    sessionId: TVibecanvasChatId,
    authorization: TToolAuthorizationContext,
    generation: number,
  ): Promise<TChatConnectGenerationResult> {
    if (this.#isStopping) throw new Error('Agent service is stopping.')
    if (generation !== this.#chatConnectionGenerations.get(sessionId)) return { status: 'superseded' }

    const connectedEntry = this.#chatWidgetIds.get(sessionId) === id
      ? this.sessionMap[id]?.[sessionId]
      : undefined
    const replacementGeneration = this.#chatReplacementGenerations.get(sessionId)
    if (connectedEntry && replacementGeneration === undefined) {
      this.#assertChatAuthorizationOwner(connectedEntry, authorization)
      this.#updateChatAuthorizationContext(connectedEntry, authorization)
      return { status: 'connected', result: await this.#chatConnectResult(id, sessionId, connectedEntry) }
    }

    const cwd = await this.#workspace.ensureChat(sessionId)
    const sessionDir = this.#workspace.getChatHistoryRoot(sessionId)
    await txNormalizeSessionCwd({ readdir, readFile, writeFile, rename, rm, join }, { sessionDir, cwd })
    const sessionManager = SessionManager.continueRecent(cwd, sessionDir)
    const sessionEntry = await this.#createChatSessionEntry(id, sessionId, sessionManager, undefined, authorization)

    if (this.#isStopping) {
      this.#releaseUnpublishedChatSessionEntry(sessionEntry)
      throw new Error('Agent service is stopping.')
    }
    if (generation !== this.#chatConnectionGenerations.get(sessionId)) {
      this.#releaseUnpublishedChatSessionEntry(sessionEntry)
      return { status: 'superseded' }
    }

    this.#installChatSessionEntry(id, sessionId, sessionEntry, replacementGeneration !== undefined
      ? 'Chat runtime was intentionally replaced.'
      : 'Chat ownership changed before approval.')
    if (replacementGeneration !== undefined && replacementGeneration <= generation) {
      this.#chatReplacementGenerations.delete(sessionId)
    }
    return { status: 'connected', result: await this.#chatConnectResult(id, sessionId, sessionEntry) }
  }

  async #startWidgetEditChatGeneration(
    id: TWidgetId,
    sessionId: TVibecanvasChatId,
    definitionName: string,
    authorization: TToolAuthorizationContext,
    generation: number,
  ): Promise<TAgentChatStartWidgetEditResult> {
    if (this.#isStopping) return { ok: false, message: 'Agent service is stopping.' }
    const sourceManifest = this.#config.actorService?.getVibecanvasJson?.(definitionName)
    if (!sourceManifest) return { ok: false, message: `Published widget definition not found: ${definitionName}` }

    await this.#workspace.reconcilePublishedWidgets()
    const mount = await this.#workspace.syncDraftFromPublished(sessionId, sourceManifest.name)
    if (generation !== this.#chatConnectionGenerations.get(sessionId)) {
      return { ok: false, message: 'Widget edit connection was superseded by a newer request.' }
    }

    let sessionEntry = this.#chatWidgetIds.get(sessionId) === id
      ? this.sessionMap[id]?.[sessionId]
      : undefined
    const replacementGeneration = this.#chatReplacementGenerations.get(sessionId)
    if (sessionEntry) this.#assertChatAuthorizationOwner(sessionEntry, authorization)
    if (!sessionEntry || replacementGeneration !== undefined) {
      const cwd = await this.#workspace.ensureChat(sessionId)
      const sessionDir = this.#workspace.getChatHistoryRoot(sessionId)
      await txNormalizeSessionCwd({ readdir, readFile, writeFile, rename, rm, join }, { sessionDir, cwd })
      const sessionManager = SessionManager.continueRecent(cwd, sessionDir)
      const candidate = await this.#createChatSessionEntry(id, sessionId, sessionManager, undefined, authorization)
      if (this.#isStopping || generation !== this.#chatConnectionGenerations.get(sessionId)) {
        this.#releaseUnpublishedChatSessionEntry(candidate)
        return { ok: false, message: this.#isStopping ? 'Agent service is stopping.' : 'Widget edit connection was superseded by a newer request.' }
      }
      this.#installChatSessionEntry(id, sessionId, candidate, replacementGeneration !== undefined
        ? 'Chat runtime was intentionally replaced.'
        : 'Chat ownership changed before approval.')
      if (replacementGeneration !== undefined && replacementGeneration <= generation) {
        this.#chatReplacementGenerations.delete(sessionId)
      }
      sessionEntry = candidate
    } else {
      this.#updateChatAuthorizationContext(sessionEntry, authorization)
    }

    this.#recordActiveMount(sessionEntry.sessionManager, mount)
    const editStartedAt = new Date().toISOString()
    const editSession = txAppendWidgetEditSessionRecord({ sessionManager: sessionEntry.sessionManager }, {
      mode: 'edit-published-widget',
      sourceDefinitionName: definitionName,
      sourceSlug: sourceManifest.slug,
      sourceName: sourceManifest.name,
      sourceManifestPath: sourceManifest.manifest_path,
      previousVersion: sourceManifest.version,
      nextVersion: sourceManifest.version ?? '1',
      startedAt: editStartedAt,
    })
    sessionEntry.sessionManager.appendCustomMessageEntry(
      'vibecanvas.widgetLoaded',
      `[Widget ${sourceManifest.name} loaded]`,
      true,
      {
        definitionName,
        slug: sourceManifest.slug,
        previousVersion: sourceManifest.version,
        source: 'draft-synced-from-published',
      },
    )
    this.#flushSessionManager(sessionEntry.sessionManager)

    return {
      ok: true,
      vcJson: sourceManifest,
      editSession,
      messageHistory: sessionEntry.session.messages,
    }
  }

  async #chatConnectResult(id: TWidgetId, sessionId: TVibecanvasChatId, sessionEntry: TChatSessionEntry): Promise<TAgentConnectResult> {
    const activeMount = await this.#resolveActiveMount(id, sessionId).catch(() => null)
    const vcJson = activeMount ? await this.#readMountedManifest(activeMount).catch(() => null) : null
    return {
      vcJson,
      messageHistory: sessionEntry.session.messages,
      editSession: null,
    }
  }

  #chatSessionEntry(sessionId: TVibecanvasChatId): TChatSessionEntry | undefined {
    const widgetId = this.#chatWidgetIds.get(sessionId)
    return widgetId ? this.sessionMap[widgetId]?.[sessionId] : undefined
  }

  #assertChatAuthorizationOwner(sessionEntry: TChatSessionEntry, authorization: TToolAuthorizationContext): void {
    const connectedAccountId = sessionEntry.authorizationContext?.accountId
    if (connectedAccountId === authorization.accountId) return
    if (connectedAccountId === undefined && authorization.accountId === undefined) return
    throw this.#chatConnectionError('CHAT_AUTHORIZATION_CHANGED', 'This chat belongs to a different authorization context.')
  }

  #updateChatAuthorizationContext(sessionEntry: TChatSessionEntry, authorization: TToolAuthorizationContext): void {
    if (!sessionEntry.authorizationContext) {
      sessionEntry.authorizationContext = { ...authorization }
      return
    }
    sessionEntry.authorizationContext.accountId = authorization.accountId
    sessionEntry.authorizationContext.requestId = authorization.requestId
  }

  #chatConnectionError(code: string, message: string): Error & { code: string } {
    return Object.assign(new Error(message), { code })
  }

  #installChatSessionEntry(id: TWidgetId, sessionId: TVibecanvasChatId, sessionEntry: TChatSessionEntry, approvalReason: string): void {
    const previousWidgetId = this.#chatWidgetIds.get(sessionId)
    const previousEntry = previousWidgetId ? this.sessionMap[previousWidgetId]?.[sessionId] : undefined

    if (previousEntry) this.#approvals.cancelChat(sessionId, approvalReason)
    if (previousWidgetId && previousWidgetId !== id) this.#disposeDraftActor(previousWidgetId, sessionId)

    if (!this.sessionMap[id]) this.sessionMap[id] = {}
    this.sessionMap[id][sessionId] = sessionEntry
    this.#chatWidgetIds.set(sessionId, id)

    if (previousWidgetId && previousEntry) {
      this.#releaseChatSessionEntry(previousWidgetId, sessionId, previousEntry)
    }
  }

  async #createChatSessionEntry(
    id: TWidgetId,
    sessionId: TVibecanvasChatId,
    sessionManager: SessionManager,
    previousSession?: AgentSession,
    authorization: TToolAuthorizationContext = {},
  ): Promise<TChatSessionEntry> {
    const cwd = await this.#workspace.ensureChat(sessionId)
    const sensitiveToolArgs = new Map<string, unknown>()
    const authorizationContext = { ...authorization }
    const registry = createToolRegistry({
      chatId: sessionId,
      cwd,
      authorization: authorizationContext,
      authorize: this.#config.authorizeToolCall,
      workspace: this.#workspace,
      approvals: this.#approvals,
      actorService: this.#config.actorService,
      onMounted: (mount) => this.#recordActiveMount(sessionManager, mount),
      onDraftChanged: (change) => this.#widgetDrafts.handleToolChange(change),
      takeSensitiveToolArgs: (toolCallId) => {
        const stored = sensitiveToolArgs.get(toolCallId)
        sensitiveToolArgs.delete(toolCallId)
        return stored
      },
    })
    const services = await createAgentSessionServices({
      cwd,
      agentDir: this.#piAgentDir,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      settingsManager: this.settingsManager,
      resourceLoaderOptions: {
        systemPrompt: WIDGET_CHAT_SYSTEM_PROMPT,
        noExtensions: true,
        extensionFactories: [{
          name: 'vibecanvas-secret-redaction',
          factory: (pi) => {
            pi.on('message_end', (event) => {
              const redacted = fnRedactSecretResourceWriteMessage(event.message)
              for (const captured of redacted.captured) sensitiveToolArgs.set(captured.toolCallId, captured.args)
              return redacted.captured.length > 0 ? { message: redacted.message } : undefined
            })
            pi.on('tool_execution_end', (event) => {
              sensitiveToolArgs.delete(event.toolCallId)
            })
          },
        }],
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

    return { session, sessionManager, unsub, authorizationContext }
  }

  #flushSessionManager(sessionManager: SessionManager): void {
    const writableSessionManager = sessionManager as unknown as { _rewriteFile?: () => void }
    writableSessionManager._rewriteFile?.()
  }

  #recordActiveMount(sessionManager: SessionManager, mount: TWidgetMount): void {
    sessionManager.appendCustomEntry('vibecanvas.activeWidgetMount', {
      name: mount.name,
      selectedAt: new Date().toISOString(),
    })
    this.#flushSessionManager(sessionManager)
  }

  async #resolveActiveMount(id: TWidgetId, sessionId: TVibecanvasChatId): Promise<TWidgetMount> {
    const sessionEntry = this.sessionMap[id]?.[sessionId]
    if (!sessionEntry) throw new Error(`No connected agent session for widget '${id}' and session '${sessionId}'`)
    const record = [...sessionEntry.sessionManager.getEntries()].reverse().find((entry) => (
      entry.type === 'custom'
      && entry.customType === 'vibecanvas.activeWidgetMount'
      && entry.data
      && typeof entry.data === 'object'
      && typeof (entry.data as { name?: unknown }).name === 'string'
    ))
    const name = record?.type === 'custom' ? (record.data as { name: string }).name : undefined
    return this.#workspace.findMountedWidget(sessionId, name)
  }

  async #readMountedManifest(mount: TWidgetMount): Promise<TVibecanvasJson> {
    const parsed = ZVibecanvasJson.safeParse(JSON.parse(await readFile(join(mount.targetPath, 'vibecanvas.json'), 'utf8')))
    if (!parsed.success) throw new Error(parsed.error.message)
    return parsed.data as TVibecanvasJson
  }

  #assertChatScope(id: TWidgetId, sessionId: TVibecanvasChatId): void {
    if (this.#chatWidgetIds.get(sessionId) !== id || !this.sessionMap[id]?.[sessionId]) {
      throw new Error(`No connected agent session for widget '${id}' and session '${sessionId}'`)
    }
  }

  #publishToolEvent(id: TWidgetId, sessionId: TVibecanvasChatId, event: TToolEvent): void {
    if (event.type !== 'widgetupdate') return

    this.#config.eventPublisherService.publishAgentEvent({
      kind: 'widgetupdate',
      widgetId: id,
      sessionId,
      cwd: event.cwd,
      files: event.files,
    })
  }

  async #resolveChatResourceSelections(resourceIds: readonly string[]): Promise<TWidgetResourceSelection[]> {
    if (resourceIds.length > 16) throw new Error('A prompt can select at most 16 resources.')
    const ids = [...new Set(resourceIds)]
    if (!this.#config.actorService?.getResource) throw new Error('Resource selection is unavailable in this host.')

    const selected: TWidgetResourceSelection[] = []
    for (const resourceId of ids) {
      const resource = await this.#config.actorService.getResource(resourceId)
      if (!resource) throw new Error(`Selected resource was not found: ${resourceId}`)
      selected.push({
        id: resource.id,
        kind: resource.kind,
        name: resource.name,
        status: resource.status,
      })
    }
    return selected
  }

  async #chatResourceBindingPlan(manifest: TVibecanvasJson, sessionManager: SessionManager): Promise<{ ok: true; bindings: TResourceBindingPlan[] } | { ok: false; message: string }> {
    const requirements = Object.keys(manifest.actor.resources ?? {})
    if (requirements.length === 0) return { ok: true, bindings: [] }

    const selectedRecord = fxEffectiveWidgetDraftResourceBindingSelectionRecord({ sessionManager }, {})
    let selected = selectedRecord?.resources ?? []
    if (!selectedRecord) {
      const actorService = this.#config.actorService
      if (!actorService?.listResources) return { ok: false, message: 'Resources cannot be discovered in this host. The widget was not published.' }
      const available = await actorService.listResources({ status: 'ready' })
      const implicit = planImplicitResourceSelections(manifest, available.map((resource) => ({
        id: resource.id,
        kind: resource.kind,
        name: resource.name,
        status: resource.status,
      })))
      if (!implicit.ok) return implicit
      selected = implicit.resources
    }
    return planSelectedResourceBindings(manifest, selected)
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

  #disposeChatSession(id: TWidgetId, sessionId: TVibecanvasChatId): void {
    this.#disposeDraftActor(id, sessionId)
    this.#disposeAgentSession(id, sessionId)
  }

  #claimDbChangeProposalResolution(id: TWidgetId, sessionId: TVibecanvasChatId, proposalId: string): () => void {
    const key = JSON.stringify([id, sessionId, proposalId])
    if (this.#dbChangeProposalResolutions.has(key)) {
      throw new Error('Database change proposal is already being resolved.')
    }
    this.#dbChangeProposalResolutions.add(key)
    return () => { this.#dbChangeProposalResolutions.delete(key) }
  }

  #disposeAgentSession(id: TWidgetId, sessionId: TVibecanvasChatId): void {
    const sessionEntry = this.sessionMap[id]?.[sessionId]
    this.#approvals.cancelChat(sessionId)
    if (!sessionEntry) {
      if (this.#chatWidgetIds.get(sessionId) === id) this.#chatWidgetIds.delete(sessionId)
      return
    }
    this.#releaseChatSessionEntry(id, sessionId, sessionEntry)
  }

  #releaseChatSessionEntry(id: TWidgetId, sessionId: TVibecanvasChatId, sessionEntry: TChatSessionEntry): void {
    sessionEntry.unsub()
    sessionEntry.session.dispose()

    if (this.sessionMap[id]?.[sessionId] === sessionEntry) {
      delete this.sessionMap[id][sessionId]
      if (this.#chatWidgetIds.get(sessionId) === id) this.#chatWidgetIds.delete(sessionId)
    }

    if (this.sessionMap[id] && Object.keys(this.sessionMap[id]).length === 0) {
      delete this.sessionMap[id]
    }
  }

  #releaseUnpublishedChatSessionEntry(sessionEntry: TChatSessionEntry): void {
    sessionEntry.unsub()
    sessionEntry.session.dispose()
  }

  #disposeDraftActor(id: TWidgetId, sessionId: TVibecanvasChatId): void {
    const key = this.#draftActorKey(id, sessionId);
    const entry = this.#draftActorMap.get(key);
    if (!entry) return;

    entry.unlisten();
    entry.actor.close();
    this.#draftActorMap.delete(key);

    this.#publishDraftActorEvent(id, sessionId, entry.actor, {
      kind: 'lifecycle',
      type: 'stopped',
      actorId: entry.actor.getId(),
    })
  }

  #disposeAllDraftActors(): void {
    for (const key of Array.from(this.#draftActorMap.keys())) {
      const [id, sessionId] = key.split(':', 2)
      this.#disposeDraftActor(id, sessionId)
    }
  }

  #draftActorSnapshot(actor: Actor): TAgentDraftActorSnapshot {
    return {
      state: actor.getState(),
      context: actor.getData(),
    }
  }

  async #readDraftActorManifest(rootDir: string): Promise<
    | { ready: true; manifest: TVibecanvasJson }
    | TAgentDraftActorNotReadyResult
  > {
    const manifestPath = join(rootDir, 'vibecanvas.json')

    if (!await Bun.file(manifestPath).exists()) {
      return {
        ready: false,
        reason: 'manifest-missing',
        message: 'Draft vibecanvas.json does not exist yet.',
      }
    }

    try {
      const parsedJson = await Bun.file(manifestPath).json()
      const parsedManifest = ZVibecanvasJson.safeParse(parsedJson)
      if (!parsedManifest.success) {
        return {
          ready: false,
          reason: 'manifest-invalid',
          message: parsedManifest.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
        }
      }

      return {
        ready: true,
        manifest: parsedManifest.data as TVibecanvasJson,
      }
    } catch (error) {
      return {
        ready: false,
        reason: 'manifest-invalid',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async #readWidgetSourceMap(rootDir: string, relWidgetDir: string): Promise<Record<string, string>> {
    const root = resolve(rootDir)
    const widgetDir = resolve(root, relWidgetDir)
    if (widgetDir !== root && !widgetDir.startsWith(`${root}/`)) return {}
    const widgetDirStat = await stat(widgetDir).catch(() => null)
    if (!widgetDirStat?.isDirectory()) return {}

    const sources: Record<string, string> = {}
    await this.#readSourceMapRecursive(widgetDir, widgetDir, sources)
    return sources
  }

  async #readSourceMapRecursive(rootDir: string, dir: string, sources: Record<string, string>): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const absPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        await this.#readSourceMapRecursive(rootDir, absPath, sources)
        continue
      }
      if (!entry.isFile()) continue

      sources[relativePath(rootDir, absPath)] = await Bun.file(absPath).text()
    }
  }

  #draftActorNotReady(id: TWidgetId, sessionId: TVibecanvasChatId, reason: TDraftActorNotReadyReason): TAgentDraftActorNotReadyResult {
    const label = `widget '${id}' and session '${sessionId}'`
    const messageMap: Record<TDraftActorNotReadyReason, string> = {
      'manifest-missing': `Draft vibecanvas.json does not exist for ${label}`,
      'manifest-invalid': `Draft vibecanvas.json is invalid for ${label}`,
      'actor-functions-missing': `Draft actor functions file does not exist for ${label}`,
      'session-missing': `No connected agent session for ${label}`,
      'resource-binding-invalid': `Draft resources cannot be bound for ${label}`,
      'actor-not-running': `No draft actor is running for ${label}`,
    }

    return {
      ready: false,
      reason,
      message: messageMap[reason],
    }
  }

  #draftManifestMessage(id: TWidgetId, sessionId: TVibecanvasChatId, reason: 'session-missing' | 'manifest-missing' | 'manifest-invalid'): string {
    const label = `widget '${id}' and session '${sessionId}'`
    const messageMap: Record<typeof reason, string> = {
      'manifest-missing': `Draft vibecanvas.json does not exist for ${label}`,
      'manifest-invalid': `Draft vibecanvas.json is invalid for ${label}`,
      'session-missing': `No connected agent session for ${label}`,
    }

    return messageMap[reason]
  }

  #publishDraftActorEvent(id: TWidgetId, sessionId: TVibecanvasChatId, actor: Actor, event: TAgentDraftActorEvent['event']): void {
    const publishEvent: TAgentDraftActorEvent = {
      kind: 'draft-actor',
      widgetId: id,
      sessionId,
      event,
      snapshot: this.#draftActorSnapshot(actor),
    }

    this.#config.eventPublisherService.publishAgentEvent(publishEvent)
  }

}
