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
    id: 'key-one',
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
      randomUUID: () => `key-${++id}`,
    });

    const first = await provider.getOrCreateDatabaseHexKey('resource-a');
    const second = await provider.getOrCreateDatabaseHexKey('resource-b');

    expect(first).toBe('11'.repeat(32));
    expect(second).toBe('12'.repeat(32));
    expect(encryptionKeys.rows).toHaveLength(2);
    expect(encryptionKeys.links).toEqual(new Map([
      ['resource-a', 'key-1'],
      ['resource-b', 'key-2'],
    ]));
  });

  test('reuses the linked database key across provider restart without generating another', async () => {
    const encryptionKeys = memoryKeyStore();
    const first = new SecretStoreDatabaseKeyProvider({
      encryptionKeys,
      randomBytes: () => Buffer.alloc(32, 0x6b),
      randomUUID: () => 'persisted-key',
    });
    const key = await first.getOrCreateDatabaseHexKey('resource');

    let generated = false;
    const restarted = new SecretStoreDatabaseKeyProvider({
      encryptionKeys,
      randomBytes: () => {
        generated = true;
        return Buffer.alloc(32, 0xff);
      },
      randomUUID: () => 'unused-key',
    });

    expect(await restarted.getDatabaseHexKey('resource')).toBe(key);
    expect(generated).toBe(false);
    expect(encryptionKeys.rows).toHaveLength(1);
  });

  test('separate providers racing one resource converge on the linked database key', async () => {
    const encryptionKeys = memoryKeyStore();
    const first = new SecretStoreDatabaseKeyProvider({
      encryptionKeys,
      randomBytes: () => Buffer.alloc(32, 0x11),
      randomUUID: () => 'key-one',
    });
    const second = new SecretStoreDatabaseKeyProvider({
      encryptionKeys,
      randomBytes: () => Buffer.alloc(32, 0x22),
      randomUUID: () => 'key-two',
    });

    const [firstKey, secondKey] = await Promise.all([
      first.getOrCreateDatabaseHexKey('shared-resource'),
      second.getOrCreateDatabaseHexKey('shared-resource'),
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
        encryptionKeys: memoryKeyStore([{ resourceId: 'resource', key: stored }]),
      });
      await expect(provider.getDatabaseHexKey('resource'))
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
      randomUUID: () => 'must-not-be-used',
    });

    await expect(provider.getDatabaseHexKey('existing-resource'))
      .rejects.toMatchObject({ code: 'SECRET_STORE_KEY_UNAVAILABLE' });
    expect(generated).toBe(false);
    expect(encryptionKeys.rows).toHaveLength(0);
    expect(encryptionKeys.links).toHaveLength(0);

    await expect(provider.getOrCreateDatabaseHexKey('existing-resource'))
      .resolves.toBe('11'.repeat(32));
  });

  test('rejects invalid randomness, empty resource IDs, and persistence failures without leaking details', async () => {
    const short = new SecretStoreDatabaseKeyProvider({
      encryptionKeys: memoryKeyStore(),
      randomBytes: () => Buffer.alloc(31),
    });
    await expect(short.getOrCreateDatabaseHexKey('resource'))
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
    await expect(failed.getDatabaseHexKey('resource')).rejects.toMatchObject({
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
        id: 'resource',
        kind: 'secretStore',
        name: 'Secret resource',
        status: 'ready',
      });
      const first = new SecretStoreDatabaseKeyProvider({
        encryptionKeys: firstDb.actorResourceEncryptionKey,
        randomBytes: () => Buffer.alloc(32, 0x6b),
        randomUUID: () => 'persisted-key',
      });
      const key = await first.getOrCreateDatabaseHexKey('resource');
      await expect(firstDb.actorResourceEncryptionKey.get({ resourceId: 'resource' }))
        .resolves.toMatchObject({ id: 'persisted-key', key_hex: '6b'.repeat(32) });
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
          randomUUID: () => 'unused-key',
        });
        expect(await restarted.getDatabaseHexKey('resource')).toBe(key);
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
