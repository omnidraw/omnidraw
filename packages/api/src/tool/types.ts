import type { TToolGroupDatabaseCapability } from "../interface";
import type { TTenantContext } from '@vibecanvas/tenant-core';

export type TToolApiContext = {
  db: TToolGroupDatabaseCapability;
  tenant: TTenantContext;
};
