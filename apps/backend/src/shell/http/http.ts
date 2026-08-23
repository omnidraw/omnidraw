import type { DbServiceTurso } from '#backend/shell/database/DbServiceTurso/DbServiceTurso';
import type { TFileFormat } from '#backend/shell/database/model';
import {
  fnExtensionFromFormat,
  fnFileMetaFromPathname,
  fnToPublicFileUrl,
} from '#backend/core/http/fn.file-storage';
import { createHash, randomUUID } from 'node:crypto';
import type { ICliConfig } from '../cli/config';

type TStaticAssetLookup = {
  existsSync(path: string): boolean;
  normalize(path: string): string;
  join(...parts: string[]): string;
};

type THttpAssetResolver = {
  getFrontendAssetPath(pathname: string): string | null;
};

function createFrontendAssetLookup(importMetaDir: string, effects?: Partial<TStaticAssetLookup>) {
  const { existsSync } = effects?.existsSync ? { existsSync: effects.existsSync } : require('fs');
  const pathModule = effects?.normalize && effects?.join
    ? { normalize: effects.normalize, join: effects.join }
    : require('path');

  const frontendDistDir = pathModule.normalize(
    pathModule.join(importMetaDir, '..', '..', '..', '..', 'frontend', 'dist'),
  );

  return {
    getFrontendAssetPath(pathname: string): string | null {
      const requestPath = pathname === '/' ? '/index.html' : pathname;
      const absolutePath = pathModule.normalize(pathModule.join(frontendDistDir, requestPath));
      const isInsideFrontendDist = absolutePath === frontendDistDir
        || absolutePath.startsWith(`${frontendDistDir}/`)
        || absolutePath.startsWith(`${frontendDistDir}\\`);
      if (!isInsideFrontendDist) return null;
      return existsSync(absolutePath) ? absolutePath : null;
    },
  };
}

async function createHttpAssetResolver(importMetaDir: string): Promise<THttpAssetResolver> {
  const { getFrontendAssetPath } = createFrontendAssetLookup(importMetaDir);
  return { getFrontendAssetPath };
}

function fileMetaFromPathname(pathname: string): { id: string; format: TFileFormat } | null {
  if (!pathname.startsWith('/files/')) return null;
  const fileName = pathname.slice('/files/'.length);
  const match = fileName.match(/^([a-f0-9-]{36})\.(jpg|jpeg|png|gif|webp)$/i);
  if (!match?.[1] || !match?.[2]) return null;

  const extension = match[2].toLowerCase();
  const formatByExtension = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
  } as const;
  const format = formatByExtension[extension as keyof typeof formatByExtension];
  if (!format) return null;

  return { id: match[1], format };
}

async function createFileResponse(req: Request, db: DbServiceTurso): Promise<Response> {
  const fileMeta = fileMetaFromPathname(new URL(req.url).pathname);
  if (!fileMeta) return new Response('Not Found', { status: 404 });

  const record = await db.file.getById({ id: fileMeta.id });
  if (!record) return new Response('Not Found', { status: 404 });

  const etag = `"${record.id}:${record.hash}"`;
  if (req.headers.get('if-none-match') === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: etag,
        'Cache-Control': 'private, no-store',
      },
    });
  }

  const data = record.data instanceof ArrayBuffer
    ? new Uint8Array(record.data)
    : record.data;

  return new Response(data, {
    headers: {
      'Content-Type': record.mimeType,
      'Cache-Control': 'private, no-store',
      ETag: etag,
    },
  });
}

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const CANVAS_IMAGE_MIME_TYPES = new Set<TFileFormat>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

async function readJsonBody(req: Request): Promise<Readonly<Record<string, unknown>> | null> {
  try {
    const value = await req.json();
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Readonly<Record<string, unknown>>
      : null;
  } catch {
    return null;
  }
}

