import { ORPCError } from '@orpc/server';
import { fxResolveFilesystemId } from './core/fx.resolve-filesystem-id';
import { fnToApiFilesystemError } from './core/fn.to-api-filesystem-error';
import { baseFilesystemOs } from './orpc';

const apiWriteFilesystem = baseFilesystemOs.write.handler(async ({ input, context }) => {
  const filesystemId = await fxResolveFilesystemId({ db: context.db }, { tenant: context.tenant, filesystemId: input.query.filesystemId });
  if (!filesystemId) throw new ORPCError('NOT_FOUND', { message: 'No local filesystem registered' });
  const path = input.query.path;
  const [, error] = context.filesystem.writeFile(context.tenant, { filesystemId, path, content: input.query.content });
  if (error) return fnToApiFilesystemError(error, 'Failed to write file');
  return { success: true as const };
});

export { apiWriteFilesystem };
