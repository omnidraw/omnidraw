import type { TFilesystemApiContext } from '../types';
import type { TTenantContext } from '@vibecanvas/tenant-core';

type TPortalFilesystemId = {
  db: TFilesystemApiContext['db'];
};

type TArgsFilesystemId = {
  tenant: TTenantContext;
  filesystemId?: string;
};

export async function fxResolveFilesystemId(portal: TPortalFilesystemId, args: TArgsFilesystemId): Promise<string | null> {
  const filesystems = await portal.db.filesystem.listAll(args.tenant);
  if (args.filesystemId) {
    return filesystems.some((filesystem) => filesystem.id === args.filesystemId)
      ? args.filesystemId
      : null;
  }

  const local = filesystems[0];
  if (local) return local.id;

  return null;
}
