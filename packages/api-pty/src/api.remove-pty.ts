import { ORPCError } from '@orpc/server';
import { fxResolveFilesystemId } from './core/fx.resolve-filesystem-id';
import { basePtyOs } from './orpc';

const apiRemovePty = basePtyOs.remove.handler(async ({ input, context }) => {
  const filesystemId = await fxResolveFilesystemId({ accountId: context.accountId, db: context.db }, { filesystemId: input.filesystemId });
  if (!filesystemId) throw new ORPCError('NOT_FOUND', { message: 'No local filesystem registered' });
  const removed = await context.pty.remove(filesystemId, input.workingDirectory, input.path.ptyID);
  if (!removed) throw new ORPCError('NOT_FOUND', { message: 'PTY not found' });
  return true;
});

export { apiRemovePty };
