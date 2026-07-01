import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import type { IServiceContext } from '@vibecanvas/runtime/interface.ts';
import type { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';

interface IPublicMethods {
}

interface IKvServiceConfig {
  db: DbServiceTurso;
}

export class KvService implements IService, IStartableService, IStoppableService, IPublicMethods {
  name = 'kv-service'
  #db: DbServiceTurso;

  constructor(config: IKvServiceConfig) {
    this.#db = config.db
  }

  async start(ctx: IServiceContext<object, object>): Promise<void> {
    console.log('start', this.name)
  }

  async stop(): Promise<void> {
    console.log('stop', this.name)
  }


}
