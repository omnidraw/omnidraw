import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import type { IServiceContext } from '@vibecanvas/runtime/interface.ts';
import type { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import { ActorSupervisor } from './ActorSupervisor';

interface IPublicMethods {
  sendMessage(msg: any): Promise<void>
  createInstance(defId: string): Promise<void>
  removeInstance(instanceId: string): Promise<void>
}

interface IActorServiceConfig {
  db: DbServiceTurso;
  configPath: string;
}

export class ActorService implements IService, IStartableService, IStoppableService {
  name = 'actor-service'
  #config: IActorServiceConfig
  #supervisor: ActorSupervisor

  constructor(config: IActorServiceConfig) {
    this.#config = config
    this.#supervisor = new ActorSupervisor(config)
  }

  async start(ctx: IServiceContext<object, object>): Promise<void> {
    console.log('start', this.name)
    await this.#supervisor.init()
  }

  async stop(): Promise<void> {
    console.log('stop', this.name)
  }

}
