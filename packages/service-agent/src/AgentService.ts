import { AuthStorage, createAgentSessionFromServices, createAgentSessionServices, ModelRegistry, SessionManager, SettingsManager, type AgentSession } from '@earendil-works/pi-coding-agent';
import { Actor, type TActorEvent } from '@vibecanvas/service-actor/Actor';
import { ActorResourceError } from '@vibecanvas/service-actor';
import type { TVibecanvasToolIcon } from '@vibecanvas/service-actor/core/tool-icon';
import type { TActorData, TActorState, TJsonSchema, TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import { ZActorData, ZJsonSchema, ZVibecanvasJson, ZVibecanvasToolIcon } from '@vibecanvas/service-actor/core/vibecanvasjson.zod';
import type { IEventPublisherService, TAgentDraftActorEvent } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import type { IServiceContext } from '@vibecanvas/runtime/interface.ts';
import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative as relativePath, resolve } from 'node:path';
import { fnBumpWidgetVersion } from './core/fn.bump-widget-version';
import { fnMergeDraftResourceSelections } from './core/fn.draft-resource-bindings';
import { fxEffectiveWidgetDraftResourceBindingSelectionRecord, fxLatestActorCandidateApprovalRecord, fxLatestActorCandidateRecord, fxLatestWidgetDbChangeProposalRecord, fxLatestWidgetEditSessionRecord } from './core/fx.session-candidate';
import { txPublishWidgetDraft } from './core/tx.publish-widget-draft';
import { txReconcileResourceBindings } from './core/tx.reconcile-resource-bindings';
import { txAppendActorCandidateApprovalRecord, txAppendActorCandidateRecord, txAppendDraftManifestPathRecord, txAppendWidgetDbChangeProposalRecord, txAppendWidgetDraftResourceBindingSelectionRecord, txAppendWidgetEditSessionRecord, txAppendWidgetResourceSelectionRecord } from './core/tx.session-candidate';
import { WIDGET_CHAT_SYSTEM_PROMPT } from './prompts/index';
import { fnValidateCandidate } from './tools/fn.candidate';
import { createWidgetWizardPhaseTools } from './tools/phase-tools';
import { planImplicitResourceSelections, planSelectedResourceBindings, type TResourceBindingPlan } from './tools/resource-bindings';
import type { TActorCandidate, TActorCandidateRecord, TActorServiceReloader, TToolEvent, TWidgetDbChangeProposalRecord, TWidgetEditSessionRecord, TWidgetResourceSelection } from './tools/types';

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
}

type TWidgetId = string;
type TSessionId = string;
type TLoginId = string;
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
  actorCandidate: TActorCandidateRecord | null;
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
};

type TDraftActorKey = `${TWidgetId}:${TSessionId}`;

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
  | { ready: true; source: 'file' | 'actor-candidate'; manifest: TVibecanvasJson }
  | { ready: false; reason: 'session-missing' | 'manifest-missing' | 'manifest-invalid'; message: string };

type TAgentDraftManifestPatch = {
  name?: string;
  description?: string;
  initialData?: unknown;
  dataSchema?: unknown;
  tool?: {
    label?: string;
    icon?: TVibecanvasToolIcon | null;
    group?: string | null;
    priority?: number | null;
  };
};

type TAgentDraftManifestPatchResult =
  | { ok: true; source: 'file' | 'actor-candidate'; manifest: TVibecanvasJson }
  | { ok: false; reason: 'session-missing' | 'manifest-missing' | 'manifest-invalid' | 'edit-invalid'; message: string; issues?: string[] };

type TAgentChatPublishResult =
  | { published: true; manifest: TVibecanvasJson; destination: string; files: string[] }
  | { published: false; manifest: TVibecanvasJson | null; destination: null; message: string; errors?: string[]; warnings?: string[] };

