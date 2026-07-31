import type { TToolGroupDatabaseCapability } from "../interface";
import type { TTenantContext } from '@omnidraw/tenant-core';

export type TToolApiContext = {
  db: TToolGroupDatabaseCapability;
  tenant: TTenantContext;
};
