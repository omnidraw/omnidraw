import type { IAutomergeService } from '@vibecanvas/service-automerge/IAutomergeService';
import type { IDbService } from '@vibecanvas/service-db/IDbService';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';

type TCanvasApiContext = {
  accountId?: string;
  db: IDbService;
  eventPublisher: IEventPublisherService;
  automerge: IAutomergeService;
  requestId?: string;
};

export type { TCanvasApiContext };
