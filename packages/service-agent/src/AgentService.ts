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

export class AgentService implements IService, IStartableService, IStoppableService, IPublicMethods {
  name = 'agent-service'
  #config: IActorServiceConfig;
  #piAgentPath: string;
  authStorage: AuthStorage;
  models: ModelRegistry;
  settingsManager: SettingsManager;

  constructor(config: IActorServiceConfig) {
    this.#config = config
    this.#piAgentPath = join(config.dataPath, 'pi')
    this.authStorage = AuthStorage.create(join(this.#piAgentPath, 'auth.json'))
    this.models = ModelRegistry.create(this.authStorage, join(this.#piAgentPath, 'models.json'))
    this.settingsManager = SettingsManager.create(this.#piAgentPath, undefined, {projectTrusted: true})
    // const session = await createAgentSession({
    //   // s
    // })

  }

  async start(ctx: IServiceContext<object, object>): Promise<void> {
    console.log('start', this.name)
  }

  async stop(): Promise<void> {
    console.log('stop', this.name)
  }

  async settings() {
    const defaultModel = this.settingsManager.getDefaultModel()
    const defaultProvider = this.settingsManager.getDefaultProvider()
    const defaultThinkingLevel = this.settingsManager.getDefaultThinkingLevel()
    const providersWithCredentials = this.authStorage.list()
    const providers = new Set(this.models.getAll().map(m => m.provider)).entries().toArray()
    const models = this.models.getAvailable().map(m => ({id: m.id, input: m.input, provider: m.provider, name: m.name}))

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
