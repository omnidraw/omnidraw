import { ORPCError } from '@orpc/server';
import { fxResolveFilesystemId } from './core/fx.resolve-filesystem-id';
import { baseFilesystemOs } from './orpc';

const apiWatchFilesystem = baseFilesystemOs.watch.handler(async function* ({ input, context }) {
  const filesystemId = fxResolveFilesystemId({ accountId: context.accountId, db: context.db }, { filesystemId: input.filesystemId });
  if (!filesystemId) throw new ORPCError('NOT_FOUND', { message: 'No local filesystem registered' });
  const iterator = context.filesystem.watch(filesystemId, input.path, input.watchId);
  if (!iterator) throw new ORPCError('CONFLICT', { message: `Watch ${input.watchId} already exists` });

  try {
    for await (const event of iterator) {
      yield event;
    }
  } finally {
    context.filesystem.unwatch(filesystemId, input.watchId);
  }
});

export { apiWatchFilesystem };
