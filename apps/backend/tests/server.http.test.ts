import { describe, expect, test } from 'bun:test';
import { DbServiceTurso } from '#backend/shell/database/DbServiceTurso/DbServiceTurso';
import {
  createFileResponse,
  createFrontendAssetLookup,
  handleHttpRequest,
} from '../src/shell/http/http';

type TFileSeed = Parameters<DbServiceTurso['file']['create']>[0];

async function createDb(files: TFileSeed[] = []): Promise<DbServiceTurso> {
  const db = new DbServiceTurso({
    applicationVersion: 'test',
    databasePath: ':memory:',
    dataDir: import.meta.dir,
    cacheDir: import.meta.dir,
  });

  await db.start();

  for (const file of files) {
    await db.file.create(file);
  }

  return db;
}

async function closeDb(db: DbServiceTurso): Promise<void> {
  await db.db.close();
}

describe('server http helpers', () => {
  test('reports the neutral service health payload', async () => {
    const db = await createDb();
    try {
      const response = await handleHttpRequest(
        new Request('http://localhost/health'),
        { version: 'test' },
        db,
        import.meta.dir,
      );
      expect(await response.json()).toEqual({
        ok: true,
        service: 'omnidraw',
        version: 'test',
        runtime: 'source',
      });
    } finally {
      await closeDb(db);
    }
  });

  test('serves persisted file blobs with cache headers and etag', async () => {
    const db = await createDb([{
      id: '123e4567-e89b-12d3-a456-426614174000',
      canvasId: null,
      hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      digestSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      mimeType: 'image/png',
      data: new Uint8Array(Buffer.from('hello')),
    }]);

    try {
      const response = await createFileResponse(
        new Request('http://localhost/files/123e4567-e89b-12d3-a456-426614174000.png'),
        db,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('etag')).toBe('"123e4567-e89b-12d3-a456-426614174000:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"');
      expect(await response.text()).toBe('hello');
    } finally {
      await closeDb(db);
    }
  });

  test('returns 304 when file etag matches', async () => {
    const db = await createDb([{
      id: '123e4567-e89b-12d3-a456-426614174000',
      canvasId: null,
      hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      digestSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      mimeType: 'image/png',
      data: new Uint8Array(Buffer.from('hello')),
    }]);

    try {
      const response = await createFileResponse(
        new Request('http://localhost/files/123e4567-e89b-12d3-a456-426614174000.png', {
          headers: { 'if-none-match': '"123e4567-e89b-12d3-a456-426614174000:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"' },
        }),
        db,
      );

      expect(response.status).toBe(304);
      expect(response.headers.get('etag')).toBe('"123e4567-e89b-12d3-a456-426614174000:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"');
    } finally {
      await closeDb(db);
    }
  });

  test('returns 404 for invalid or missing file records', async () => {
    const missingDb = await createDb();

    try {
      expect((await createFileResponse(new Request('http://localhost/files/not-a-file'), missingDb)).status).toBe(404);
      expect(
        (await createFileResponse(
          new Request('http://localhost/files/123e4567-e89b-12d3-a456-426614174000.png'),
          missingDb,
        )).status,
      ).toBe(404);
    } finally {
      await closeDb(missingDb);
    }
  });

  test('uploads, clones, serves, and idempotently deletes Canvas images', async () => {
    const db = await createDb();
    try {
      const form = new FormData();
      form.set('file', new Blob([Buffer.from('canvas-image')], { type: 'image/png' }));
      form.set('mimeType', 'image/png');
      const uploaded = await handleHttpRequest(
        new Request('http://localhost/files', { method: 'POST', body: form }),
        { version: 'test' },
        db,
        import.meta.dir,
      );
      expect(uploaded.status).toBe(200);
      const uploadedUrl = (await uploaded.json() as { url: string }).url;
      expect(uploadedUrl).toMatch(/^\/files\/[a-f0-9-]{36}\.png$/);

      const clone = await handleHttpRequest(
        new Request('http://localhost/files/clone', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: uploadedUrl }),
        }),
        { version: 'test' },
        db,
        import.meta.dir,
      );
      expect(clone.status).toBe(200);
      const cloneUrl = (await clone.json() as { url: string }).url;
      expect(cloneUrl).toMatch(/^\/files\/[a-f0-9-]{36}\.png$/);
      expect(cloneUrl).not.toBe(uploadedUrl);

      const servedClone = await handleHttpRequest(
        new Request(`http://localhost${cloneUrl}`),
        { version: 'test' },
        db,
        import.meta.dir,
      );
      expect(servedClone.status).toBe(200);
      expect(await servedClone.text()).toBe('canvas-image');

      for (const url of [uploadedUrl, cloneUrl, cloneUrl]) {
        const deleted = await handleHttpRequest(
          new Request('http://localhost/files', {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url }),
          }),
          { version: 'test' },
          db,
          import.meta.dir,
        );
        expect(deleted.status).toBe(200);
        expect(await deleted.json()).toEqual({ ok: true });
      }

      expect((await handleHttpRequest(
        new Request(`http://localhost${uploadedUrl}`),
        { version: 'test' },
        db,
        import.meta.dir,
      )).status).toBe(404);
      expect((await handleHttpRequest(
        new Request(`http://localhost${cloneUrl}`),
        { version: 'test' },
        db,
        import.meta.dir,
      )).status).toBe(404);
    } finally {
      await closeDb(db);
    }
  });

  test('rejects malformed and unsupported image uploads', async () => {
    const db = await createDb();
    try {
      const unsupported = new FormData();
      unsupported.set('file', new Blob([Buffer.from('<svg/>')], { type: 'image/svg+xml' }));
      unsupported.set('mimeType', 'image/svg+xml');
      expect((await handleHttpRequest(
        new Request('http://localhost/files', { method: 'POST', body: unsupported }),
        { version: 'test' },
        db,
        import.meta.dir,
      )).status).toBe(400);

      expect((await handleHttpRequest(
        new Request('http://localhost/files/clone', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: '/files/not-an-image' }),
        }),
        { version: 'test' },
        db,
        import.meta.dir,
      )).status).toBe(400);
    } finally {
      await closeDb(db);
    }
  });

  test('resolves the built frontend assets and blocks path traversal', () => {
    const existing = new Set([
      '/repo/apps/frontend/dist/index.html',
      '/repo/apps/frontend/dist/assets/app.js',
    ]);

    const { getFrontendAssetPath } = createFrontendAssetLookup('/repo/apps/backend/src/shell/http', {
      existsSync(path: string) {
        return existing.has(path);
      },
      normalize(path: string) {
        const normalized = path.replace(/\\/g, '/').replace(/\/+/g, '/');
        const parts = normalized.split('/');
        const resolved: string[] = [];
        for (const part of parts) {
          if (!part || part === '.') continue;
          if (part === '..') {
            resolved.pop();
            continue;
          }
          resolved.push(part);
        }
        return `/${resolved.join('/')}`;
      },
      join(...parts: string[]) {
        return parts.join('/');
      },
    });

    expect(getFrontendAssetPath('/')).toBe('/repo/apps/frontend/dist/index.html');
    expect(getFrontendAssetPath('/assets/app.js')).toBe('/repo/apps/frontend/dist/assets/app.js');
    expect(getFrontendAssetPath('/../../etc/passwd')).toBeNull();
    expect(getFrontendAssetPath('/missing.js')).toBeNull();
  });
});
