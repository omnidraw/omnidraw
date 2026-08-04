import { describe, expect, test } from 'bun:test';
import { DbServiceTurso } from '@omnidraw/service-db/DbServiceTurso/DbServiceTurso';
import {
  createFileResponse,
  createFrontendAssetLookup,
  handleHttpRequest,
} from '../src/plugins/server/http';

type TFileSeed = Parameters<DbServiceTurso['file']['create']>[0];

async function createDb(files: TFileSeed[] = []): Promise<DbServiceTurso> {
  const db = new DbServiceTurso({
    databasePath: ':memory:',
    dataDir: import.meta.dir,
    cacheDir: import.meta.dir,
    silentMigrations: true,
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
        { compiled: false, version: 'test' },
        db,
        import.meta.dir,
      );
      expect(await response.json()).toEqual({
        ok: true,
        service: 'omnidraw',
        version: 'test',
        compiled: false,
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

  test('resolves the built frontend assets and blocks path traversal', () => {
    const existing = new Set([
      '/repo/apps/frontend/dist/index.html',
      '/repo/apps/frontend/dist/assets/app.js',
    ]);

    const { getFrontendAssetPath } = createFrontendAssetLookup('/repo/apps/cli/src/plugins/server', {
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
