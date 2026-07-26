import { createAgentSessionFromServices, createAgentSessionServices, ModelRuntime, SessionManager, SettingsManager, type AgentSession } from '@earendil-works/pi-coding-agent';
import type { ITenantEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import type { IServiceContext } from '@vibecanvas/runtime/interface.ts';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  ZWidgetBrowserFunctionDescriptors,
  ZWidgetManifestV3,
  type TWidgetCapsuleBuildIdentity,
  type TWidgetManifestV3,
  type TWidgetRevisionDescriptor,
  type TWidgetSourceSnapshot,
} from '@vibecanvas/widget-contract';
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fnMergeDraftResourceSelections } from './core/fn.draft-resource-bindings';
import { fnWidgetMentionContext, type TWidgetMentionContextItem } from './core/fn.widget-mention-context';
import { fxEffectiveWidgetDraftResourceBindingSelectionRecord, fxLatestWidgetDbChangeProposalRecord } from './core/fx.session-records';
import { txNormalizeSessionCwd } from './core/tx.session-cwd';
import { txAppendWidgetDbChangeProposalRecord, txAppendWidgetDraftResourceBindingSelectionRecord, txAppendWidgetResourceSelectionRecord } from './core/tx.session-records';
import { WIDGET_CHAT_SYSTEM_PROMPT } from './prompts/index';
import { ApprovalCoordinator } from './approval/ApprovalCoordinator';
import type { TApprovalDecision, TApprovalView, TToolAuthorizationContext, TToolAuthorizer } from './approval/types';
import { createToolRegistry } from './tools/ToolRegistry';
import type { TAgentResourceService } from './tools/resource-service';
import type { TAgentBashCapability } from './tools/tool.bash';
import { fnRedactSecretResourceWriteMessage } from './tools/fn.redact-secret-resource-write';
import { fnIsStructuredToolErrorDetails } from './tools/fn.result';
import type { TWidgetDbChangeProposalRecord, TWidgetResourceSelection } from './tools/types';
import { WidgetWorkspace } from './workspace/WidgetWorkspace';
import type { TWidgetMount } from './workspace/types';
import { WidgetDraftController } from './widget-drafts/WidgetDraftController';
import type {
  IAgentAuthoringStore,
  TAgentAuthoringDraftDescriptor,
  TWidgetAuthoringCapability,
  TWidgetAuthoringResourceSelection,
  TWidgetResourceBindingResolver,
} from './widget-drafts/types';
import { WidgetManagement } from './widget-management/WidgetManagement';
import {
  fnMergePublishedWidgetPlacementCatalog,
  fnParsePublishedWidgetPlacementReference,
  fnPublishedWidgetRelation,
  fnPublishedWidgetVariant,
  fnValidatePublishedWidgetPlacementTargets,
} from './widget-management/fn.published-widget-placement';
import {
  fnPublishedWidgetFile,
  fnPublishedWidgetFiles,
} from './widget-management/fn.published-source';
import type {
  TPublishedWidgetPlacementIdentity,
  TPublishedWidgetPlacementTarget,
  TWidgetDeleteResult,
  TWidgetDetail,
  TWidgetFileEntry,
  TWidgetFilePreview,
  TWidgetCatalogGroup,
  TWidgetDraftMetadataPatch,
  TWidgetDraftToolPatch,
  TWidgetSource,
} from './widget-management/types';

interface IPublicMethods {
  logout(providerId: string): Promise<void>;
  setApiKey(providerId: string, key: string): Promise<void>;
  removeApiKey(providerId: string): Promise<void>;
}

export interface IAgentServiceConfig {
  cachePath: string;
  dataPath: string;
  configPath: string;
  eventPublisherService: ITenantEventPublisherService,
  /** Required by the manifest-v3 Capsule authoring surface. */
  tenant?: TTenantContext;
  authoringStore?: IAgentAuthoringStore;
  widgetAuthoringCapability?: TWidgetAuthoringCapability;
  resolveWidgetResourceBindings?: TWidgetResourceBindingResolver;
  createId?: () => string;
  nowMs?: () => number;
  widgetBuilderIdentity?: string;
  widgetCapsuleBuildIdentity?: TWidgetCapsuleBuildIdentity;
  widgetBuildPolicyId?: string;
  resourceService?: TAgentResourceService;
  bashCapability?: TAgentBashCapability;
  listPublishedWidgetPlacements?: () => Promise<readonly TPublishedWidgetPlacementTarget[]>;
  resolvePublishedWidgetPlacement?: (
    target: TPublishedWidgetPlacementIdentity,
  ) => Promise<TPublishedWidgetPlacementTarget | null>;
  authorizeToolCall?: TToolAuthorizer;
  approvalTimeoutMs?: number;
}

