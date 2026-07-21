import type { IPtyService } from '@vibecanvas/service-pty/IPtyService';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type { TFilesystemDatabaseCapability } from '../interface';
import type { TFilesystemApiCapability } from '../filesystem/types';

type TPtyApiCapability = Pick<IPtyService, 'create' | 'get' | 'list' | 'remove' | 'update'>;

type TPtyApiContext = {
  db: TFilesystemDatabaseCapability;
  filesystem: Pick<TFilesystemApiCapability, 'resolveHostPath'>;
  pty: TPtyApiCapability;
  tenant: TTenantContext;
};

export type { TPtyApiCapability, TPtyApiContext };
