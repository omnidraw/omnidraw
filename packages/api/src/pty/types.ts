import type { IPtyService } from '@vibecanvas/service-pty/IPtyService';

type TPtyApiCapability = Pick<IPtyService, 'create' | 'get' | 'list' | 'remove' | 'update'>;

type TPtyApiContext = {
  accountId?: string;
  pty: TPtyApiCapability;
  requestId?: string;
};

export type { TPtyApiCapability, TPtyApiContext };
