import type { TPtyApiContext } from '../types';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import { fxResolveFilesystemId as fxResolveRegisteredFilesystemId } from '../../filesystem/core/fx.resolve-filesystem-id';

type TPortalFilesystemId = {
  db: TPtyApiContext['db'];
};

type TArgsFilesystemId = {
  tenant: TTenantContext;
  filesystemId?: string;
};

export async function fxResolveFilesystemId(portal: TPortalFilesystemId, args: TArgsFilesystemId): Promise<string | null> {
  return fxResolveRegisteredFilesystemId(portal, args);
}
