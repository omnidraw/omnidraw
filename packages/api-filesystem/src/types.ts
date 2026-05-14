import type { IDbService } from '@vibecanvas/service-db/IDbService';
import type { IFilesystemService } from '@vibecanvas/service-filesystem/IFilesystemService';

type TFilesystemApiContext = {
  accountId?: string;
  db: IDbService;
  filesystem: IFilesystemService;
  requestId?: string;
};

export type { TFilesystemApiContext };
