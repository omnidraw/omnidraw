import { fnExtensionFromFormat, fnFileMetaFromPathname, fnToPublicFileUrl } from './core/fn.file-storage';
import { baseFileOs } from './orpc';

const apiCloneFile = baseFileOs.clone.handler(async ({ input, context }) => {
  const fileMeta = fnFileMetaFromPathname(new URL(input.body.url, 'http://localhost').pathname);
  if (!fileMeta) {
    throw new Error('Invalid file url');
  }

  const record = await context.db.file.getById({ id: fileMeta.id });

  if (!record) {
    throw new Error('File not found');
  }

  const extension = fnExtensionFromFormat(record.mimeType);
  if (!extension) {
    throw new Error('Unsupported image MIME type');
  }

  const clonedId = crypto.randomUUID();
  await context.db.file.create({
    id: clonedId,
    canvasId: record.canvasId,
    hash: record.hash,
    digestSha256: record.digestSha256,
    mimeType: record.mimeType,
    data: record.data,
  });

  return {
    url: fnToPublicFileUrl(`${clonedId}.${extension}`),
  };
});

export { apiCloneFile };
