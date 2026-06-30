import { ORPCError } from '@orpc/server';
import { basename, resolve } from 'path';
import { fnCreateFilesystemError } from './core/fn.create-filesystem-error';
import { fnDetectFileKind } from './core/fn.detect-file-kind';
import { fnDetectMime } from './core/fn.detect-mime';
import { fxResolveFilesystemId } from './core/fx.resolve-filesystem-id';
import { fnToApiFilesystemError } from './core/fn.to-api-filesystem-error';
import { baseFilesystemOs } from './orpc';

const apiInspectFilesystem = baseFilesystemOs.inspect.handler(async ({ input, context }) => {
  const filesystemId = await fxResolveFilesystemId({ accountId: context.accountId, db: context.db }, { filesystemId: input.query.filesystemId });
  if (!filesystemId) throw new ORPCError('NOT_FOUND', { message: 'No local filesystem registered' });
  const path = resolve(input.query.path);
  const [stats, error] = context.filesystem.stat(filesystemId, path);
  if (error || !stats) return fnToApiFilesystemError(error ?? fnCreateFilesystemError('FX.FILESYSTEM.INSPECT.NOT_FOUND', `Path not found: ${path}`, 404), 'Failed to inspect file');

  return {
    name: basename(path),
    path,
    mime: fnDetectMime(path),
    kind: fnDetectFileKind(path),
    size: stats.size,
    lastModified: stats.mtimeMs,
    permissions: permissionsToRwx(stats.mode),
  };
});

function permissionsToRwx(mode: number): string {
  const scopes = [6, 3, 0];
  return scopes.map((shift) => {
    const value = (mode >> shift) & 0b111;
    return `${value & 0b100 ? 'r' : '-'}${value & 0b010 ? 'w' : '-'}${value & 0b001 ? 'x' : '-'}`;
  }).join('');
}

export { apiInspectFilesystem };
