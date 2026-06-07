import { ORPCError } from '@orpc/server';
import { basename, join, resolve } from 'path';
import { fnCreateFilesystemError } from './core/fn.create-filesystem-error';
import { fxResolveFilesystemId } from './core/fx.resolve-filesystem-id';
import { fnToApiFilesystemError } from './core/fn.to-api-filesystem-error';
import { baseFilesystemOs } from './orpc';

const apiMoveFilesystem = baseFilesystemOs.move.handler(async ({ input, context }) => {
  const filesystemId = await fxResolveFilesystemId({ accountId: context.accountId, db: context.db }, { filesystemId: input.body.filesystemId });
  if (!filesystemId) throw new ORPCError('NOT_FOUND', { message: 'No local filesystem registered' });
  const sourcePath = resolve(input.body.source_path);
  const destinationDirPath = resolve(input.body.destination_dir_path);

  if (!context.filesystem.exists(filesystemId, sourcePath)) {
    return fnToApiFilesystemError(fnCreateFilesystemError('TX.FILESYSTEM.MOVE.SOURCE_NOT_FOUND', `Source path not found: ${sourcePath}`, 404), 'Failed to move file or folder');
  }

  const [destinationStats, destinationError] = context.filesystem.stat(filesystemId, destinationDirPath);
  if (destinationError || !destinationStats) return fnToApiFilesystemError(destinationError, 'Failed to move file or folder');
  if (!destinationStats.isDirectory()) {
    return fnToApiFilesystemError(fnCreateFilesystemError('TX.FILESYSTEM.MOVE.DESTINATION_NOT_DIRECTORY', `Destination is not a directory: ${destinationDirPath}`, 400), 'Failed to move file or folder');
  }

  if (destinationDirPath === sourcePath || destinationDirPath.startsWith(`${sourcePath}/`)) {
    return fnToApiFilesystemError(fnCreateFilesystemError('TX.FILESYSTEM.MOVE.INVALID_DESTINATION', 'Cannot move a path into itself', 400), 'Failed to move file or folder');
  }

  const targetPath = join(destinationDirPath, basename(sourcePath));
  if (context.filesystem.exists(filesystemId, targetPath)) {
    return fnToApiFilesystemError(fnCreateFilesystemError('TX.FILESYSTEM.MOVE.TARGET_EXISTS', `Target path already exists: ${targetPath}`, 409), 'Failed to move file or folder');
  }

  const [, renameError] = context.filesystem.rename(filesystemId, sourcePath, targetPath);
  if (renameError) return fnToApiFilesystemError(renameError, 'Failed to move file or folder');

  return {
    source_path: sourcePath,
    destination_dir_path: destinationDirPath,
    target_path: targetPath,
    moved: true,
  };
});

export { apiMoveFilesystem };
