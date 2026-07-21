import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import {
  SECRET_STORE_DATABASE_KEY_ALGORITHM,
  SECRET_STORE_DATABASE_KEY_PURPOSE,
  SecretStoreDatabaseKeyProvider,
  type IActorResourceEncryptionKeyStore,
  type TStoredEncryptionKey,
} from '../src/resources/SecretStoreKeyProvider';
import { testUuid } from './test-uuid';

function memoryKeyStore(initial: Array<{ resourceId: string; key: TStoredEncryptionKey }> = []): (
  IActorResourceEncryptionKeyStore & {
    readonly rows: Map<string, TStoredEncryptionKey>;
    readonly links: Map<string, string>;
  }
) {
  const rows = new Map<string, TStoredEncryptionKey>();
  const links = new Map<string, string>();
  for (const item of initial) {
    rows.set(item.key.id, item.key);
    links.set(item.resourceId, item.key.id);
  }
  return {
    rows,
    links,
    async get(args) {
      const keyId = links.get(args.resourceId);
      return keyId === undefined ? null : rows.get(keyId) ?? null;
    },
    async getOrCreate(args) {
      const existingId = links.get(args.resourceId);
      if (existingId !== undefined) return rows.get(existingId)!;
      const created = {
        id: args.keyId,
        purpose: args.purpose,
        algorithm: args.algorithm,
        key_hex: args.keyHex,
        created_at: '2026-07-20T00:00:00.000Z',
      };
      rows.set(created.id, created);
      links.set(args.resourceId, created.id);
      return created;
    },
  };
}

