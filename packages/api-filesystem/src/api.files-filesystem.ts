import { ORPCError } from '@orpc/server';
import { resolve } from 'path';
import type { TFilesystemDirNode } from '@vibecanvas/service-filesystem/types';
import { fnCreateFilesystemError } from './core/fn.create-filesystem-error';
import { fxResolveFilesystemId } from './core/fx.resolve-filesystem-id';
import { fnToApiFilesystemError } from './core/fn.to-api-filesystem-error';
import { baseFilesystemOs } from './orpc';

const apiFilesFilesystem = baseFilesystemOs.files.handler(async ({ input, context }) => {
  const filesystemId = await fxResolveFilesystemId({ accountId: context.accountId, db: context.db }, { filesystemId: input.query.filesystemId });
  if (!filesystemId) throw new ORPCError('NOT_FOUND', { message: 'No local filesystem registered' });
  const root = resolve(input.query.path || context.filesystem.homeDir(filesystemId));
  const maxDepth = input.query.max_depth ?? Number.POSITIVE_INFINITY;

  if (!context.filesystem.exists(filesystemId, root)) {
    return fnToApiFilesystemError(fnCreateFilesystemError('FX.FILESYSTEM.FILES.NOT_FOUND', `Path not found: ${root}`, 404), 'Failed to list files');
  }

  const [rootStats, rootStatsError] = context.filesystem.stat(filesystemId, root);
  if (rootStatsError || !rootStats) return fnToApiFilesystemError(rootStatsError, 'Failed to list files');
  if (!rootStats.isDirectory()) {
    return fnToApiFilesystemError(fnCreateFilesystemError('FX.FILESYSTEM.FILES.NOT_DIRECTORY', `Path is not a directory: ${root}`, 400), 'Failed to list files');
  }

  const [children, walkError] = walkDirectory(context.filesystem, filesystemId, root, maxDepth);
  if (walkError || !children) return fnToApiFilesystemError(walkError, 'Failed to list files');

  return { root, children };
});

function walkDirectory(
  filesystem: import('@vibecanvas/service-filesystem/IFilesystemService').IFilesystemService,
  filesystemId: string,
  directoryPath: string,
  depthRemaining: number,
): TErrTuple<TFilesystemDirNode[]> {
  const [entries, readError] = filesystem.readdir(filesystemId, directoryPath);
  if (readError || !entries) return [null, readError ?? fnCreateFilesystemError('FX.FILESYSTEM.FILES.FAILED', `Failed to list directory: ${directoryPath}`)];

  const nodes: TFilesystemDirNode[] = [];

  for (const entry of entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
    const entryPath = resolve(directoryPath, entry.name);

    if (entry.isDirectory()) {
      const [children, childError] = depthRemaining > 0 ? walkDirectory(filesystem, filesystemId, entryPath, depthRemaining - 1) : [[], null];
      if (childError) {
        if (fnIsPermissionDeniedError(childError)) {
          nodes.push({
            name: entry.name,
            path: entryPath,
            is_dir: true,
            is_unreadable: true,
            unreadable_reason: 'permission_denied',
            children: [],
          });
          continue;
        }

        return [null, childError];
      }

      nodes.push({ name: entry.name, path: entryPath, is_dir: true, children: children ?? [] });
      continue;
    }

    nodes.push({ name: entry.name, path: entryPath, is_dir: false, children: [] });
  }

  return [nodes, null];
}

function fnIsPermissionDeniedError(error: TErrorEntry | null | undefined): boolean {
  return error?.statusCode === 403 || error?.code.endsWith('.PERMISSION_DENIED') === true;
}

export { apiFilesFilesystem, walkDirectory };
