import { ORPCError } from '@orpc/server';
import { fxResolveFilesystemId } from './core/fx.resolve-filesystem-id';
import { baseFilesystemOs } from './orpc';

const apiUnwatchFilesystem = baseFilesystemOs.unwatch.handler(async ({ input, context }) => {
  const filesystemId = await fxResolveFilesystemId({ accountId: context.accountId, db: context.db }, { filesystemId: input.filesystemId });
  if (!filesystemId) throw new ORPCError('NOT_FOUND', { message: 'No local filesystem registered' });
  context.filesystem.unwatch(filesystemId, input.watchId);
});

export { apiUnwatchFilesystem };
