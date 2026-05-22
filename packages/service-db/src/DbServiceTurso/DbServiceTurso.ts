import type { IService, IStartableService, IStoppableService } from "@vibecanvas/runtime";

export class DbServiceTurso implements IService, IStartableService, IStoppableService {
  name = 'DbServiceTurso'

  async start(): Promise<void> {
    console.log('DbServiceTurso started')
  }

  async stop(): Promise<void> {
    console.log('DbServiceTurso stopped')
  }
}
