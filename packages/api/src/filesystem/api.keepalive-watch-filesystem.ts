import { ORPCError } from '@orpc/server';
import { fxResolveFilesystemId } from './core/fx.resolve-filesystem-id';
import { baseFilesystemOs } from './orpc';

const apiKeepaliveWatchFilesystem = baseFilesystemOs.keepaliveWatch.handler(async ({ input, context }) => {
  const filesystemId = await fxResolveFilesystemId({ db: context.db }, { tenant: context.tenant, filesystemId: input.filesystemId });
  if (!filesystemId) throw new ORPCError('NOT_FOUND', { message: 'No local filesystem registered' });
  if (!context.filesystem.keepalive(context.tenant, { filesystemId, watchId: input.watchId })) {
    throw new ORPCError('NOT_FOUND', { message: 'Filesystem watch not found' });
  }
  return true;
});

export { apiKeepaliveWatchFilesystem };
