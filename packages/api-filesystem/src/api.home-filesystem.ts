import { ORPCError } from '@orpc/server';
import { fxResolveFilesystemId } from './core/fx.resolve-filesystem-id';
import { fnToApiFilesystemError } from './core/fn.to-api-filesystem-error';
import { baseFilesystemOs } from './orpc';

const apiHomeFilesystem = baseFilesystemOs.home.handler(async ({ input, context }) => {
  const filesystemId = await fxResolveFilesystemId({ accountId: context.accountId, db: context.db }, { filesystemId: input?.filesystemId });
  if (!filesystemId) throw new ORPCError('NOT_FOUND', { message: 'No local filesystem registered' });
  const result = { path: context.filesystem.homeDir(filesystemId) };
  if (!result.path) return fnToApiFilesystemError(null, 'Failed to get home directory');
  return result;
});

export { apiHomeFilesystem };
