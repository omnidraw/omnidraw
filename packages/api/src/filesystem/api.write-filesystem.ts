import { ORPCError } from '@orpc/server';
import { resolve } from 'path';
import { fxResolveFilesystemId } from './core/fx.resolve-filesystem-id';
import { fnToApiFilesystemError } from './core/fn.to-api-filesystem-error';
import { baseFilesystemOs } from './orpc';

const apiWriteFilesystem = baseFilesystemOs.write.handler(async ({ input, context }) => {
  const filesystemId = await fxResolveFilesystemId({ accountId: context.accountId, db: context.db }, { filesystemId: input.query.filesystemId });
  if (!filesystemId) throw new ORPCError('NOT_FOUND', { message: 'No local filesystem registered' });
  const path = resolve(input.query.path);
  const [, error] = context.filesystem.writeFile(filesystemId, path, input.query.content);
  if (error) return fnToApiFilesystemError(error, 'Failed to write file');
  return { success: true as const };
});

export { apiWriteFilesystem };
