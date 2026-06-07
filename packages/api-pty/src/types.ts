import type { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import type { IPtyService } from '@vibecanvas/service-pty/IPtyService';

type TPtyApiContext = {
  accountId?: string;
  db: DbServiceTurso;
  pty: IPtyService;
  requestId?: string;
};

export type { TPtyApiContext };
