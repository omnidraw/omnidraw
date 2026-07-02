import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import type { IServiceContext } from '@vibecanvas/runtime/interface.ts';
import type { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { readdir } from 'node:fs/promises';
import { dirname, join, relative as relativePath } from 'node:path';
import { AuthStorage, createAgentSession, ModelRegistry, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

interface IPublicMethods {
  logout(providerId: string): void;
  setApiKey(providerId: string, key: string): void;
  removeApiKey(providerId: string): void;
}

interface IActorServiceConfig {
  dataPath: string;
  eventPublisherService: IEventPublisherService,
}

type TWidgetId = string;
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

export class AgentService implements IService, IStartableService, IStoppableService, IPublicMethods {
  name = 'agent-service'
  #config: IActorServiceConfig;
  #piAgentPath: string;
  authStorage: AuthStorage;
  models: ModelRegistry;
  settingsManager: SettingsManager;
  sessionMap: Record<TWidgetId, SessionManager> = {}
  #loginMap: Record<TLoginId, TLoginSession> = {}

  constructor(config: IActorServiceConfig) {
    this.#config = config
    this.#piAgentPath = join(config.dataPath, 'pi')
    this.authStorage = AuthStorage.create(join(this.#piAgentPath, 'auth.json'))
    this.models = ModelRegistry.create(this.authStorage, join(this.#piAgentPath, 'models.json'))
    this.settingsManager = SettingsManager.create(this.#piAgentPath, undefined, { projectTrusted: true })
  }

  async start(ctx: IServiceContext<object, object>): Promise<void> {
    console.log('start', this.name)
  }

  async stop(): Promise<void> {
    console.log('stop', this.name)
  }

  async connect(id: TWidgetId) {
    const session = SessionManager.continueRecent(join(this.#piAgentPath, 'widget', id))
    this.sessionMap[id] = session
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
    const providers = Array.from(new Set(this.models.getAll().map(m => m.provider)))
    const models = this.models.getAvailable().map(m => ({ id: m.id, input: m.input, provider: m.provider, name: m.name }))

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
