import { describe, expect, test } from 'bun:test';
import { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import { createFileResponse, createPublicAssetLookup } from '../src/plugins/server/http';
import { OSS_FAKE_SESSION, OSS_TENANT_CONTEXT_PROVIDER } from '../src/plugins/auth/AuthPlugin';

type TFileSeed = Parameters<DbServiceTurso['file']['create']>[1];

const tenant = await OSS_TENANT_CONTEXT_PROVIDER.resolveTenantContext({
  requestId: 'server-http-test',
  session: OSS_FAKE_SESSION,
});

async function createDb(files: TFileSeed[] = []): Promise<DbServiceTurso> {
  const db = new DbServiceTurso({
    databasePath: ':memory:',
    dataDir: import.meta.dir,
    cacheDir: import.meta.dir,
    silentMigrations: true,
  });

  await db.start();

  for (const file of files) {
    await db.file.create(tenant, file);
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
        tenant,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
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
        tenant,
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
      expect((await createFileResponse(new Request('http://localhost/files/not-a-file'), missingDb, tenant)).status).toBe(404);
      expect(
        (await createFileResponse(
          new Request('http://localhost/files/123e4567-e89b-12d3-a456-426614174000.png'),
          missingDb,
          tenant,
        )).status,
      ).toBe(404);
    } finally {
      await closeDb(missingDb);
    }
  });

  test('returns the same 404 for a known foreign media id', async () => {
    const db = await createDb();
    const foreignOrgId = '00000000-0000-4000-8000-000000000011';
    const fileId = '123e4567-e89b-12d3-a456-426614174099';
    try {
      await (await db.db.prepare(`
        INSERT INTO organizations (id, slug, name, status, created_at_ms, updated_at_ms)
        VALUES (?, 'foreign-http', 'Foreign HTTP', 'active', 0, 0)
      `)).run(foreignOrgId);
      await (await db.db.prepare(`
        INSERT INTO media_files (
          org_id, id, canvas_id, source_hash, digest_sha256, mime_type, byte_size, data, created_at_ms
        ) VALUES (?, ?, NULL, 'foreign', NULL, 'image/png', 7, ?, 0)
      `)).run(foreignOrgId, fileId, new Uint8Array(Buffer.from('foreign')));

      const response = await createFileResponse(
        new Request(`http://localhost/files/${fileId}.png`),
        db,
        tenant,
      );
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('Not Found');
    } finally {
      await closeDb(db);
    }
  });

  test('does not treat a known foreign digest as media authority', async () => {
    const db = await createDb();
    const foreignOrgId = '00000000-0000-4000-8000-000000000011';
    const foreignDigest = 'a'.repeat(64);
    const unknownDigest = 'f'.repeat(64);
    try {
      await (await db.db.prepare(`
        INSERT INTO organizations (id, slug, name, status, created_at_ms, updated_at_ms)
        VALUES (?, 'foreign-digest', 'Foreign digest', 'active', 0, 0)
      `)).run(foreignOrgId);
      await (await db.db.prepare(`
        INSERT INTO media_files (
          org_id, id, canvas_id, source_hash, digest_sha256, mime_type, byte_size, data, created_at_ms
        ) VALUES (?, '123e4567-e89b-12d3-a456-426614174098', NULL, 'foreign', ?, 'image/png', 7, ?, 0)
      `)).run(foreignOrgId, foreignDigest, new Uint8Array(Buffer.from('foreign')));

      const foreign = await createFileResponse(
        new Request(`http://localhost/files/${foreignDigest}.png`),
        db,
        tenant,
      );
      const unknown = await createFileResponse(
        new Request(`http://localhost/files/${unknownDigest}.png`),
        db,
        tenant,
      );
      expect({ status: foreign.status, body: await foreign.text() }).toEqual({
        status: unknown.status,
        body: await unknown.text(),
      });
      expect(foreign.status).toBe(404);
    } finally {
      await closeDb(db);
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