function storedDatabaseKey(
  keyHex: string,
  overrides: Partial<TStoredEncryptionKey> = {},
): TStoredEncryptionKey {
  return {
    id: testUuid('key-one'),
    purpose: SECRET_STORE_DATABASE_KEY_PURPOSE,
    algorithm: SECRET_STORE_DATABASE_KEY_ALGORITHM,
    key_hex: keyHex,
    created_at: '2026-07-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('SecretStoreDatabaseKeyProvider', () => {
  test('stores and returns one actual independent database key per resource', async () => {
    const encryptionKeys = memoryKeyStore();
    let byte = 0x10;
    let id = 0;
    const provider = new SecretStoreDatabaseKeyProvider({
      encryptionKeys,
      randomBytes: () => Buffer.alloc(32, ++byte),
      randomUUID: () => testUuid(`key-${++id}`),
    });

    const first = await provider.getOrCreateDatabaseHexKey(testUuid('resource-a'));
    const second = await provider.getOrCreateDatabaseHexKey(testUuid('resource-b'));

    expect(first).toBe('11'.repeat(32));
    expect(second).toBe('12'.repeat(32));
    expect(encryptionKeys.rows).toHaveLength(2);
    expect(encryptionKeys.links).toEqual(new Map([
      [testUuid('resource-a'), testUuid('key-1')],
      [testUuid('resource-b'), testUuid('key-2')],
    ]));
  });

  test('reuses the linked database key across provider restart without generating another', async () => {
    const encryptionKeys = memoryKeyStore();
    const first = new SecretStoreDatabaseKeyProvider({
      encryptionKeys,
      randomBytes: () => Buffer.alloc(32, 0x6b),
      randomUUID: () => testUuid('persisted-key'),
    });
    const key = await first.getOrCreateDatabaseHexKey(testUuid('resource'));

    let generated = false;
    const restarted = new SecretStoreDatabaseKeyProvider({
      encryptionKeys,
      randomBytes: () => {
        generated = true;
        return Buffer.alloc(32, 0xff);
      },
      randomUUID: () => testUuid('unused-key'),
    });

    expect(await restarted.getDatabaseHexKey(testUuid('resource'))).toBe(key);
    expect(generated).toBe(false);
    expect(encryptionKeys.rows).toHaveLength(1);
  });

  test('separate providers racing one resource converge on the linked database key', async () => {
    const encryptionKeys = memoryKeyStore();
    const first = new SecretStoreDatabaseKeyProvider({
      encryptionKeys,
      randomBytes: () => Buffer.alloc(32, 0x11),
      randomUUID: () => testUuid('key-one'),
    });
    const second = new SecretStoreDatabaseKeyProvider({
      encryptionKeys,
      randomBytes: () => Buffer.alloc(32, 0x22),
      randomUUID: () => testUuid('key-two'),
    });

    const [firstKey, secondKey] = await Promise.all([
      first.getOrCreateDatabaseHexKey(testUuid('shared-resource')),
      second.getOrCreateDatabaseHexKey(testUuid('shared-resource')),
    ]);

    expect(firstKey).toBe(secondKey);
    expect(encryptionKeys.rows).toHaveLength(1);
    expect(['11'.repeat(32), '22'.repeat(32)]).toContain(firstKey);
  });

  test('rejects invalid stored database-key material or metadata', async () => {
    for (const stored of [
      storedDatabaseKey('aa'.repeat(31)),
      storedDatabaseKey('AA'.repeat(32)),
      storedDatabaseKey('aa'.repeat(32), { id: '' }),
      storedDatabaseKey('aa'.repeat(32), { purpose: 'wrong' }),
      storedDatabaseKey('aa'.repeat(32), { algorithm: 'wrong' }),
    ]) {
      const provider = new SecretStoreDatabaseKeyProvider({
        encryptionKeys: memoryKeyStore([{ resourceId: testUuid('resource'), key: stored }]),
      });
      await expect(provider.getDatabaseHexKey(testUuid('resource')))
        .rejects.toMatchObject({ code: 'SECRET_STORE_KEY_UNAVAILABLE' });
    }
  });

  test('does not create a replacement when a resource has no linked key', async () => {
    const encryptionKeys = memoryKeyStore();
    let generated = false;
    const provider = new SecretStoreDatabaseKeyProvider({
      encryptionKeys,
      randomBytes: () => {
        generated = true;
        return Buffer.alloc(32, 0x11);
      },
      randomUUID: () => testUuid('must-not-be-used'),
    });

    await expect(provider.getDatabaseHexKey(testUuid('existing-resource')))
      .rejects.toMatchObject({ code: 'SECRET_STORE_KEY_UNAVAILABLE' });
    expect(generated).toBe(false);
    expect(encryptionKeys.rows).toHaveLength(0);
    expect(encryptionKeys.links).toHaveLength(0);

    await expect(provider.getOrCreateDatabaseHexKey(testUuid('existing-resource')))
      .resolves.toBe('11'.repeat(32));
  });

  test('rejects invalid randomness, empty resource IDs, and persistence failures without leaking details', async () => {
    const short = new SecretStoreDatabaseKeyProvider({
      encryptionKeys: memoryKeyStore(),
      randomBytes: () => Buffer.alloc(31),
    });
    await expect(short.getOrCreateDatabaseHexKey(testUuid('resource')))
      .rejects.toMatchObject({ code: 'SECRET_STORE_KEY_UNAVAILABLE' });
    await expect(short.getOrCreateDatabaseHexKey(''))
      .rejects.toMatchObject({ code: 'SECRET_STORE_KEY_UNAVAILABLE' });

    const failed = new SecretStoreDatabaseKeyProvider({
      encryptionKeys: {
        async get() {
          throw new Error('sensitive database details');
        },
        async getOrCreate() {
          throw new Error('unreachable');
        },
      },
    });
    await expect(failed.getDatabaseHexKey(testUuid('resource'))).rejects.toMatchObject({
      code: 'SECRET_STORE_KEY_UNAVAILABLE',
      message: 'The secret-store database encryption key is unavailable or invalid.',
    });
  });

  test('persists the linked key through the public main-database interface across restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibecanvas-database-key-provider-'));
    const databasePath = join(root, 'vibecanvas.turso');
    const config = {
      databasePath,
      dataDir: join(root, 'data'),
      cacheDir: join(root, 'cache'),
      silentMigrations: true,
    };
    const firstDb = new DbServiceTurso(config);
    try {
      await firstDb.start();
      await firstDb.actorResource.create({
        id: testUuid('resource'),
        kind: 'secretStore',
        name: 'Secret resource',
        status: 'ready',
      });
      const first = new SecretStoreDatabaseKeyProvider({
        encryptionKeys: firstDb.actorResourceEncryptionKey,
        randomBytes: () => Buffer.alloc(32, 0x6b),
        randomUUID: () => testUuid('persisted-key'),
      });
      const key = await first.getOrCreateDatabaseHexKey(testUuid('resource'));
      await expect(firstDb.actorResourceEncryptionKey.get({ resourceId: testUuid('resource') }))
        .resolves.toMatchObject({ id: testUuid('persisted-key'), key_hex: '6b'.repeat(32) });
      await firstDb.db.close();

      const restartedDb = new DbServiceTurso(config);
      try {
        await restartedDb.start();
        let generated = false;
        const restarted = new SecretStoreDatabaseKeyProvider({
          encryptionKeys: restartedDb.actorResourceEncryptionKey,
          randomBytes: () => {
            generated = true;
            return Buffer.alloc(32, 0xff);
          },
          randomUUID: () => testUuid('unused-key'),
        });
        expect(await restarted.getDatabaseHexKey(testUuid('resource'))).toBe(key);
        expect(generated).toBe(false);
      } finally {
        await restartedDb.db.close();
      }
    } finally {
      await firstDb.db.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });
});
