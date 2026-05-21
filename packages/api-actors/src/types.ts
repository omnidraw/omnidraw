import type { ActorService } from '@vibecanvas/service-actor';
import type { ActorDb } from '@vibecanvas/service-db/ActorDb';
import type { IDbService } from '@vibecanvas/service-db/IDbService';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';

export type TActorsDbService = IDbService & { actor: ActorDb };

export type TActorsApiContext = {
  db: IDbService;
  eventPublisher: IEventPublisherService;
  actor?: ActorService;
  accountId?: string;
  requestId?: string;
};
