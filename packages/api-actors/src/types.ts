import type { ActorService } from '@vibecanvas/service-actor';
import type { ActorDb } from '@vibecanvas/service-db/ActorDb';
import type { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';

export type TActorsDbService = DbServiceTurso & { actor: ActorDb };

export type TActorsApiContext = {
  db: DbServiceTurso;
  eventPublisher: IEventPublisherService;
  actor: ActorService;
  accountId?: string;
  requestId?: string;
};
