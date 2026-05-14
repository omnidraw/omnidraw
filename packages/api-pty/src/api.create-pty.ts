import { ORPCError } from '@orpc/server';
import { fxResolveFilesystemId } from './core/fx.resolve-filesystem-id';
import { basePtyOs } from './orpc';

const apiCreatePty = basePtyOs.create.handler(async ({ input, context }) => {
  const filesystemId = fxResolveFilesystemId({ accountId: context.accountId, db: context.db }, { filesystemId: input.filesystemId });
  if (!filesystemId) throw new ORPCError('NOT_FOUND', { message: 'No local filesystem registered' });
  return context.pty.create(filesystemId, input.workingDirectory, input.body);
});

export { apiCreatePty };
