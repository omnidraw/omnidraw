import type { TFileDatabaseCapability } from '../interface';
import type { TTenantContext } from '@vibecanvas/tenant-core';

type TFileApiContext = {
  db: TFileDatabaseCapability;
  tenant: TTenantContext;
};

export type { TFileApiContext };
