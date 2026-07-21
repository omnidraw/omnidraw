import type { IFilesystemService } from '@vibecanvas/service-filesystem/IFilesystemService';
import type { TFilesystemDatabaseCapability } from '../interface';

type TFilesystemApiCapability = Pick<
  IFilesystemService,
  'exists' | 'homeDir' | 'keepalive' | 'readFile' | 'readdir' | 'rename' | 'stat' | 'unwatch' | 'watch' | 'writeFile'
>;

type TFilesystemApiContext = {
  accountId?: string;
  db: TFilesystemDatabaseCapability;
  filesystem: TFilesystemApiCapability;
  requestId?: string;
};

export type { TFilesystemApiCapability, TFilesystemApiContext };