type TWidgetId = string;
type TPublishedWidgetSelection =
  | Readonly<{ matched: false }>
  | Readonly<{
      matched: true;
      target: TPublishedWidgetPlacementTarget;
      revision: TWidgetRevisionDescriptor | null;
    }>;
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
  widgetRefs?: Array<{ name: string; source: TWidgetSource }>;
  thinkingLevel?: TThinkingLevel;
};
type TThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
const WIDGET_MENTION_CONTEXT_CUSTOM_TYPE = 'vibecanvas.widgetMentions';
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
  vcJson: TWidgetManifestV3 | null;
  messageHistory: AgentSession['messages'];
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

const PROMPT_IMAGE_FALLBACK_TEXT = 'Please use the attached image.'
const PROMPT_IMAGE_MAX_COUNT = 5
const PROMPT_IMAGE_MAX_BYTES = 10 * 1024 * 1024
const PROMPT_IMAGE_MAX_BASE64_LENGTH = Math.ceil(PROMPT_IMAGE_MAX_BYTES / 3) * 4
const PROMPT_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const PROMPT_IMAGE_BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/

export class AgentService implements IService, IStartableService, IStoppableService, IPublicMethods {
  name = 'agent-service'
  #config: IAgentServiceConfig;
  #piAgentDir: string;
  modelRuntime!: ModelRuntime;
  settingsManager: SettingsManager;
  sessionMap: Record<TWidgetId, Record<TVibecanvasChatId, TChatSessionEntry>> = {}
  #loginMap: Record<TLoginId, TLoginSession> = {}
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

  constructor(config: IAgentServiceConfig) {
    this.#config = config
    this.#piAgentDir = join(config.dataPath, 'pi', 'agent')
    this.#workspace = new WidgetWorkspace({ dataPath: config.dataPath })
    this.#widgetDrafts = config.tenant
      && config.authoringStore
      && config.widgetAuthoringCapability
      && config.resolveWidgetResourceBindings
      && config.createId
      && config.nowMs
      && config.widgetBuilderIdentity
      && config.widgetCapsuleBuildIdentity
      && config.widgetBuildPolicyId
      ? new WidgetDraftController({
          tenant: config.tenant,
          workspace: this.#workspace,
          eventPublisher: config.eventPublisherService,
          authoringStore: config.authoringStore,
          widgets: config.widgetAuthoringCapability,
          resolveResourceBindings: async (tenant, request) => (
            config.resolveWidgetResourceBindings!(tenant, {
              ...request,
              selectedResources: await this.#draftResourceSelections(
                config.authoringStore!,
                tenant,
                request.draft,
              ),
            })
          ),
          createId: config.createId,
          nowMs: config.nowMs,
          builderIdentity: config.widgetBuilderIdentity,
          capsuleBuildIdentity: config.widgetCapsuleBuildIdentity,
          buildPolicyId: config.widgetBuildPolicyId,
        })
      : this.#unavailableWidgetDrafts()
    this.#widgetManagement = new WidgetManagement({
      workspace: this.#workspace,
      drafts: this.#widgetDrafts,
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
    this.settingsManager = SettingsManager.create(this.#piAgentDir, this.#piAgentDir, { projectTrusted: true })
  }

  async start(ctx: IServiceContext<object, object>): Promise<void> {
    void ctx
    this.#isStopping = false
    this.modelRuntime = await ModelRuntime.create({
      authPath: join(this.#piAgentDir, 'auth.json'),
      modelsPath: join(this.#piAgentDir, 'models.json'),
    })
    await this.#workspace.init()
    console.log('start', this.name)
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
    this.#chatConnectionGenerations.clear()
    this.#chatConnectionLanes.clear()
    this.#chatReplacementGenerations.clear()
    try {
      this.#approvals.close()
    } catch (error) {
      failures.push(error)
    }
    try {
      await this.#widgetDrafts.close()
    } catch (error) {
      failures.push(error)
    }
    console.log('stop', this.name)
    if (failures.length > 0) throw new AggregateError(failures, 'Agent service shutdown failed.')
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
      await this.#disposeChatSession(id, sessionId)
      this.#chatReplacementGenerations.delete(sessionId)
    })
  }

