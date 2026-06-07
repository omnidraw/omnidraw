import type { TFilesystemApiContext } from '../types';

type TPortalFilesystemId = {
  accountId?: TFilesystemApiContext['accountId'];
  db: TFilesystemApiContext['db'];
};

type TArgsFilesystemId = {
  filesystemId?: string;
};

export async function fxResolveFilesystemId(portal: TPortalFilesystemId, args: TArgsFilesystemId): Promise<string | null> {
  if (args.filesystemId) return args.filesystemId;

  const local = (await portal.db.filesystem.listAll({ accountId: portal.accountId })).find((entry) => entry.kind === 'local');
  if (local) return local.id;

  return null;
}
