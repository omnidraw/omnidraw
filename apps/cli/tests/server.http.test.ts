import { describe, expect, test } from 'bun:test';
import { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import { createFileResponse, createPublicAssetLookup } from '../src/plugins/server/http';

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
  test('serves persisted file blobs with cache headers and etag', async () => {
    const db = await createDb([{
      id: '123e4567-e89b-12d3-a456-426614174000',
      hash: 'abc123',
      mime_type: 'image/png',
      data: new Uint8Array(Buffer.from('hello')),
    }]);

    try {
      const response = await createFileResponse(
        new Request('http://localhost/files/123e4567-e89b-12d3-a456-426614174000.png'),
        db,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect(response.headers.get('etag')).toBe('"123e4567-e89b-12d3-a456-426614174000:abc123"');
      expect(await response.text()).toBe('hello');
    } finally {
      await closeDb(db);
    }
  });

  test('returns 304 when file etag matches', async () => {
    const db = await createDb([{
      id: '123e4567-e89b-12d3-a456-426614174000',
      hash: 'abc123',
      mime_type: 'image/png',
      data: new Uint8Array(Buffer.from('hello')),
    }]);

    try {
      const response = await createFileResponse(
        new Request('http://localhost/files/123e4567-e89b-12d3-a456-426614174000.png', {
          headers: { 'if-none-match': '"123e4567-e89b-12d3-a456-426614174000:abc123"' },
        }),
        db,
      );

      expect(response.status).toBe(304);
      expect(response.headers.get('etag')).toBe('"123e4567-e89b-12d3-a456-426614174000:abc123"');
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

  test('resolves public assets and blocks path traversal', () => {
    const existing = new Set(['/repo/apps/cli/public/index.html', '/repo/apps/cli/public/assets/app.js']);

    const { getPublicAssetPath } = createPublicAssetLookup('/repo/apps/cli/src/plugins/server', {
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

    expect(getPublicAssetPath('/')).toBe('/repo/apps/cli/public/index.html');
    expect(getPublicAssetPath('/assets/app.js')).toBe('/repo/apps/cli/public/assets/app.js');
    expect(getPublicAssetPath('/../../etc/passwd')).toBeNull();
    expect(getPublicAssetPath('/missing.js')).toBeNull();
  });
});
