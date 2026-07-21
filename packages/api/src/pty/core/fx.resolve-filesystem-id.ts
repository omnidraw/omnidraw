import type { TPtyApiContext } from '../types';

type TPortalFilesystemId = {
  accountId?: TPtyApiContext['accountId'];
};

type TArgsFilesystemId = {
  filesystemId?: string;
};

export async function fxResolveFilesystemId(portal: TPortalFilesystemId, args: TArgsFilesystemId): Promise<string | null> {
  if (args.filesystemId) return args.filesystemId;

  return 'TODO: currently filesystem id should be not used and ignored. So even this string will work.';
}
