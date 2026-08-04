import type { DbServiceTurso } from '@omnidraw/service-db/DbServiceTurso/DbServiceTurso';
import type { TFileFormat } from '@omnidraw/service-db/model';
import type { ICliConfig } from '../../config';

type TEmbeddedAssetsModule = {
  getEmbeddedAsset(pathname: string): string | null;
  getSpaFallbackAsset(): string | null;
};

type TStaticAssetLookup = {
  existsSync(path: string): boolean;
  normalize(path: string): string;
  join(...parts: string[]): string;
};

type THttpAssetResolver = {
  getEmbeddedAsset(pathname: string): string | null;
  getSpaFallbackAsset(): string | null;
  getFrontendAssetPath(pathname: string): string | null;
};

let embeddedAssetsPromise: Promise<TEmbeddedAssetsModule | null> | null = null;

async function loadEmbeddedAssetsModule(): Promise<TEmbeddedAssetsModule | null> {
  if (!embeddedAssetsPromise) {
    const embeddedAssetsModulePath = '../../../embedded-assets';
    embeddedAssetsPromise = import(embeddedAssetsModulePath)
      .then((module) => module as TEmbeddedAssetsModule)
      .catch(() => null);
  }

  return embeddedAssetsPromise;
}

function createFrontendAssetLookup(importMetaDir: string, portal?: Partial<TStaticAssetLookup>) {
  const { existsSync } = portal?.existsSync ? { existsSync: portal.existsSync } : require('fs');
  const pathModule = portal?.normalize && portal?.join
    ? { normalize: portal.normalize, join: portal.join }
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
  const embeddedAssets = await loadEmbeddedAssetsModule();
  const { getFrontendAssetPath } = createFrontendAssetLookup(importMetaDir);

  return {
    getEmbeddedAsset(pathname: string) {
      return embeddedAssets?.getEmbeddedAsset(pathname) ?? null;
    },
    getSpaFallbackAsset() {
      return embeddedAssets?.getSpaFallbackAsset() ?? null;
    },
    getFrontendAssetPath,
  };
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

async function handleHttpRequest(
  req: Request,
  config: Pick<ICliConfig, 'compiled' | 'version'>,
  db: DbServiceTurso,
  importMetaDir: string,
): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === 'GET' && url.pathname === '/health') {
    return Response.json({
      ok: true,
      service: 'omnidraw',
      version: config.version,
      compiled: config.compiled,
    });
  }

  if (req.method === 'GET' && url.pathname.startsWith('/files/')) {
    return await createFileResponse(req, db);
  }

  const assets = await createHttpAssetResolver(importMetaDir);

  const embeddedAsset = assets.getEmbeddedAsset(url.pathname);
  if (embeddedAsset) return new Response(Bun.file(embeddedAsset));

  const frontendAsset = assets.getFrontendAssetPath(url.pathname);
  if (frontendAsset) return new Response(Bun.file(frontendAsset));

  const spaFallbackAsset = assets.getSpaFallbackAsset();
  if (spaFallbackAsset) return new Response(Bun.file(spaFallbackAsset));

  const frontendSpaFallback = assets.getFrontendAssetPath('/');
  if (frontendSpaFallback) return new Response(Bun.file(frontendSpaFallback));

  if (config.compiled) return new Response('Not Found', { status: 404 });
  return new Response('Not Found', { status: 404 });
}

export { createFileResponse, createFrontendAssetLookup, createHttpAssetResolver, handleHttpRequest };
export type { TEmbeddedAssetsModule, THttpAssetResolver, TStaticAssetLookup };
