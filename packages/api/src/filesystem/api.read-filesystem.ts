import { ORPCError } from '@orpc/server';
import { fnCreateFilesystemError } from './core/fn.create-filesystem-error';
import { fnDetectFileKind } from './core/fn.detect-file-kind';
import { fnDetectMime } from './core/fn.detect-mime';
import { fxResolveFilesystemId } from './core/fx.resolve-filesystem-id';
import { fnToApiFilesystemError } from './core/fn.to-api-filesystem-error';
import { baseFilesystemOs } from './orpc';

const apiReadFilesystem = baseFilesystemOs.read.handler(async ({ input, context }) => {
  const filesystemId = await fxResolveFilesystemId({ db: context.db }, { tenant: context.tenant, filesystemId: input.query.filesystemId });
  if (!filesystemId) throw new ORPCError('NOT_FOUND', { message: 'No local filesystem registered' });
  const path = input.query.path;
  const [buffer, error] = context.filesystem.readFile(context.tenant, { filesystemId, path });
  if (error || !buffer) {
    return fnToApiFilesystemError(error ?? fnCreateFilesystemError('FX.FILESYSTEM.READ.NOT_FOUND', `Path not found: ${path}`, 404), 'Failed to read file');
  }

  const maxBytes = input.query.maxBytes ?? buffer.length;
  const truncatedBuffer = buffer.subarray(0, maxBytes);
  const truncated = truncatedBuffer.length < buffer.length;
  const kind = fnDetectFileKind(path);
  const mime = fnDetectMime(path) ?? undefined;

  if (input.query.content === 'none') return { kind: 'none', size: buffer.length };

  if (kind === 'text' && input.query.content !== 'base64' && input.query.content !== 'binary') {
    return { kind: 'text', content: truncatedBuffer.toString('utf8'), truncated };
  }

  if (input.query.content === 'binary') {
    return { kind: 'binary', content: truncatedBuffer.toString('hex'), size: buffer.length, mime, encoding: 'hex' as const };
  }

  if (input.query.content === 'base64') {
    return { kind: 'binary', content: truncatedBuffer.toString('base64'), size: buffer.length, mime, encoding: 'base64' as const };
  }

  return { kind: 'binary', content: null, size: buffer.length, mime };
});

export { apiReadFilesystem };
