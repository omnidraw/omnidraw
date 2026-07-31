import type { TFileDatabaseCapability } from '../interface';
import type { TTenantContext } from '@omnidraw/tenant-core';

type TFileApiContext = {
  db: TFileDatabaseCapability;
  tenant: TTenantContext;
};

export type { TFileApiContext };
