import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import type { IServiceContext } from 'packages/runtime/src/interface';


interface IPublicMethods {
  sendMessage(msg: any): Promise<void>
  createInstance(defId: string): Promise<void>
  removeInstance(instanceId: string): Promise<void>
}

export class ActorService implements IService, IStartableService, IStoppableService {
  name = 'actor-service'

  start(ctx: IServiceContext<object, object>): void | Promise<void> {
    console.log('start', this.name)
  }

  stop(): void | Promise<void> {
    console.log('stop', this.name)
  }

}
