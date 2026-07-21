import { ORPCError } from '@orpc/server';
import { dirname, resolve } from 'path';
import { fnCreateFilesystemError } from './core/fn.create-filesystem-error';
import { fxResolveFilesystemId } from './core/fx.resolve-filesystem-id';
import { fnToApiFilesystemError } from './core/fn.to-api-filesystem-error';
import { baseFilesystemOs } from './orpc';

const apiListFilesystem = baseFilesystemOs.list.handler(async ({ input, context }) => {
  const filesystemId = await fxResolveFilesystemId({ accountId: context.accountId, db: context.db }, { filesystemId: input.query.filesystemId });
  if (!filesystemId) throw new ORPCError('NOT_FOUND', { message: 'No local filesystem registered' });
  const current = resolve(input.query.path);
  if (!context.filesystem.exists(filesystemId, current)) {
    return fnToApiFilesystemError(fnCreateFilesystemError('FX.FILESYSTEM.LIST.NOT_FOUND', `Path not found: ${current}`, 404), 'Failed to list directory');
  }

  const [entries, readError] = context.filesystem.readdir(filesystemId, current);
  if (readError || !entries) return fnToApiFilesystemError(readError, 'Failed to list directory');

  const children = entries
    .filter((entry) => !input.query.omitFiles || entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: resolve(current, entry.name),
      isDir: entry.isDirectory(),
    }))
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));

  const parent = dirname(current);
  return {
    current,
    parent: parent === current ? null : parent,
    children,
  };
});

export { apiListFilesystem };
