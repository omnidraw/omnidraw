import { ORPCError } from '@orpc/server';
import { fxResolveFilesystemId } from './core/fx.resolve-filesystem-id';
import { basePtyOs } from './orpc';

const apiListPty = basePtyOs.list.handler(async ({ input, context }) => {
  const filesystemId = await fxResolveFilesystemId({ accountId: context.accountId }, { filesystemId: input.filesystemId });
  if (!filesystemId) throw new ORPCError('NOT_FOUND', { message: 'No local filesystem registered' });
  return context.pty.list(filesystemId, input.workingDirectory);
});

export { apiListPty };
