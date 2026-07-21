import { ORPCError } from '@orpc/server';
import { fxResolveFilesystemId } from './core/fx.resolve-filesystem-id';
import { fnToApiFilesystemError } from './core/fn.to-api-filesystem-error';
import { baseFilesystemOs } from './orpc';

const apiHomeFilesystem = baseFilesystemOs.home.handler(async ({ input, context }) => {
  const filesystemId = await fxResolveFilesystemId({ db: context.db }, { tenant: context.tenant, filesystemId: input?.filesystemId });
  if (!filesystemId) throw new ORPCError('NOT_FOUND', { message: 'No local filesystem registered' });
  const path = context.filesystem.homeDir(context.tenant, { filesystemId });
  if (path === null) return fnToApiFilesystemError(null, 'Failed to get home directory');
  const result = { path };
  return result;
});

export { apiHomeFilesystem };
