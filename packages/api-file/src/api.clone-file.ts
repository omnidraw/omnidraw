import { extensionFromFormat, fileMetaFromPathname, toPublicFileUrl } from './core/fn.file-storage';
import { baseFileOs } from './orpc';

const apiCloneFile = baseFileOs.clone.handler(async ({ input, context }) => {
  const fileMeta = fileMetaFromPathname(new URL(input.body.url, 'http://localhost').pathname);
  if (!fileMeta) {
    throw new Error('Invalid file url');
  }

  const record = context.db.file.get({ id: fileMeta.id, format: fileMeta.format });

  if (!record) {
    throw new Error('File not found');
  }

  const clonedId = crypto.randomUUID();
  context.db.file.create({
    id: clonedId,
    hash: record.hash,
    format: record.format,
    base64: record.base64,
  });

  return {
    url: toPublicFileUrl(`${clonedId}.${extensionFromFormat(record.format)}`),
  };
});

export { apiCloneFile };