type TAgentChatStartWidgetEditResult =
  | { ok: true; vcJson: TVibecanvasJson; phase: 'implementation'; editSession: TWidgetEditSessionRecord; messageHistory: AgentSession['messages'] }
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
  sessionMap: Record<TWidgetId, Record<TSessionId, TChatSessionEntry>> = {}
  #loginMap: Record<TLoginId, TLoginSession> = {}
  #draftActorMap = new Map<TDraftActorKey, TDraftActorEntry>();
  #dbChangeProposalResolutions = new Set<string>();

  constructor(config: IActorServiceConfig) {
    this.#config = config
    this.#piAgentDir = join(config.dataPath, 'pi', 'agent')
    this.authStorage = AuthStorage.create(join(this.#piAgentDir, 'auth.json'))
    this.modelRegistry = ModelRegistry.create(this.authStorage, join(this.#piAgentDir, 'models.json'))
    this.settingsManager = SettingsManager.create(this.#piAgentDir, this.#piAgentDir, { projectTrusted: true })
  }

  async start(ctx: IServiceContext<object, object>): Promise<void> {
    void ctx
    console.log('start', this.name)
  }

  async stop(): Promise<void> {
    for (const [id, sessions] of Object.entries(this.sessionMap)) {
      for (const sessionId of Object.keys(sessions)) {
        this.#disposeChatSession(id, sessionId)
      }
    }
    this.#disposeAllDraftActors()
    console.log('stop', this.name)
  }

  async connectChat(id: TWidgetId, sessionId: string): Promise<TAgentConnectResult> {
    this.#disposeAgentSession(id, sessionId)

    const cwd = this.#getWizardCwd(id, sessionId)
    mkdirSync(cwd, { recursive: true })
    const sessionDir = join(this.#piAgentDir, 'sessions', sessionId)
    const sessionManager = SessionManager.continueRecent(cwd, sessionDir)
    const entry = sessionManager.getEntry('vibejsonpath')
    let vcJson: TVibecanvasJson | null = null;
    if (entry?.type === 'custom' && entry?.customType === 'vibejsonpath' && typeof entry.data === 'string') {
      try {
        vcJson = await Bun.file(entry.data).json()
      } catch { }
    }

    const sessionEntry = await this.#createChatSessionEntry(id, sessionId, sessionManager)
    const actorCandidate = fxLatestActorCandidateRecord({ sessionManager })
    if (!this.sessionMap[id]) {
      this.sessionMap[id] = {}
    }

    this.sessionMap[id][sessionId] = sessionEntry

    return {
      vcJson,
      actorCandidate,
      messageHistory: sessionEntry.session.messages,
      editSession: fxLatestWidgetEditSessionRecord({ sessionManager }),
    }
  }

  newChatSession(id: TWidgetId, sessionId: string): void {
    this.#disposeChatSession(id, sessionId)
  }

  async startWidgetEditChat(id: TWidgetId, sessionId: string, definitionName: string): Promise<TAgentChatStartWidgetEditResult> {
    const sourceManifest = this.#config.actorService?.getVibecanvasJson?.(definitionName)
    if (!sourceManifest) {
      return { ok: false, message: `Published widget definition not found: ${definitionName}` }
    }

    const sourceManifestPath = this.#resolveConfigPath(sourceManifest.manifest_path)
    const sourceDir = dirname(sourceManifestPath)
    const draftDir = this.#getWizardCwd(id, sessionId)
    const sourceStat = await stat(sourceDir).catch(() => null)
    if (!sourceStat?.isDirectory()) {
      return { ok: false, message: `Published widget folder does not exist: ${sourceDir}` }
    }

    this.#disposeChatSession(id, sessionId)
    await rm(draftDir, { recursive: true, force: true })
    await mkdir(draftDir, { recursive: true })
    await cp(sourceDir, draftDir, {
      recursive: true,
      filter: (source) => this.#shouldCopyPublishedWidgetFile(sourceDir, source),
    })

    const nextVersion = fnBumpWidgetVersion(sourceManifest.version)
    const draftManifest: TVibecanvasJson = {
      ...sourceManifest,
      version: nextVersion,
    }
    const draftManifestPath = join(draftDir, 'vibecanvas.json')
    await writeFile(draftManifestPath, `${JSON.stringify(draftManifest, null, 2)}\n`, 'utf8')

    const sessionDir = join(this.#piAgentDir, 'sessions', sessionId)
    const sessionManager = SessionManager.continueRecent(draftDir, sessionDir)
    const draftFiles = await this.#listDraftFiles(draftDir)
    const editStartedAt = new Date().toISOString()
    this.#ensureImplementationPhaseForDraftManifest(sessionManager, draftManifest, draftManifestPath, draftFiles, editStartedAt)
    const editSession = txAppendWidgetEditSessionRecord({ sessionManager }, {
      mode: 'edit-published-widget',
      sourceDefinitionName: definitionName,
      sourceSlug: sourceManifest.slug,
      sourceName: sourceManifest.name,
      sourceManifestPath: sourceManifest.manifest_path,
      previousVersion: sourceManifest.version,
      nextVersion,
      startedAt: editStartedAt,
    })
    sessionManager.appendCustomMessageEntry(
      'vibecanvas.widgetLoaded',
      `[Widget ${draftManifest.name} loaded]`,
      true,
      {
        definitionName,
        slug: draftManifest.slug,
        previousVersion: sourceManifest.version,
        nextVersion,
      },
    )
    this.#flushSessionManager(sessionManager)

    const sessionEntry = await this.#createChatSessionEntry(id, sessionId, sessionManager)
    if (!this.sessionMap[id]) {
      this.sessionMap[id] = {}
    }
    this.sessionMap[id][sessionId] = sessionEntry

    return {
      ok: true,
      vcJson: draftManifest,
      phase: 'implementation',
      editSession,
      messageHistory: sessionEntry.session.messages,
    }
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

    await this.#refreshChatSessionToolsIfNeeded(id, sessionId)

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

  async approveChatDbChange(id: TWidgetId, sessionId: TSessionId, proposalId: string): Promise<TWidgetDbChangeProposalRecord> {
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

  rejectChatDbChange(id: TWidgetId, sessionId: TSessionId, proposalId: string): TWidgetDbChangeProposalRecord {
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

    await session.abort()

    return { canceled: true, running: session.isStreaming }
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

    const rootDir = this.#getWizardCwd(id, sessionId)
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

    const rootDir = this.#getWizardCwd(id, sessionId)
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

    const rootDir = this.#getWizardCwd(id, sessionId)
    const manifestResult = await this.#readDraftActorManifest(rootDir)
    if (manifestResult.ready) {
      return {
        ready: true,
        source: 'file',
        manifest: manifestResult.manifest,
      }
    }

    if (manifestResult.reason === 'manifest-missing') {
      const actorCandidate = fxLatestActorCandidateRecord({ sessionManager: sessionEntry.sessionManager })
      if (actorCandidate) {
        return {
          ready: true,
          source: 'actor-candidate',
          manifest: actorCandidate.manifest,
        }
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

    const currentManifest = await this.#readDraftActorManifest(this.#getWizardCwd(id, sessionId))
    if (!currentManifest.ready && currentManifest.reason === 'manifest-missing') {
      const actorCandidate = fxLatestActorCandidateRecord({ sessionManager: sessionEntry.sessionManager })

      if (!actorCandidate) {
        return {
          ok: false,
          reason: 'manifest-missing',
          message: 'Draft vibecanvas.json does not exist yet. Approve the actor candidate first before editing the manifest file.',
        }
      }

      const editResult = this.#applyDraftManifestPatch(actorCandidate.manifest, patch)
      if (!editResult.ok) return editResult

      const candidate = this.#createActorCandidateFromManifest(actorCandidate.candidate, editResult.manifest)
      const validationResult = fnValidateCandidate(candidate)

      if (!validationResult.candidate || !validationResult.manifest || !validationResult.validation.ok) {
        return {
          ok: false,
          reason: 'manifest-invalid',
          message: validationResult.validation.errors.join('; ') || 'Actor candidate is invalid.',
          issues: validationResult.validation.errors,
        }
      }

      const record = txAppendActorCandidateRecord({ sessionManager: sessionEntry.sessionManager }, {
        candidate: validationResult.candidate,
        manifest: validationResult.manifest,
        validation: validationResult.validation,
        updatedAt: new Date().toISOString(),
      })

      return {
        ok: true,
        source: 'actor-candidate',
        manifest: record.manifest,
      }
    }
    if (!currentManifest.ready) {
      return {
        ok: false,
        reason: currentManifest.reason === 'session-missing' ? 'session-missing' : currentManifest.reason === 'manifest-missing' ? 'manifest-missing' : 'manifest-invalid',
        message: currentManifest.message,
      }
    }

    const editResult = this.#applyDraftManifestPatch(currentManifest.manifest, patch)
    if (!editResult.ok) return editResult

    const manifestPath = join(this.#getWizardCwd(id, sessionId), 'vibecanvas.json')
    await writeFile(manifestPath, `${JSON.stringify(editResult.manifest, null, 2)}\n`, 'utf8')

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

    const rootDir = this.#getWizardCwd(id, sessionId)
    const manifestResult = await this.#readDraftActorManifest(rootDir)
    if (!manifestResult.ready) {
      return {
        published: false,
        manifest: null,
        destination: null,
        message: manifestResult.message,
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
    if (bindingPlan.bindings.length > 0 && !this.#config.actorService?.bindResource) {
      return {
        published: false,
        manifest: manifestResult.manifest,
        destination: null,
        message: 'Selected resources cannot be persisted by Publish in this host.',
      }
    }
    const shouldReloadEditedInstances = editSession !== null
      && editSession.sourceName === manifestResult.manifest.name
      && editSession.sourceSlug === manifestResult.manifest.slug
    const result = await txPublishWidgetDraft({ readdir, readFile, writeFile, mkdir, rm, cp, execFile, join, relative: relativePath, resolve, basename }, {
      cwd: rootDir,
      finalWidgetsDir: join(this.#config.configPath, 'widgets'),
      actorService: shouldReloadEditedInstances ? undefined : this.#config.actorService,
      sdkActorTypePath: resolve(import.meta.dir, '../../sdk/src/actor.ts'),
    })

    if (!result.published) {
      return {
        published: false,
        manifest: result.manifest,
        destination: null,
        message: result.validation.errors.join('\n') || 'Widget draft is invalid and was not published.',
        errors: result.validation.errors,
        warnings: result.validation.warnings,
      }
    }

    this.#disposeDraftActor(id, sessionId)
    await this.#config.actorService?.reload()
    await txReconcileResourceBindings({ actorService: this.#config.actorService }, {
      definitionName: result.manifest.name,
      bindings: bindingPlan.bindings.map((binding) => ({
        slot: binding.slot,
        resourceId: binding.resource.id,
        scope: binding.scope,
      })),
    })
    if (shouldReloadEditedInstances) {
      await this.#config.actorService?.reloadDefinitionInstances?.(editSession.sourceDefinitionName)
    }
    if (!result.destination) {
      return {
        published: false,
        manifest: result.manifest,
        destination: null,
        message: 'Widget publish completed without a destination path.',
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
    const issues: string[] = []
    let initialData = manifest.actor.initialData
    let dataSchema = manifest.actor.dataSchema
    let tool = manifest.widget.tool

    if ('initialData' in patch) {
      const parsed = ZActorData.safeParse(patch.initialData)
      if (!parsed.success) {
        issues.push(...parsed.error.issues.map((issue) => `actor.initialData.${issue.path.join('.')}: ${issue.message}`))
      } else {
        initialData = parsed.data
      }
    }

    if ('dataSchema' in patch) {
      const parsed = ZJsonSchema.safeParse(patch.dataSchema)
      if (!parsed.success) {
        issues.push(...parsed.error.issues.map((issue) => `actor.dataSchema.${issue.path.join('.')}: ${issue.message}`))
      } else {
        dataSchema = parsed.data as TJsonSchema
      }
    }

    if ('tool' in patch && patch.tool) {
      if (typeof patch.tool.label === 'string') {
        tool = {
          ...tool,
          label: patch.tool.label,
        }
      }

      if ('icon' in patch.tool) {
        if (patch.tool.icon === null) {
          tool = {
            ...tool,
            icon: undefined,
          }
        } else {
          const parsedIcon = ZVibecanvasToolIcon.safeParse(patch.tool.icon)
          if (!parsedIcon.success) {
            issues.push(...parsedIcon.error.issues.map((issue) => {
              const path = ['widget', 'tool', 'icon', ...issue.path].join('.')
              return `${path}: ${issue.message}`
            }))
          } else {
            tool = {
              ...tool,
              icon: parsedIcon.data,
            }
          }
        }
      }

      if ('group' in patch.tool) {
        if (patch.tool.group === null) {
          tool = {
            ...tool,
            group: undefined,
          }
        } else if (typeof patch.tool.group !== 'string') {
          issues.push('widget.tool.group: expected a string')
        } else {
          tool = {
            ...tool,
            group: patch.tool.group,
          }
        }
      }

      if ('priority' in patch.tool) {
        if (patch.tool.priority === null) {
          tool = {
            ...tool,
            priority: undefined,
          }
        } else if (typeof patch.tool.priority !== 'number' || Number.isNaN(patch.tool.priority)) {
          issues.push('widget.tool.priority: expected a number')
        } else {
          tool = {
            ...tool,
            priority: patch.tool.priority,
          }
        }
      }

      if (patch.tool.label === undefined
        && !('icon' in patch.tool)
        && !('group' in patch.tool)
        && !('priority' in patch.tool)
      ) {
        issues.push('widget.tool: no editable field supplied')
      }
    }

    if (issues.length > 0) {
      return {
        ok: false,
        reason: 'edit-invalid',
        message: issues.join('; '),
        issues,
      }
    }

    const nextManifest = {
      ...manifest,
      name: patch.name ?? manifest.name,
      description: patch.description ?? manifest.description,
      actor: {
        ...manifest.actor,
        initialData,
        dataSchema,
      },
      widget: {
        ...manifest.widget,
        tool,
      },
    }

    const parsedManifest = ZVibecanvasJson.safeParse(nextManifest)
    if (!parsedManifest.success) {
      const manifestIssues = parsedManifest.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      return {
        ok: false,
        reason: 'manifest-invalid',
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

  #createActorCandidateFromManifest(previousCandidate: TActorCandidate, manifest: TVibecanvasJson): TActorCandidate {
    return {
      ...previousCandidate,
      slug: manifest.slug,
      name: manifest.name,
      description: manifest.description,
      actor: {
        ...previousCandidate.actor,
        ...manifest.actor,
      },
      widget: {
        ...previousCandidate.widget,
        tool: manifest.widget.tool,
      },
    }
  }

  #draftActorKey(id: TWidgetId, sessionId: TSessionId): TDraftActorKey {
    return `${id}:${sessionId}`;
  }

  #getWizardCwd(id: TWidgetId, sessionId: TSessionId): string {
    return join(this.#piAgentDir, 'widget-cwd', id + sessionId);
  }

  #resolveConfigPath(path: string): string {
    return isAbsolute(path) ? path : join(this.#config.configPath, path)
  }

  #shouldCopyPublishedWidgetFile(sourceDir: string, source: string): boolean {
    const relative = relativePath(sourceDir, source)
    if (relative.length === 0) return true

    const parts = relative.split(/[\\/]/)
    return !parts.some((part) => part === 'node_modules' || part === '.git' || part === '.vibecanvas-wizard')
  }

  async #listDraftFiles(rootDir: string): Promise<string[]> {
    const files: string[] = []
    await this.#listDraftFilesRecursive(rootDir, rootDir, files)
    return files
  }

  async #listDraftFilesRecursive(rootDir: string, dir: string, files: string[]): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const absPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        await this.#listDraftFilesRecursive(rootDir, absPath, files)
        continue
      }
      if (!entry.isFile()) continue

      files.push(relativePath(rootDir, absPath))
    }
  }

  async #createChatSessionEntry(id: TWidgetId, sessionId: TSessionId, sessionManager: SessionManager, previousSession?: AgentSession): Promise<TChatSessionEntry> {
    const cwd = this.#getWizardCwd(id, sessionId)
    const manifestResult = await this.#readDraftActorManifest(cwd)
    if (manifestResult.ready) {
      this.#ensureImplementationPhaseForDraftManifest(
        sessionManager,
        manifestResult.manifest,
        join(cwd, 'vibecanvas.json'),
        await this.#listDraftFiles(cwd),
        new Date().toISOString(),
      )
    }
    const phaseTools = createWidgetWizardPhaseTools({
      cwd,
      finalWidgetsDir: join(this.#config.configPath, 'widgets'),
      sessionManager,
      actorService: this.#config.actorService,
      onEvent: (event) => this.#publishToolEvent(id, sessionId, event),
    })
    const services = await createAgentSessionServices({
      cwd,
      agentDir: this.#piAgentDir,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      settingsManager: this.settingsManager,
      resourceLoaderOptions: {
        systemPrompt: WIDGET_CHAT_SYSTEM_PROMPT
      }
    });
    const { session } = await createAgentSessionFromServices({
      services,
      sessionManager,
      model: previousSession?.model,
      thinkingLevel: previousSession?.thinkingLevel,
      tools: this.#chatToolNames(phaseTools),
      customTools: phaseTools.customTools,
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

  #ensureImplementationPhaseForDraftManifest(sessionManager: SessionManager, manifest: TVibecanvasJson, manifestPath: string, files: string[], timestamp: string): void {
    if (!fxLatestActorCandidateApprovalRecord({ sessionManager })) {
      txAppendActorCandidateApprovalRecord({ sessionManager }, {
        candidateRevision: 0,
        manifest,
        files,
        approvedAt: timestamp,
      })
    }
    txAppendDraftManifestPathRecord({ sessionManager }, { manifestPath })
  }

  #flushSessionManager(sessionManager: SessionManager): void {
    const writableSessionManager = sessionManager as unknown as { _rewriteFile?: () => void }
    writableSessionManager._rewriteFile?.()
  }

  #chatToolNames(phaseTools: ReturnType<typeof createWidgetWizardPhaseTools>): string[] {
    return [...phaseTools.builtInTools, ...phaseTools.customTools.map(tool => tool.name)]
  }

  #publishToolEvent(id: TWidgetId, sessionId: TSessionId, event: TToolEvent): void {
    if (event.type !== 'widgetupdate') return

    this.#config.eventPublisherService.publishAgentEvent({
      kind: 'widgetupdate',
      widgetId: id,
      sessionId,
      cwd: event.cwd,
      files: event.files,
    })
  }

  #sameToolSet(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) return false

    const leftSet = new Set(left)
    return right.every((tool) => leftSet.has(tool))
  }

  async #refreshChatSessionToolsIfNeeded(id: TWidgetId, sessionId: TSessionId): Promise<void> {
    const sessionEntry = this.sessionMap[id]?.[sessionId]
    if (!sessionEntry || sessionEntry.session.isStreaming) return
    if (typeof sessionEntry.session.getActiveToolNames !== 'function') return

    const cwd = this.#getWizardCwd(id, sessionId)
    const phaseTools = createWidgetWizardPhaseTools({
      cwd,
      finalWidgetsDir: join(this.#config.configPath, 'widgets'),
      sessionManager: sessionEntry.sessionManager,
      actorService: this.#config.actorService,
    })
    const desiredTools = this.#chatToolNames(phaseTools)
    const activeTools = sessionEntry.session.getActiveToolNames()

    if (this.#sameToolSet(activeTools, desiredTools)) return

    const previousSession = sessionEntry.session
    const nextEntry = await this.#createChatSessionEntry(id, sessionId, sessionEntry.sessionManager, previousSession)

    sessionEntry.unsub()
    previousSession.dispose()
    this.sessionMap[id][sessionId] = nextEntry
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

  #disposeChatSession(id: TWidgetId, sessionId: TSessionId): void {
    this.#disposeDraftActor(id, sessionId)
    this.#disposeAgentSession(id, sessionId)
  }

  #claimDbChangeProposalResolution(id: TWidgetId, sessionId: TSessionId, proposalId: string): () => void {
    const key = JSON.stringify([id, sessionId, proposalId])
    if (this.#dbChangeProposalResolutions.has(key)) {
      throw new Error('Database change proposal is already being resolved.')
    }
    this.#dbChangeProposalResolutions.add(key)
    return () => { this.#dbChangeProposalResolutions.delete(key) }
  }

  #disposeAgentSession(id: TWidgetId, sessionId: TSessionId): void {
    const sessionEntry = this.sessionMap[id]?.[sessionId]
    if (!sessionEntry) return

    sessionEntry.unsub()
    delete this.sessionMap[id][sessionId]

    if (Object.keys(this.sessionMap[id]).length === 0) {
      delete this.sessionMap[id]
    }
  }

  #disposeDraftActor(id: TWidgetId, sessionId: TSessionId): void {
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

  #draftActorNotReady(id: TWidgetId, sessionId: TSessionId, reason: TDraftActorNotReadyReason): TAgentDraftActorNotReadyResult {
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

  #draftManifestMessage(id: TWidgetId, sessionId: TSessionId, reason: 'session-missing' | 'manifest-missing' | 'manifest-invalid'): string {
    const label = `widget '${id}' and session '${sessionId}'`
    const messageMap: Record<typeof reason, string> = {
      'manifest-missing': `Draft vibecanvas.json does not exist for ${label}`,
      'manifest-invalid': `Draft vibecanvas.json is invalid for ${label}`,
      'session-missing': `No connected agent session for ${label}`,
    }

    return messageMap[reason]
  }

  #publishDraftActorEvent(id: TWidgetId, sessionId: TSessionId, actor: Actor, event: TAgentDraftActorEvent['event']): void {
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
