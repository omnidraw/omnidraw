import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import type { IServiceContext } from '@vibecanvas/runtime/interface.ts';
import type { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { readdir } from 'node:fs/promises';
import { dirname, join, relative as relativePath } from 'node:path';
import { AuthStorage, createAgentSession, ModelRegistry, SessionManager } from "@earendil-works/pi-coding-agent";

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

  constructor(config: IActorServiceConfig) {
    this.#config = config
    this.#piAgentPath = join(config.dataPath, 'pi')
    this.authStorage = AuthStorage.create(join(this.#piAgentPath, 'auth.json'))
    this.authStorage.list

  }

  async start(ctx: IServiceContext<object, object>): Promise<void> {
    console.log('start', this.name)
  }

  async stop(): Promise<void> {
    console.log('stop', this.name)
  }


}
