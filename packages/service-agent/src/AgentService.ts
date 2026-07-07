import { AuthStorage, createAgentSessionFromServices, createAgentSessionServices, ModelRegistry, SessionManager, SettingsManager, type AgentSession } from '@earendil-works/pi-coding-agent';
import { Actor, type TActorEvent } from '@vibecanvas/service-actor/Actor';
import type { TActorData, TActorState, TJsonSchema, TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import { ZActorData, ZJsonSchema, ZVibecanvasJson } from '@vibecanvas/service-actor/core/vibecanvasjson.zod';
import type { IEventPublisherService, TAgentDraftActorEvent } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import type { IServiceContext } from '@vibecanvas/runtime/interface.ts';
import { mkdirSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative as relativePath, resolve } from 'node:path';
import { fxLatestActorCandidateRecord } from './core/fx.session-candidate';
import { txPublishWidgetDraft } from './core/tx.publish-widget-draft';
import { WIDGET_WIZZARD_SYSTEM_PROMPT } from './systemprompts';
import { fnCreateWidgetWizardPhaseTools } from './tools/fn.phase-tools';
import type { TActorCandidateRecord, TActorServiceReloader } from './tools/types';

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
};
type TAgentCancelResult = {
  canceled: boolean;
  running: boolean;
};
type TWizzardSessionEntry = {
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
    icon?: string | null;
    group?: string | null;
    priority?: number | null;
  };
};

type TAgentDraftManifestPatchResult =
  | { ok: true; manifest: TVibecanvasJson }
  | { ok: false; reason: 'session-missing' | 'manifest-missing' | 'manifest-invalid' | 'edit-invalid'; message: string; issues?: string[] };

