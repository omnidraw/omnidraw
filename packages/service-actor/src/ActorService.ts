import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import type { IServiceContext } from '@vibecanvas/runtime/interface.ts';
import type { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import { ActorSupervisor } from './ActorSupervisor';
import type { TVibecanvasJson } from './core/types';
import { txGetWidgetCode } from './core/tx.actor-definitions';
import { readdir } from 'node:fs/promises';
import { dirname, join, relative as relativePath } from 'node:path';

interface IPublicMethods {
  sendMessage(msg: any): Promise<void>
  createInstance(defId: string): Promise<void>
  removeInstance(instanceId: string): Promise<void>
  getVibecanvasJson(defId: string): TVibecanvasJson | null;
  getWidgetCode(defId: string): Promise<{content: string, path: string}[] | null>
}

interface IActorServiceConfig {
  db: DbServiceTurso;
  configPath: string;
}

export class ActorService implements IService, IStartableService, IStoppableService, IPublicMethods {
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

  async createInstance(defId: string): Promise<void> {
      throw "TODO: implement"
  }

  async removeInstance(instanceId: string): Promise<void> {
      throw "TODO: implement"
  }

  async sendMessage(msg: any): Promise<void> {
      throw "TODO: implement"
  }

  getVibecanvasJson(defName: string) {
    return this.#supervisor.vibecanvasDefMap[defName] ?? null
  }

  async getWidgetCode(defName: string): Promise<{ content: string; path: string; }[] | null> {
    const vcJson = this.getVibecanvasJson(defName)
    if (vcJson === null) return null
    const widgetDir = join(dirname(vcJson.manifest_path), vcJson.widget.widgetDir)

    return txGetWidgetCode({Bun, readdir, join, relative: relativePath}, {widgetDir})
  }

}
