import { createHash } from 'crypto';
import { fnExtensionFromFormat, fnToPublicFileUrl } from '../../../core/http/fn.file-storage';
import { baseFileOs } from './procedure-builder';

async function toBytes(data: Blob | Uint8Array) {
  if (data instanceof Uint8Array) {
    return data;
  }

  return new Uint8Array(await data.arrayBuffer());
}

const apiPutFile = baseFileOs.put.handler(async ({ input, context }) => {
  const bytes = await toBytes(input.body.data);

  if (bytes.length === 0) {
    throw new Error('Invalid or empty image payload');
  }

  const extension = fnExtensionFromFormat(input.body.mime_type);
  if (!extension) {
    throw new Error('Unsupported image MIME type');
  }

  const hash = createHash('sha256').update(bytes).digest('hex');
  const id = crypto.randomUUID();
  const fileName = `${id}.${extension}`;

  await context.db.file.create({
    id,
    canvasId: null,
    hash,
    digestSha256: hash,
    mimeType: input.body.mime_type,
    data: new Uint8Array(bytes),
  });

  return {
    url: fnToPublicFileUrl(fileName),
  };
});

export { apiPutFile };
