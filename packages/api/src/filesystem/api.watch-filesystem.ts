import { ORPCError } from '@orpc/server';
import { fxResolveFilesystemId } from './core/fx.resolve-filesystem-id';
import { baseFilesystemOs } from './orpc';

const apiWatchFilesystem = baseFilesystemOs.watch.handler(async function* ({ input, context }) {
  const filesystemId = await fxResolveFilesystemId({ db: context.db }, { tenant: context.tenant, filesystemId: input.filesystemId });
  if (!filesystemId) throw new ORPCError('NOT_FOUND', { message: 'No local filesystem registered' });
  const iterator = context.filesystem.watch(context.tenant, { filesystemId, path: input.path, watchId: input.watchId });
  if (!iterator) throw new ORPCError('CONFLICT', { message: 'Filesystem watch unavailable' });

  try {
    for await (const event of iterator) {
      yield event;
    }
  } finally {
    context.filesystem.unwatch(context.tenant, { filesystemId, watchId: input.watchId });
  }
});

export { apiWatchFilesystem };
