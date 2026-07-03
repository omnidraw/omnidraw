import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import type { IServiceContext } from '@vibecanvas/runtime/interface.ts';
import type { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { readdir } from 'node:fs/promises';
import { dirname, join, relative as relativePath } from 'node:path';
import { AuthStorage, createAgentSession, createAgentSessionFromServices, createAgentSessionServices, DefaultResourceLoader, ModelRegistry, SessionManager, SettingsManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import { mkdirSync } from 'node:fs';

interface IPublicMethods {
  logout(providerId: string): void;
  setApiKey(providerId: string, key: string): void;
  removeApiKey(providerId: string): void;
}

interface IActorServiceConfig {
  cachePath: string;
  dataPath: string;
  eventPublisherService: IEventPublisherService,
}

type TWidgetId = string;
type TSessionId = string;
type TLoginId = string;
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
};
type TAgentCancelResult = {
  canceled: boolean;
  running: boolean;
};

export class AgentService implements IService, IStartableService, IStoppableService, IPublicMethods {
  name = 'agent-service'
  #config: IActorServiceConfig;
  #piAgentDir: string;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  settingsManager: SettingsManager;
  sessionMap: Record<TWidgetId, Record<TSessionId, {unsub: () => void, session: AgentSession, sessionManager: SessionManager}>> = {}
  #loginMap: Record<TLoginId, TLoginSession> = {}

  constructor(config: IActorServiceConfig) {
    this.#config = config
    this.#piAgentDir = join(config.dataPath, 'pi', 'agent')
    this.authStorage = AuthStorage.create(join(this.#piAgentDir, 'auth.json'))
    this.modelRegistry = ModelRegistry.create(this.authStorage, join(this.#piAgentDir, 'models.json'))
    this.settingsManager = SettingsManager.create(this.#piAgentDir, this.#piAgentDir, { projectTrusted: true })
  }

  async start(ctx: IServiceContext<object, object>): Promise<void> {
    console.log('start', this.name)
  }

  async stop(): Promise<void> {
    console.log('stop', this.name)
  }

  async connectWizzard(id: TWidgetId, sessionId: string): Promise<TAgentConnectResult> {
    const cwd = join(this.#piAgentDir, 'widget-cwd', id+sessionId)
    mkdirSync(cwd, {recursive: true})
    const sessionDir = join(this.#piAgentDir, 'sessions', sessionId)
    const sessionManager = SessionManager.continueRecent(cwd, sessionDir)
    const entry = sessionManager.getEntry('vibejsonpath')
    let vcJson: TVibecanvasJson | null = null;
    if(entry?.type === 'custom' && entry?.customType === 'vibejsonpath' && typeof entry.data === 'string') {
      try {
        vcJson = await Bun.file(entry.data).json()
      } catch {}
    }

    const services = await createAgentSessionServices({ cwd, agentDir: this.#piAgentDir, authStorage: this.authStorage, modelRegistry: this.modelRegistry, settingsManager: this.settingsManager });
    const loader = new DefaultResourceLoader({
      agentDir: this.#piAgentDir,
      cwd,
      systemPrompt: 'You help to build new widgets.'
    });
    const {session} = await createAgentSessionFromServices({services, sessionManager})
    const messageHistory = session.messages
    const unsub = session.subscribe((event) => {
      this.#config.eventPublisherService.publishAgentEvent({
        widgetId: id,
        sessionId,
        event,
      })
    })
    if(!this.sessionMap[id]) {
      this.sessionMap[id] = {}
    }

    this.sessionMap[id][sessionId] = {session, sessionManager, unsub}

    return {
      vcJson,
      messageHistory,
    }
  }

  async promptWizzard(id: TWidgetId, sessionId: string, text: string): Promise<void> {
    const session = this.sessionMap[id]?.[sessionId]?.session
    if (!session) {
      throw new Error(`No connected agent session for widget '${id}' and session '${sessionId}'`)
    }

    await session.prompt(text)
  }

  async cancelWizzard(id: TWidgetId, sessionId: string): Promise<TAgentCancelResult> {
    const session = this.sessionMap[id]?.[sessionId]?.session
    if (!session || !session.isStreaming) {
      return { canceled: false, running: false }
    }

    await session.abort()

    return { canceled: true, running: session.isStreaming }
  }

  login(providerId: 'openai-codex' | 'github-copilot') {
    const loginId = crypto.randomUUID()
    const controller = new AbortController()
    const session: TLoginSession = { controller, status: { status: 'pending' } }
    this.#loginMap[loginId] = session

    void this.authStorage.login(providerId, {
      onAuth(info) { },
      onDeviceCode(info) {
        session.status = {
          status: 'device-code',
          userCode: info.userCode,
          verificationUri: info.verificationUri,
          intervalSeconds: info.intervalSeconds,
          expiresInSeconds: info.expiresInSeconds,
        }
      },
      async onPrompt(prompt) { return '' },
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

}
