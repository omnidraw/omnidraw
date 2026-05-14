import type { IDbService } from '@vibecanvas/service-db/IDbService';
import type { IPtyService } from '@vibecanvas/service-pty/IPtyService';

type TPtyApiContext = {
  accountId?: string;
  db: IDbService;
  pty: IPtyService;
  requestId?: string;
};

export type { TPtyApiContext };
