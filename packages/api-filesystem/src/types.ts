import type { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import type { IFilesystemService } from '@vibecanvas/service-filesystem/IFilesystemService';

type TFilesystemApiContext = {
  accountId?: string;
  db: DbServiceTurso;
  filesystem: IFilesystemService;
  requestId?: string;
};

export type { TFilesystemApiContext };
