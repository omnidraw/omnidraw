import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import type { IServiceContext } from '@vibecanvas/runtime/interface.ts';
import type { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { readdir } from 'node:fs/promises';
import { dirname, join, relative as relativePath } from 'node:path';
import { AuthStorage, createAgentSession, ModelRegistry, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

interface IPublicMethods {
}

interface IActorServiceConfig {
  dataPath: string;
  eventPublisherService: IEventPublisherService,
}

type TWidgetId = string;
type TLoginId = string;

export class AgentService implements IService, IStartableService, IStoppableService, IPublicMethods {
  name = 'agent-service'
  #config: IActorServiceConfig;
  #piAgentPath: string;
  authStorage: AuthStorage;
  models: ModelRegistry;
  settingsManager: SettingsManager;
  sessionMap: Record<TWidgetId, SessionManager> = {}
  #loginMap: Record<TLoginId, AbortController> = {}

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
    const signal = controller.signal
    this.authStorage.login(providerId, {
      onAuth(info) { },
      onDeviceCode(info) {
        console.log(info)

      },
      async onPrompt(prompt) { return '' },
      async onSelect(prompt) {
        if (providerId === 'github-copilot') return undefined
        else return ""
      },
      onProgress(message) {
        console.log(message)
      },
      signal
    })

    this.#loginMap[loginId] = controller

    return loginId
  }

  abortLogin(loginId: TLoginId) {
    const controller = this.#loginMap[loginId]
    if(controller) {
      controller.abort()
      delete this.#loginMap[loginId]
    }
  }

  async settings() {
    const defaultModel = this.settingsManager.getDefaultModel()
    const defaultProvider = this.settingsManager.getDefaultProvider()
    const defaultThinkingLevel = this.settingsManager.getDefaultThinkingLevel()
    const providersWithCredentials = this.authStorage.list()
    const providers = new Set(this.models.getAll().map(m => m.provider)).entries().toArray()
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
