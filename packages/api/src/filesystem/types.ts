import type { IFilesystemService } from '@vibecanvas/service-filesystem/IFilesystemService';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type { TFilesystemDatabaseCapability } from '../interface';

type TFilesystemApiCapability = Pick<
  IFilesystemService,
  'exists' | 'homeDir' | 'keepalive' | 'readFile' | 'readdir' | 'rename' | 'resolveHostPath' | 'stat' | 'unwatch' | 'watch' | 'writeFile'
>;

type TFilesystemApiContext = {
  db: TFilesystemDatabaseCapability;
  filesystem: TFilesystemApiCapability;
  tenant: TTenantContext;
};

export type { TFilesystemApiCapability, TFilesystemApiContext };