  async promptChat(id: TWidgetId, sessionId: string, text: string, promptSelection?: TPromptSelection): Promise<void> {
    const connectedEntry = this.sessionMap[id]?.[sessionId]
    if (!connectedEntry) {
      throw new Error(`No connected agent session for widget '${id}' and session '${sessionId}'`)
    }
    const selectedWidgets = promptSelection?.widgetRefs
      ? await this.#resolveChatWidgetSelections(promptSelection.widgetRefs)
      : []
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
      const model = this.modelRuntime.getModel(promptSelection.model.provider, promptSelection.model.modelId)
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
    const widgetContext = fnWidgetMentionContext({ widgets: selectedWidgets })
    if (widgetContext) {
      await session.sendCustomMessage({
        customType: WIDGET_MENTION_CONTEXT_CUSTOM_TYPE,
        content: widgetContext,
        display: false,
        details: { widgets: selectedWidgets },
      }, { deliverAs: 'nextTurn' })
    }
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

  getWidgetDraft(draftId: string) {
    return this.#widgetDrafts.get(draftId)
  }

  validateWidgetDraft(draftId: string, expectedRevision?: string) {
    return this.#widgetDrafts.validate(draftId, expectedRevision)
  }

  buildWidgetPreview(draftId: string) {
    return this.#widgetDrafts.buildPreview(draftId)
  }

  publishWidgetDraft(draftId: string, expectedRevision: string) {
    return this.#widgetDrafts.publish(draftId, expectedRevision)
  }

  async getWidgetCatalog(groups: TWidgetCatalogGroup[]) {
    const [unfilteredDraftCatalog, targets] = await Promise.all([
      this.#widgetManagement.catalog(groups),
      this.#config.listPublishedWidgetPlacements?.() ?? Promise.resolve([]),
    ])
    const visibleDraftWidgets = (await Promise.all(unfilteredDraftCatalog.widgets.map(async (entry) => (
      await this.#workspace.isDraftMaterializationPending(entry.name) ? null : entry
    )))).filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    const draftCatalog = visibleDraftWidgets.length === unfilteredDraftCatalog.widgets.length
      ? unfilteredDraftCatalog
      : {
          ...unfilteredDraftCatalog,
          generation: `${unfilteredDraftCatalog.generation}:pending-materializations-hidden`,
          widgets: visibleDraftWidgets,
        }
    const validated = fnValidatePublishedWidgetPlacementTargets(targets)
    if (!validated.ok) throw new Error(`OPERATION_UNAVAILABLE: ${validated.message}`)
    const draftPublicationStates = this.#config.tenant && this.#config.authoringStore
      ? (await this.#config.authoringStore.listDrafts(this.#config.tenant)).map((draft) => ({
          draftId: draft.id,
          definitionId: draft.definitionId,
          name: draft.name,
          status: draft.status,
          publishedRevisionId: draft.publishedRevisionId,
        }))
      : []
    return fnMergePublishedWidgetPlacementCatalog({
      draftCatalog,
      targets: validated.targets,
      draftPublicationStates,
    })
  }

  async getWidgetDetail(name: string, source: TWidgetSource): Promise<TWidgetDetail | null> {
    if (source === 'draft') {
      return await this.#workspace.isDraftMaterializationPending(name)
        ? null
        : this.#widgetManagement.detail(name, source)
    }
    const selected = await this.#publishedWidget(name)
    if (!selected.matched) return null
    if (!selected.revision) return null
    const draft = await this.#workspace.isDraftMaterializationPending(name)
      ? null
      : await this.#widgetManagement.detail(name, 'draft')
    const draftPublicationStates = await this.#draftPublicationStates(name)
    return {
      name,
      source: 'published',
      relation: fnPublishedWidgetRelation({
        target: selected.target,
        draft: draft?.variant ?? null,
        draftPublicationStates,
      }),
      variant: fnPublishedWidgetVariant({
        target: selected.target,
        updatedAt: new Date(selected.revision.createdAtMs).toISOString(),
      }),
      sibling: draft?.variant ?? null,
      manifest: selected.revision.manifest,
      functions: ZWidgetBrowserFunctionDescriptors.parse(
        selected.revision.functionDescriptors.map(({ modulePath: _modulePath, ...descriptor }) => descriptor),
      ),
      problem: null,
    }
  }

  async listWidgetFiles(
    name: string,
    source: TWidgetSource,
  ): Promise<TWidgetFileEntry[] | null> {
    if (source === 'draft') {
      return await this.#workspace.isDraftMaterializationPending(name)
        ? null
        : this.#widgetManagement.files(name, source)
    }
    const selected = await this.#publishedWidget(name)
    if (!selected.matched) return null
    if (!selected.revision) return null
    return fnPublishedWidgetFiles({
      snapshot: await this.#publishedSource(selected.target, selected.revision),
    })
  }

  async readWidgetFile(
    name: string,
    source: TWidgetSource,
    path: string,
  ): Promise<TWidgetFilePreview | null> {
    if (source === 'draft') {
      return await this.#workspace.isDraftMaterializationPending(name)
        ? null
        : this.#widgetManagement.file(name, source, path)
    }
    const selected = await this.#publishedWidget(name)
    if (!selected.matched) return null
    if (!selected.revision) return null
    return fnPublishedWidgetFile({
      snapshot: await this.#publishedSource(selected.target, selected.revision),
      path,
      decodeUtf8: (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    })
  }

  async ensureWidgetDraft(name: string, expectedPublishedFingerprint?: string) {
    const selected = await this.#publishedWidget(name)
    if (!selected.matched) {
      return this.#widgetManagement.ensureDraft(name, expectedPublishedFingerprint)
    }
    if (
      !selected.revision
      || (
        expectedPublishedFingerprint !== undefined
        && expectedPublishedFingerprint !== selected.target.contractDigestSha256
      )
    ) {
      throw new Error('STALE_REVISION: Published widget changed before the draft could be created.')
    }

    const snapshot = await this.#publishedSource(selected.target, selected.revision)
    // Source reads are immutable, but active publication is mutable. Recheck
    // the exact placement immediately before materialization so this operation
    // has one explicit active-revision linearization point.
    const current = await this.#publishedWidget(name)
    if (
      !current.matched
      || !current.revision
      || current.target.definitionId !== selected.target.definitionId
      || current.target.revisionId !== selected.target.revisionId
      || current.target.contractDigestSha256 !== selected.target.contractDigestSha256
    ) {
      throw new Error('STALE_REVISION: Published widget changed before the draft could be created.')
    }
    await this.#widgetDrafts.materializePublishedDraft({
      name,
      definitionId: selected.target.definitionId,
      publishedRevisionId: selected.target.revisionId,
      snapshot,
    })
    const materialized = await this.#widgetManagement.detail(name, 'draft')
    if (!materialized) {
      throw new Error('OPERATION_UNAVAILABLE: Materialized widget draft could not be read.')
    }
    return materialized.variant
  }

  patchWidgetDraftTool(name: string, expectedRevision: string, patch: TWidgetDraftToolPatch) {
    return this.#widgetManagement.patchDraftTool(name, expectedRevision, patch)
  }

  patchWidgetDraftMetadata(name: string, expectedRevision: string, patch: TWidgetDraftMetadataPatch) {
    return this.#widgetManagement.patchDraftMetadata(name, expectedRevision, patch)
  }

  async deleteWidget(name: string, source: TWidgetSource): Promise<TWidgetDeleteResult | null> {
    if (source === 'draft') return this.#widgetManagement.delete(name, source)
    const selected = await this.#publishedWidget(name)
    if (!selected.matched) return null
    if (!selected.revision) return null
    const tenant = this.#config.tenant
    const widgets = this.#config.widgetAuthoringCapability
    if (!tenant || !widgets || !this.#config.nowMs) {
      throw new Error('OPERATION_UNAVAILABLE: Published widget deletion is unavailable in this host.')
    }
    const archived = await widgets.archive(tenant, {
      definitionId: selected.target.definitionId,
      expectedActiveRevisionId: selected.target.revisionId,
      nowMs: this.#config.nowMs(),
    })
    if (archived.status !== 'archived') {
      throw new Error('STALE_REVISION: Published widget changed before it could be deleted.')
    }
    let deletedDraft = false
    const issues: TWidgetDeleteResult['issues'] = []
    const durableDraft = this.#config.authoringStore
      ? await this.#config.authoringStore.getDraftByName(tenant, name)
      : null
    if (
      durableDraft
      && durableDraft.definitionId === selected.target.definitionId
      && durableDraft.status !== 'discarded'
    ) {
      const result = await this.#widgetManagement.delete(name, 'draft')
      deletedDraft = result?.deletedDraft ?? false
      issues.push(...(result?.issues ?? []))
    }
    return {
      name,
      source,
      deletedDefinition: true,
      deletedPublished: true,
      deletedDraft,
      deletedInstances: false,
      issues,
    }
  }

  async resolveWidgetPlacement(
    reference: import('@vibecanvas/widget-contract').TWidgetPlacementRef,
    expectedDraftId?: string,
  ): Promise<import('./widget-management/types').TWidgetPlacementResolveResult> {
    const placementIdentity = fnParsePublishedWidgetPlacementReference(reference)
    if (placementIdentity) {
      const target = this.#config.resolvePublishedWidgetPlacement
        ? await this.#config.resolvePublishedWidgetPlacement(placementIdentity)
        : null
      if (
        !target
        || target.definitionId !== placementIdentity.definitionId
        || target.revisionId !== placementIdentity.revisionId
      ) {
        return {
          ok: false,
          code: 'NOT_FOUND',
          message: 'Published widget placement is no longer active.',
        }
      }
      return {
        ok: true,
        descriptor: {
          reference,
          bounds: target.bounds,
          kind: 'published',
          draftId: null,
          definitionId: target.definitionId,
          revisionId: target.revisionId,
          definitionName: null,
          definitionSlug: target.slug,
        },
      }
    }
    const resolved = await this.#widgetManagement.resolvePlacementReference(reference)
    if (!resolved.ok) return resolved
    if (resolved.descriptor.kind !== 'preview') {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Widget Preview placement is unavailable.',
      }
    }
    if (!expectedDraftId) {
      return {
        ok: false,
        code: 'UNSUPPORTED_BEHAVIOR',
        message: 'Preview placement requires an exact durable draft owner.',
      }
    }
    const durableDraft = await this.#widgetDrafts.getByName(reference.name)
    if (!durableDraft) {
      return { ok: false, code: 'NOT_FOUND', message: `Widget draft '${reference.name}' is unavailable.` }
    }
    if (durableDraft.draftId !== expectedDraftId) {
      return {
        ok: false,
        code: 'STALE_REVISION',
        message: `Widget draft '${reference.name}' changed ownership before placement.`,
        currentRevision: durableDraft.revision,
      }
    }
    return {
      ok: true,
      descriptor: { ...resolved.descriptor, draftId: durableDraft.draftId },
    }
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
      defaultModel,
      defaultProvider,
      defaultThinkingLevel,
      providersWithCredentials,
      providers,
      models
    }
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

    await this.#installChatSessionEntry(id, sessionId, sessionEntry, replacementGeneration !== undefined
      ? 'Chat runtime was intentionally replaced.'
      : 'Chat ownership changed before approval.')
    if (replacementGeneration !== undefined && replacementGeneration <= generation) {
      this.#chatReplacementGenerations.delete(sessionId)
    }
    return { status: 'connected', result: await this.#chatConnectResult(id, sessionId, sessionEntry) }
  }

  async #chatConnectResult(id: TWidgetId, sessionId: TVibecanvasChatId, sessionEntry: TChatSessionEntry): Promise<TAgentConnectResult> {
    const activeMount = await this.#resolveActiveMount(id, sessionId).catch(() => null)
    const vcJson = activeMount ? await this.#readMountedManifest(activeMount).catch(() => null) : null
    return {
      vcJson,
      messageHistory: sessionEntry.session.messages,
    }
  }

  async #publishedWidget(name: string): Promise<TPublishedWidgetSelection> {
    if (!this.#config.listPublishedWidgetPlacements) return { matched: false }
    const targets = await this.#config.listPublishedWidgetPlacements()
    const validated = fnValidatePublishedWidgetPlacementTargets(targets)
    if (!validated.ok) throw new Error(`OPERATION_UNAVAILABLE: ${validated.message}`)
    const target = validated.targets.find((candidate) => candidate.name === name)
    if (!target) return { matched: false }
    const resolved = this.#config.resolvePublishedWidgetPlacement
      ? await this.#config.resolvePublishedWidgetPlacement({
          definitionId: target.definitionId,
          revisionId: target.revisionId,
        })
      : target
    if (!resolved) return { matched: true, target, revision: null }
    const resolvedValidation = fnValidatePublishedWidgetPlacementTargets([resolved])
    if (
      !resolvedValidation.ok
      || resolved.definitionId !== target.definitionId
      || resolved.revisionId !== target.revisionId
      || resolved.name !== target.name
      || resolved.slug !== target.slug
      || resolved.description !== target.description
      || resolved.contractDigestSha256 !== target.contractDigestSha256
      || resolved.updatedAtMs !== target.updatedAtMs
      || resolved.bounds.width !== target.bounds.width
      || resolved.bounds.height !== target.bounds.height
    ) return { matched: true, target, revision: null }
    const tenant = this.#config.tenant
    const widgets = this.#config.widgetAuthoringCapability
    if (!tenant || !widgets) {
      throw new Error('OPERATION_UNAVAILABLE: Published widget inspection is unavailable in this host.')
    }
    const revision = await widgets.getActiveRevision(tenant, target.definitionId)
    if (
      !revision
      || revision.orgId !== tenant.orgId
      || revision.id !== target.revisionId
      || revision.definitionId !== target.definitionId
      || revision.manifest.name !== target.name
      || revision.manifest.slug !== target.slug
      || (revision.manifest.description ?? null) !== target.description
      || revision.contractDigestSha256 !== target.contractDigestSha256
      || revision.createdAtMs !== target.updatedAtMs
    ) return { matched: true, target, revision: null }
    return { matched: true, target, revision }
  }

  async #publishedSource(
    target: TPublishedWidgetPlacementTarget,
    revision: TWidgetRevisionDescriptor,
  ): Promise<TWidgetSourceSnapshot> {
    const tenant = this.#config.tenant
    const widgets = this.#config.widgetAuthoringCapability
    if (!tenant || !widgets) {
      throw new Error('OPERATION_UNAVAILABLE: Published widget source inspection is unavailable in this host.')
    }
    const [source, snapshot] = await Promise.all([
      widgets.getRevisionSource(tenant, revision.id),
      widgets.readRevisionSourceSnapshot(tenant, {
        definitionId: target.definitionId,
        revisionId: revision.id,
      }),
    ])
    if (
      !source
      || !snapshot
      || source.orgId !== tenant.orgId
      || source.definitionId !== target.definitionId
      || source.revisionId !== revision.id
      || snapshot.id !== source.sourceSnapshotId
      || snapshot.digestSha256 !== source.sourceDigestSha256
    ) {
      throw new Error('OPERATION_UNAVAILABLE: Published widget source is unavailable.')
    }
    return snapshot
  }

  async #draftPublicationStates(name: string) {
    const tenant = this.#config.tenant
    const store = this.#config.authoringStore
    if (!tenant || !store) return []
    const draft = await store.getDraftByName(tenant, name)
    return draft && draft.status !== 'discarded'
      ? [{
          draftId: draft.id,
          definitionId: draft.definitionId,
          name: draft.name,
          status: draft.status,
          publishedRevisionId: draft.publishedRevisionId,
        }]
      : []
  }

  #chatSessionEntry(sessionId: TVibecanvasChatId): TChatSessionEntry | undefined {
    const widgetId = this.#chatWidgetIds.get(sessionId)
    return widgetId ? this.sessionMap[widgetId]?.[sessionId] : undefined
  }

  async #draftResourceSelections(
    authoringStore: IAgentAuthoringStore,
    tenant: TTenantContext,
    draft: TAgentAuthoringDraftDescriptor,
  ): Promise<readonly TWidgetAuthoringResourceSelection[] | undefined> {
    const chat = await authoringStore.getChat(tenant, draft.chatId)
    if (!chat) {
      throw Object.assign(new Error('Durable widget draft chat was not found.'), {
        code: 'AGENT_CHAT_NOT_FOUND',
      })
    }
    const connected = this.#chatSessionEntry(chat.externalSessionKey)
    const sessionManager = connected?.sessionManager ?? SessionManager.continueRecent(
      this.#workspace.getChatRoot(chat.externalSessionKey),
      this.#workspace.getChatHistoryRoot(chat.externalSessionKey),
    )
    const record = fxEffectiveWidgetDraftResourceBindingSelectionRecord({ sessionManager }, {})
    return record?.resources
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

  async #installChatSessionEntry(id: TWidgetId, sessionId: TVibecanvasChatId, sessionEntry: TChatSessionEntry, approvalReason: string): Promise<void> {
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
      resourceService: this.#config.resourceService,
      bashCapability: this.#config.bashCapability,
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
      modelRuntime: this.modelRuntime,
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
            pi.on('tool_result', (event) => (
              !event.isError && fnIsStructuredToolErrorDetails(event.details)
                ? { isError: true }
                : undefined
            ))
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

  async #readMountedManifest(mount: TWidgetMount): Promise<TWidgetManifestV3> {
    return ZWidgetManifestV3.parse(
      JSON.parse(await readFile(join(mount.targetPath, 'vibecanvas.json'), 'utf8')),
    )
  }

  #assertChatScope(id: TWidgetId, sessionId: TVibecanvasChatId): void {
    if (this.#chatWidgetIds.get(sessionId) !== id || !this.sessionMap[id]?.[sessionId]) {
      throw new Error(`No connected agent session for widget '${id}' and session '${sessionId}'`)
    }
  }

  async #resolveChatResourceSelections(resourceIds: readonly string[]): Promise<TWidgetResourceSelection[]> {
    if (resourceIds.length > 16) throw new Error('A prompt can select at most 16 resources.')
    const ids = [...new Set(resourceIds)]
    if (!this.#config.resourceService?.getResource) throw new Error('Resource selection is unavailable in this host.')

    const selected: TWidgetResourceSelection[] = []
    for (const resourceId of ids) {
      const resource = await this.#config.resourceService.getResource(resourceId)
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

  async #resolveChatWidgetSelections(
    refs: readonly { name: string; source: TWidgetSource }[],
  ): Promise<TWidgetMentionContextItem[]> {
    if (refs.length > 16) throw new Error('A prompt can select at most 16 widgets.')
    const unique = [...new Map(refs.map((ref) => [`${ref.source}\u0000${ref.name}`, ref])).values()]
    const selected: TWidgetMentionContextItem[] = []
    for (const ref of unique) {
      const detail = await this.getWidgetDetail(ref.name, ref.source)
      if (!detail) throw new Error(`Selected ${ref.source} widget was not found: ${ref.name}`)
      selected.push({
        name: detail.name,
        source: detail.source,
        displayName: detail.variant.displayName,
        revision: detail.variant.revision,
      })
    }
    return selected
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

  async #disposeChatSession(id: TWidgetId, sessionId: TVibecanvasChatId): Promise<void> {
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

  #unavailableWidgetDrafts(): WidgetDraftController {
    const unavailable = () => {
      throw Object.assign(new Error('Widget authoring is unavailable in this host.'), {
        code: 'WIDGET_AUTHORING_UNAVAILABLE',
      })
    }
    return {
      close: async () => undefined,
      handleToolChange: async () => undefined,
      list: async () => [],
      get: async () => null,
      getByName: async () => null,
      getWorkspaceRevision: async () => unavailable(),
      validate: async () => null,
      getPreviewCatalogState: async () => null,
      buildPreview: async () => unavailable(),
      publish: async () => unavailable(),
      forget: async () => undefined,
      withDraftDeletion: async (_name: string, operation: (cleanup: () => Promise<void>) => Promise<unknown>) => (
        operation(async () => undefined)
      ),
      withDraftRename: async (
        _name: string,
        _nextName: string,
        operation: (cleanup: () => Promise<void>) => Promise<unknown>,
      ) => operation(async () => undefined),
    } as unknown as WidgetDraftController
  }

}
