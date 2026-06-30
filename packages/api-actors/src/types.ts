import type { ActorService } from '@vibecanvas/service-actor';
import type { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';

export type TActorsApiContext = {
  db: DbServiceTurso;
  eventPublisher: IEventPublisherService;
  actor: ActorService;
  accountId?: string;
  requestId?: string;
};
