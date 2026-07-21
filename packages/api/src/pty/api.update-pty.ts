import { ORPCError } from '@orpc/server';
import { fxResolveFilesystemId } from './core/fx.resolve-filesystem-id';
import { basePtyOs } from './orpc';

const apiUpdatePty = basePtyOs.update.handler(async ({ input, context }) => {
  const filesystemId = await fxResolveFilesystemId({ db: context.db }, { tenant: context.tenant, filesystemId: input.filesystemId });
  if (!filesystemId) throw new ORPCError('NOT_FOUND', { message: 'No local filesystem registered' });
  const pty = context.pty.update(context.tenant, {
    filesystemId,
    workingDirectory: input.workingDirectory,
    ptyID: input.path.ptyID,
    body: input.body,
  });
  if (!pty) throw new ORPCError('NOT_FOUND', { message: 'PTY not found' });
  return pty;
});

export { apiUpdatePty };