type TAgentWizzardPublishResult =
  | { published: true; manifest: TVibecanvasJson; destination: string; files: string[] }
  | { published: false; manifest: TVibecanvasJson | null; destination: null; message: string; errors?: string[]; warnings?: string[] };

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
  sessionMap: Record<TWidgetId, Record<TSessionId, TWizzardSessionEntry>> = {}
  #loginMap: Record<TLoginId, TLoginSession> = {}
  #draftActorMap = new Map<TDraftActorKey, TDraftActorEntry>();

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
        this.#disposeWizzardSession(id, sessionId)
      }
    }
    this.#disposeAllDraftActors()
    console.log('stop', this.name)
  }

  async connectWizzard(id: TWidgetId, sessionId: string): Promise<TAgentConnectResult> {
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

    const sessionEntry = await this.#createWizzardSessionEntry(id, sessionId, sessionManager)
    const actorCandidate = fxLatestActorCandidateRecord({ sessionManager })
    if (!this.sessionMap[id]) {
      this.sessionMap[id] = {}
    }

    this.sessionMap[id][sessionId] = sessionEntry

    return {
      vcJson,
      actorCandidate,
      messageHistory: sessionEntry.session.messages,
    }
  }

  newWizzardSession(id: TWidgetId, sessionId: string): void {
    this.#disposeWizzardSession(id, sessionId)
  }

  async promptWizzard(id: TWidgetId, sessionId: string, text: string, promptSelection?: TPromptSelection): Promise<void> {
    await this.#refreshWizzardSessionToolsIfNeeded(id, sessionId)

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

  async cancelWizzard(id: TWidgetId, sessionId: string): Promise<TAgentCancelResult> {
    const session = this.sessionMap[id]?.[sessionId]?.session
    if (!session || !session.isStreaming) {
      return { canceled: false, running: false }
    }

    await session.abort()

    return { canceled: true, running: session.isStreaming }
  }

  inspectDraftActorWizzard(id: TWidgetId, sessionId: string): TAgentDraftActorResult {
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

  async startDraftActorWizzard(id: TWidgetId, sessionId: string): Promise<TAgentDraftActorResult> {
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

    const actor = new Actor({
      id: `draft:${id}:${sessionId}`,
      vsJson: manifestResult.manifest,
      rootDir,
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

  async reloadDraftActorWizzard(id: TWidgetId, sessionId: string): Promise<TAgentDraftActorResult> {
    return this.startDraftActorWizzard(id, sessionId)
  }

  async resetDraftActorWizzard(id: TWidgetId, sessionId: string): Promise<TAgentDraftActorResult> {
    return this.startDraftActorWizzard(id, sessionId)
  }

  stopDraftActorWizzard(id: TWidgetId, sessionId: string): TAgentDraftActorStopResult {
    const key = this.#draftActorKey(id, sessionId)
    const stopped = this.#draftActorMap.has(key)

    this.#disposeDraftActor(id, sessionId)

    return { stopped }
  }

  sendDraftActorWizzard(id: TWidgetId, sessionId: string, name: string, payload: unknown): TAgentDraftActorSendResult {
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

  async previewSourceWizzard(id: TWidgetId, sessionId: string): Promise<TAgentPreviewSourceResult> {
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

  async readDraftManifestWizzard(id: TWidgetId, sessionId: string): Promise<TAgentDraftManifestReadResult> {
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

  async patchDraftManifestWizzard(id: TWidgetId, sessionId: string, patch: TAgentDraftManifestPatch): Promise<TAgentDraftManifestPatchResult> {
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

    const currentCandidate = await this.#readDraftActorManifest(this.#getWizardCwd(id, sessionId))
    if (!currentCandidate.ready && currentCandidate.reason === 'manifest-missing') {
      const candidate = fxLatestActorCandidateRecord({ sessionManager: sessionEntry.sessionManager })
      if (!candidate) {
        return {
          ok: false,
          reason: currentCandidate.reason === 'session-missing' ? 'session-missing' : currentCandidate.reason === 'manifest-missing' ? 'manifest-missing' : 'manifest-invalid',
          message: currentCandidate.reason === 'manifest-missing' ? 'Draft vibecanvas.json does not exist yet. Candidate must exist and can be edited before publish.' : currentCandidate.message,
        }
      }

      const editResult = this.#applyDraftManifestPatch(candidate.manifest, patch)
      if (!editResult.ok) return editResult

      const manifestPath = join(this.#getWizardCwd(id, sessionId), 'vibecanvas.json')
      await writeFile(manifestPath, `${JSON.stringify(editResult.manifest, null, 2)}\n`, 'utf8')

      return editResult
    }
    if (!currentCandidate.ready) {
      return {
        ok: false,
        reason: currentCandidate.reason === 'session-missing' ? 'session-missing' : currentCandidate.reason === 'manifest-missing' ? 'manifest-missing' : 'manifest-invalid',
        message: currentCandidate.message,
      }
    }

    const editResult = this.#applyDraftManifestPatch(currentCandidate.manifest, patch)
    if (!editResult.ok) return editResult

    const manifestPath = join(this.#getWizardCwd(id, sessionId), 'vibecanvas.json')
    await writeFile(manifestPath, `${JSON.stringify(editResult.manifest, null, 2)}\n`, 'utf8')

    return editResult
  }

  async publishWizzard(id: TWidgetId, sessionId: string): Promise<TAgentWizzardPublishResult> {
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

    const result = await txPublishWidgetDraft({ readdir, readFile, mkdir, rm, cp, join, relative: relativePath, resolve, basename }, {
      cwd: rootDir,
      finalWidgetsDir: join(this.#config.configPath, 'widgets'),
      actorService: this.#config.actorService,
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
    if (!result.destination) {
      return {
        published: false,
        manifest: result.manifest,
        destination: null,
        message: 'Widget publish completed without a destination path.',
      }
    }

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
    const defaultThinkingLevel = this.settingsManager.getDefaultThinkingLevel()
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
        } else if (typeof patch.tool.icon !== 'string') {
          issues.push('widget.tool.icon: expected a string')
        } else {
          tool = {
            ...tool,
            icon: patch.tool.icon,
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
      manifest: parsedManifest.data as TVibecanvasJson,
    }
  }

  #draftActorKey(id: TWidgetId, sessionId: TSessionId): TDraftActorKey {
    return `${id}:${sessionId}`;
  }

  #getWizardCwd(id: TWidgetId, sessionId: TSessionId): string {
    return join(this.#piAgentDir, 'widget-cwd', id + sessionId);
  }

  async #createWizzardSessionEntry(id: TWidgetId, sessionId: TSessionId, sessionManager: SessionManager, previousSession?: AgentSession): Promise<TWizzardSessionEntry> {
    const cwd = this.#getWizardCwd(id, sessionId)
    const phaseTools = fnCreateWidgetWizardPhaseTools({
      cwd,
      finalWidgetsDir: join(this.#config.configPath, 'widgets'),
      sessionManager,
      actorService: this.#config.actorService,
    })
    const services = await createAgentSessionServices({
      cwd,
      agentDir: this.#piAgentDir,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      settingsManager: this.settingsManager,
      resourceLoaderOptions: {
        systemPrompt: WIDGET_WIZZARD_SYSTEM_PROMPT
      }
    });
    const { session } = await createAgentSessionFromServices({
      services,
      sessionManager,
      model: previousSession?.model,
      thinkingLevel: previousSession?.thinkingLevel,
      tools: this.#wizzardToolNames(phaseTools),
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

  #wizzardToolNames(phaseTools: ReturnType<typeof fnCreateWidgetWizardPhaseTools>): string[] {
    return [...phaseTools.builtInTools, ...phaseTools.customTools.map(tool => tool.name)]
  }

  #sameToolSet(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) return false

    const leftSet = new Set(left)
    return right.every((tool) => leftSet.has(tool))
  }

  async #refreshWizzardSessionToolsIfNeeded(id: TWidgetId, sessionId: TSessionId): Promise<void> {
    const sessionEntry = this.sessionMap[id]?.[sessionId]
    if (!sessionEntry || sessionEntry.session.isStreaming) return
    if (typeof sessionEntry.session.getActiveToolNames !== 'function') return

    const cwd = this.#getWizardCwd(id, sessionId)
    const phaseTools = fnCreateWidgetWizardPhaseTools({
      cwd,
      finalWidgetsDir: join(this.#config.configPath, 'widgets'),
      sessionManager: sessionEntry.sessionManager,
      actorService: this.#config.actorService,
    })
    const desiredTools = this.#wizzardToolNames(phaseTools)
    const activeTools = sessionEntry.session.getActiveToolNames()

    if (this.#sameToolSet(activeTools, desiredTools)) return

    const previousSession = sessionEntry.session
    const nextEntry = await this.#createWizzardSessionEntry(id, sessionId, sessionEntry.sessionManager, previousSession)

    sessionEntry.unsub()
    previousSession.dispose()
    this.sessionMap[id][sessionId] = nextEntry
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

  #disposeWizzardSession(id: TWidgetId, sessionId: TSessionId): void {
    this.#disposeDraftActor(id, sessionId)
    this.#disposeAgentSession(id, sessionId)
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
