import { createHash } from 'crypto';
import { fnExtensionFromFormat, fnToPublicFileUrl } from './core/fn.file-storage';
import { baseFileOs } from './orpc';

function getBase64Payload(base64OrDataUrl: string): string {
  const match = base64OrDataUrl.match(/^data:[^;]+;base64,(.+)$/);
  if (match?.[1]) return match[1];
  return base64OrDataUrl;
}

const apiPutFile = baseFileOs.put.handler(async ({ input, context }) => {
  const base64Payload = getBase64Payload(input.body.base64).trim();
  const bytes = Buffer.from(base64Payload, 'base64');

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
    hash,
    mime_type: input.body.mime_type,
    base64: base64Payload,
  });

  return {
    url: fnToPublicFileUrl(fileName),
  };
});

export { apiPutFile };