/** Native HTTP edge for Canvas image bytes; durable data still belongs to the DB authority. */
async function createFileMutationResponse(req: Request, db: DbServiceTurso): Promise<Response> {
  const pathname = new URL(req.url).pathname;
  if (req.method === 'POST' && pathname === '/files') {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return jsonError('Invalid multipart image payload.');
    }
    const file = form.get('file');
    const mimeType = form.get('mimeType');
    if (
      !(file instanceof Blob)
      || typeof mimeType !== 'string'
      || (file.type !== '' && file.type !== mimeType)
    ) {
      return jsonError('Invalid image payload.');
    }
    const format = mimeType as TFileFormat;
    const extension = fnExtensionFromFormat(format);
    if (
      !CANVAS_IMAGE_MIME_TYPES.has(format)
      || extension === null
      || file.size < 1
      || file.size > MAX_IMAGE_BYTES
    ) {
      return jsonError('Unsupported or invalid image payload.');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const digestSha256 = createHash('sha256').update(bytes).digest('hex');
    const id = randomUUID();
    await db.file.create({
      id,
      canvasId: null,
      hash: digestSha256,
      digestSha256,
      mimeType: format,
      data: bytes,
    });
    return Response.json({ url: fnToPublicFileUrl(`${id}.${extension}`) });
  }

  if (req.method === 'POST' && pathname === '/files/clone') {
    const body = await readJsonBody(req);
    const source = typeof body?.url === 'string'
      ? fnFileMetaFromPathname(new URL(body.url, 'http://localhost').pathname)
      : null;
    if (source === null) return jsonError('Invalid file URL.');
    const record = await db.file.getById({ id: source.id });
    if (record === null) return jsonError('File not found.', 404);
    const extension = fnExtensionFromFormat(record.mimeType);
    if (extension === null) return jsonError('Unsupported image MIME type.');
    const id = randomUUID();
    await db.file.create({
      id,
      canvasId: record.canvasId,
      hash: record.hash,
      digestSha256: record.digestSha256,
      mimeType: record.mimeType,
      data: record.data,
    });
    return Response.json({ url: fnToPublicFileUrl(`${id}.${extension}`) });
  }

  if (req.method === 'DELETE' && pathname === '/files') {
    const body = await readJsonBody(req);
    const target = typeof body?.url === 'string'
      ? fnFileMetaFromPathname(new URL(body.url, 'http://localhost').pathname)
      : null;
    if (target === null) return jsonError('Invalid file URL.');
    if (await db.file.getById({ id: target.id }) !== null) {
      await db.file.deleteById({ id: target.id });
    }
    return Response.json({ ok: true });
  }

  return new Response('Not Found', { status: 404 });
}

async function handleHttpRequest(
  req: Request,
  config: Pick<ICliConfig, 'version'>,
  db: DbServiceTurso,
  importMetaDir: string,
): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === 'GET' && url.pathname === '/health') {
    return Response.json({
      ok: true,
      service: 'omnidraw',
      version: config.version,
      runtime: 'source',
    });
  }

  if (req.method === 'GET' && url.pathname.startsWith('/files/')) {
    return await createFileResponse(req, db);
  }

  if (
    (req.method === 'POST' && (url.pathname === '/files' || url.pathname === '/files/clone'))
    || (req.method === 'DELETE' && url.pathname === '/files')
  ) return await createFileMutationResponse(req, db);

  const assets = await createHttpAssetResolver(importMetaDir);

  const frontendAsset = assets.getFrontendAssetPath(url.pathname);
  if (frontendAsset) return new Response(Bun.file(frontendAsset));

  const frontendSpaFallback = assets.getFrontendAssetPath('/');
  if (frontendSpaFallback) return new Response(Bun.file(frontendSpaFallback));

  return new Response('Not Found', { status: 404 });
}

export {
  createFileMutationResponse,
  createFileResponse,
  createFrontendAssetLookup,
  createHttpAssetResolver,
  handleHttpRequest,
};
export type { THttpAssetResolver, TStaticAssetLookup };
