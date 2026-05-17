import type { ActorService } from '@vibecanvas/service-actor';
import type { TDrizzleDb } from '@vibecanvas/service-db/DbServiceBunSqlite/index';
import type { IDbService } from '@vibecanvas/service-db/IDbService';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';

export type TActorsDbService = IDbService & { drizzle: TDrizzleDb };

export type TActorsApiContext = {
  db: IDbService;
  eventPublisher: IEventPublisherService;
  actor?: ActorService;
  accountId?: string;
  requestId?: string;
};
