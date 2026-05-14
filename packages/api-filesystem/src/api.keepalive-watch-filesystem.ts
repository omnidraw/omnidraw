import { ORPCError } from '@orpc/server';
import { fxResolveFilesystemId } from './core/fx.resolve-filesystem-id';
import { baseFilesystemOs } from './orpc';

const apiKeepaliveWatchFilesystem = baseFilesystemOs.keepaliveWatch.handler(async ({ input, context }) => {
  const filesystemId = fxResolveFilesystemId({ accountId: context.accountId, db: context.db }, { filesystemId: input.filesystemId });
  if (!filesystemId) throw new ORPCError('NOT_FOUND', { message: 'No local filesystem registered' });
  if (!context.filesystem.keepalive(filesystemId, input.watchId)) {
    throw new ORPCError('NOT_FOUND', { message: `Watch ${input.watchId} not found` });
  }
  return true;
});

export { apiKeepaliveWatchFilesystem };
