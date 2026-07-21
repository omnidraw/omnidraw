import type { TToolGroupDatabaseCapability } from "../interface";

export type TToolApiContext = {
  accountId?: string;
  db: TToolGroupDatabaseCapability;
  requestId?: string;
};
