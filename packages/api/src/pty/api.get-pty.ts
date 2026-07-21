import { ORPCError } from '@orpc/server';
import { fxResolveFilesystemId } from './core/fx.resolve-filesystem-id';
import { basePtyOs } from './orpc';

const apiGetPty = basePtyOs.get.handler(async ({ input, context }) => {
  const filesystemId = await fxResolveFilesystemId({ db: context.db }, { tenant: context.tenant, filesystemId: input.filesystemId });
  if (!filesystemId) throw new ORPCError('NOT_FOUND', { message: 'No local filesystem registered' });
  return context.pty.get(context.tenant, {
    filesystemId,
    workingDirectory: input.workingDirectory,
    ptyID: input.path.ptyID,
  }) ?? null;
});

export { apiGetPty };
