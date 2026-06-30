import type { IAutomergeService } from '@vibecanvas/service-automerge/IAutomergeService';
import type { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';

type TCanvasApiContext = {
  accountId?: string;
  db: DbServiceTurso;
  eventPublisher: IEventPublisherService;
  automerge: IAutomergeService;
  requestId?: string;
};

export type { TCanvasApiContext };
