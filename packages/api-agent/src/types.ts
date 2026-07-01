import type { AgentService } from '@vibecanvas/service-agent';
import type { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';

export type TAgentApiContext = {
  db: DbServiceTurso;
  eventPublisher: IEventPublisherService;
  agent: AgentService;
  accountId?: string;
  requestId?: string;
};
