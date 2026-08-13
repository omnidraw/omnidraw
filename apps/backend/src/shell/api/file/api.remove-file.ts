import { fnFileMetaFromPathname } from '../../../core/http/fn.file-storage';
import { baseFileOs } from './procedure-builder';

const apiRemoveFile = baseFileOs.remove.handler(async ({ input, context }) => {
  const fileMeta = fnFileMetaFromPathname(new URL(input.body.url, 'http://localhost').pathname);
  if (!fileMeta) {
    throw new Error('Invalid file url');
  }

  const record = await context.db.file.getById({ id: fileMeta.id, });

  if (!record) {
    return { ok: true as const };
  }

  await context.db.file.deleteById({ id: record.id });

  return { ok: true as const };
});

export { apiRemoveFile };
