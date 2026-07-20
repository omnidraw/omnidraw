import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connect, type Database } from '@tursodatabase/database';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fxActorResourceEncryptionKeyGet } from '../../../src/DbServiceTurso/fx.encryption-key';
import {
  txActorResourceBeginDelete,
  txActorResourceCreate,
  txActorResourceDelete,
} from '../../../src/DbServiceTurso/tx.actor-resource';
import { txActorResourceEncryptionKeyGetOrCreate } from '../../../src/DbServiceTurso/tx.encryption-key';
import { txRunMigrations } from '../../../src/DbServiceTurso/tx.migrations';

async function inMemoryDb(): Promise<Database> {
  // @ts-expect-error custom_types not typed yet
  return connect(':memory:', { experimental: ['custom_types', 'triggers', 'index_method'] });
}

async function createSecretResource(db: Database, id: string): Promise<void> {
  await txActorResourceCreate({ db }, {
    id,
    kind: 'secretStore',
    name: `Secret ${id}`,
    status: 'ready',
  });
}

describe('tx.encryption-key/fx.encryption-key', () => {
  let db!: Database;

  beforeEach(async () => {
    db = await inMemoryDb();
    await db.exec('PRAGMA foreign_keys = ON');
    await txRunMigrations({ db, Bun, path }, {});
    await createSecretResource(db, 'secret-one');
  });

  afterEach(async () => {
    await db.close();
  });

  test('stores the actual database key generically and links it separately to one actor resource', async () => {
    const created = await txActorResourceEncryptionKeyGetOrCreate({ db }, {
      resourceId: 'secret-one',
      keyId: 'key-one',
      purpose: 'actor-resource-secret-store',
      algorithm: 'aegis256',
      keyHex: '11'.repeat(32),
    });

    expect(created).toMatchObject({
      id: 'key-one',
      purpose: 'actor-resource-secret-store',
      algorithm: 'aegis256',
      key_hex: '11'.repeat(32),
    });
    await expect(fxActorResourceEncryptionKeyGet({ db }, { resourceId: 'secret-one' }))
      .resolves.toEqual(created);
    await expect(fxActorResourceEncryptionKeyGet({ db }, { resourceId: 'missing' }))
      .resolves.toBeNull();

    const keyColumns = await (await db.prepare('PRAGMA table_info(encryption_keys)')).all();
    expect(keyColumns.map((column) => column.name)).toEqual([
      'id', 'purpose', 'algorithm', 'key_hex', 'created_at',
    ]);
    const link = await (await db.prepare(`
      SELECT actor_resource_id, encryption_key_id
      FROM actor_resource_encryption_keys
    `)).get();
    expect(link).toEqual({ actor_resource_id: 'secret-one', encryption_key_id: 'key-one' });
  });

  test('allows database administration while foreign keys protect a linked key', async () => {
    await txActorResourceEncryptionKeyGetOrCreate({ db }, {
      resourceId: 'secret-one',
      keyId: 'key-one',
      purpose: 'actor-resource-secret-store',
      algorithm: 'aegis256',
      keyHex: '11'.repeat(32),
    });

    await db.exec("UPDATE encryption_keys SET key_hex = '2222' WHERE id = 'key-one'");
    await expect(db.exec("DELETE FROM encryption_keys WHERE id = 'key-one'"))
      .rejects.toThrow();
    await db.exec("DELETE FROM actor_resource_encryption_keys WHERE actor_resource_id = 'secret-one'");
    await expect(db.exec("DELETE FROM encryption_keys WHERE id = 'key-one'"))
      .resolves.toBeUndefined();
  });

  test('deletes the linked key atomically with its actor resource', async () => {
    await txActorResourceEncryptionKeyGetOrCreate({ db }, {
      resourceId: 'secret-one',
      keyId: 'key-one',
      purpose: 'actor-resource-secret-store',
      algorithm: 'aegis256',
      keyHex: '11'.repeat(32),
    });

    await expect(txActorResourceDelete({ db }, { id: 'secret-one' })).resolves.toBe(false);
    await expect(fxActorResourceEncryptionKeyGet({ db }, { resourceId: 'secret-one' }))
      .resolves.toMatchObject({ id: 'key-one' });

    await txActorResourceBeginDelete({ db }, { id: 'secret-one' });
    await expect(txActorResourceDelete({ db }, { id: 'secret-one' })).resolves.toBe(true);
    await expect(fxActorResourceEncryptionKeyGet({ db }, { resourceId: 'secret-one' }))
      .resolves.toBeNull();
    const keyCount = await (await db.prepare('SELECT COUNT(*) AS count FROM encryption_keys')).get();
    const linkCount = await (await db.prepare('SELECT COUNT(*) AS count FROM actor_resource_encryption_keys')).get();
    expect(Number(keyCount?.count)).toBe(0);
    expect(Number(linkCount?.count)).toBe(0);
  });

  test('separate database connections converge on one linked database key', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'vibecanvas-encryption-key-'));
    const databasePath = path.join(directory, 'shared.turso');
    // @ts-expect-error custom_types not typed yet
    const first = await connect(databasePath, { experimental: ['custom_types', 'triggers', 'index_method', 'multiprocess_wal'] });
    // @ts-expect-error custom_types not typed yet
    const second = await connect(databasePath, { experimental: ['custom_types', 'triggers', 'index_method', 'multiprocess_wal'] });
    try {
      await txRunMigrations({ db: first, Bun, path }, {});
      for (const connection of [first, second]) {
        await connection.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
      }
      await createSecretResource(first, 'shared-secret');

      const [one, two] = await Promise.all([
        txActorResourceEncryptionKeyGetOrCreate({ db: first }, {
          resourceId: 'shared-secret',
          keyId: 'key-one',
          purpose: 'actor-resource-secret-store',
          algorithm: 'aegis256',
          keyHex: '11'.repeat(32),
        }),
        txActorResourceEncryptionKeyGetOrCreate({ db: second }, {
          resourceId: 'shared-secret',
          keyId: 'key-two',
          purpose: 'actor-resource-secret-store',
          algorithm: 'aegis256',
          keyHex: '22'.repeat(32),
        }),
      ]);

      expect(one).toEqual(two);
      expect(['11'.repeat(32), '22'.repeat(32)]).toContain(one.key_hex);
      const count = await (await first.prepare('SELECT COUNT(*) AS count FROM encryption_keys')).get();
      expect(Number(count?.count)).toBe(1);
    } finally {
      await Promise.allSettled([first.close(), second.close()]);
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('rolls back malformed keys and links for missing or non-secret resources', async () => {
    await txActorResourceCreate({ db }, {
      id: 'kv-one',
      kind: 'kv',
      name: 'KV one',
      status: 'ready',
    });

    const create = (resourceId: string, keyId: string, keyHex: string) => (
      txActorResourceEncryptionKeyGetOrCreate({ db }, {
        resourceId,
        keyId,
        purpose: 'actor-resource-secret-store',
        algorithm: 'aegis256',
        keyHex,
      })
    );

    await expect(create('secret-one', 'empty', '')).rejects.toThrow();
    await expect(create('secret-one', 'odd', 'a')).rejects.toThrow();
    await expect(create('secret-one', 'upper', 'AA')).rejects.toThrow();
    await expect(create('missing', 'missing-key', '11'.repeat(32))).rejects.toThrow();
    await expect(create('kv-one', 'kv-key', '11'.repeat(32))).rejects.toThrow();

    const keyCount = await (await db.prepare('SELECT COUNT(*) AS count FROM encryption_keys')).get();
    const linkCount = await (await db.prepare('SELECT COUNT(*) AS count FROM actor_resource_encryption_keys')).get();
    expect(Number(keyCount?.count)).toBe(0);
    expect(Number(linkCount?.count)).toBe(0);
  });
});
