import type { TPtyApiContext } from '../types';

type TPortalFilesystemId = {
  accountId?: TPtyApiContext['accountId'];
  db: TPtyApiContext['db'];
};

type TArgsFilesystemId = {
  filesystemId?: string;
};

export function fxResolveFilesystemId(portal: TPortalFilesystemId, args: TArgsFilesystemId): string | null {
  if (args.filesystemId) return args.filesystemId;

  const local = portal.db.filesystem.listAll({ accountId: portal.accountId }).find((entry) => entry.kind === 'local');
  if (local) return local.id;

  return null;
}
