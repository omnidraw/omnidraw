import type { TFileDatabaseCapability } from '../interface';

type TFileApiContext = {
  db: TFileDatabaseCapability;
  requestId?: string;
};

export type { TFileApiContext };
