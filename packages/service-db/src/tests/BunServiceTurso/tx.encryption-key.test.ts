import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connect, type Database } from '@tursodatabase/database';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_OSS_ORGANIZATION_ID } from '../../../src/CONSTANTS';
import { fxActorResourceEncryptionKeyGet } from '../../../src/DbServiceTurso/fx.encryption-key';
import {
  txActorResourceBeginDelete,
  txActorResourceCreate,
  txActorResourceDelete,
} from '../../../src/DbServiceTurso/tx.actor-resource';
import { txActorResourceEncryptionKeyGetOrCreate } from '../../../src/DbServiceTurso/tx.encryption-key';
import { txRunMigrations } from '../../../src/DbServiceTurso/tx.migrations';
import { EXPECTED_APPLICATION_TABLES } from '../../../src/schema/expected-schema';

const SECRET_ONE = '00000000-0000-4000-8000-000000000201';
const SECRET_SHARED = '00000000-0000-4000-8000-000000000202';
const KV_ONE = '00000000-0000-4000-8000-000000000203';
const KEY_ONE = '00000000-0000-4000-8000-000000000211';
const KEY_TWO = '00000000-0000-4000-8000-000000000212';

async function inMemoryDb(): Promise<Database> {
  // @ts-expect-error custom_types not typed yet
  return connect(':memory:', { experimental: ['custom_types', 'triggers', 'index_method'] });
}

async function migrate(db: Database): Promise<void> {
  await txRunMigrations({ db, Bun }, {
    applicationVersion: 'test',
    appliedAtMs: 1,
    expectedApplicationTables: EXPECTED_APPLICATION_TABLES,
  });
}

async function createSecretResource(db: Database, id: string): Promise<void> {
  await txActorResourceCreate({ db }, {
    id,
    kind: 'secretStore',
    name: `Secret ${id}`,
    status: 'ready',
  });
}

const keyArgs = (resourceId: string, keyId: string, keyHex = '11'.repeat(32)) => ({
  resourceId,
  keyId,
  purpose: 'actor-resource-secret-store',
  algorithm: 'aegis256',
  keyHex,
});

describe('tx.encryption-key/fx.encryption-key', () => {
  let db!: Database;

  beforeEach(async () => {
    db = await inMemoryDb();
    await migrate(db);
    await createSecretResource(db, SECRET_ONE);
  });

  afterEach(async () => {
    await db.close();
  });

  test('stores canonical key material while preserving the legacy outward model', async () => {
    const created = await txActorResourceEncryptionKeyGetOrCreate({ db }, keyArgs(SECRET_ONE, KEY_ONE));
    expect(created).toMatchObject({
      id: KEY_ONE,
      purpose: 'actor-resource-secret-store',
      algorithm: 'aegis256',
      key_hex: '11'.repeat(32),
    });
    await expect(fxActorResourceEncryptionKeyGet({ db }, { resourceId: SECRET_ONE })).resolves.toEqual(created);
    await expect(fxActorResourceEncryptionKeyGet({ db }, { resourceId: KEY_TWO })).resolves.toBeNull();

    const stored = await (await db.prepare(`
      SELECT resource_id, purpose, algorithm, lower(hex(key_material)) AS key_hex
      FROM resource_encryption_keys
      WHERE org_id = ?
    `)).get(DEFAULT_OSS_ORGANIZATION_ID);
    expect(stored).toEqual({
      resource_id: SECRET_ONE,
      purpose: 'resource-data',
      algorithm: 'aegis-256',
      key_hex: '11'.repeat(32),
    });
  });

  test('enforces canonical key constraints at the database boundary', async () => {
    await txActorResourceEncryptionKeyGetOrCreate({ db }, keyArgs(SECRET_ONE, KEY_ONE));
    await expect(db.exec(`
      UPDATE resource_encryption_keys
      SET key_material = X'22'
      WHERE org_id = '${DEFAULT_OSS_ORGANIZATION_ID}' AND id = '${KEY_ONE}'
    `)).rejects.toThrow();
    await expect(db.exec(`
      UPDATE resource_encryption_keys
      SET purpose = 'wrong'
      WHERE org_id = '${DEFAULT_OSS_ORGANIZATION_ID}' AND id = '${KEY_ONE}'
    `)).rejects.toThrow();
  });

  test('deletes the key atomically with its actor resource', async () => {
    await txActorResourceEncryptionKeyGetOrCreate({ db }, keyArgs(SECRET_ONE, KEY_ONE));
    await expect(txActorResourceDelete({ db }, { id: SECRET_ONE })).resolves.toBe(false);
    await txActorResourceBeginDelete({ db }, { id: SECRET_ONE });
    await expect(txActorResourceDelete({ db }, { id: SECRET_ONE })).resolves.toBe(true);
    await expect(fxActorResourceEncryptionKeyGet({ db }, { resourceId: SECRET_ONE })).resolves.toBeNull();
    const count = await (await db.prepare('SELECT COUNT(*) AS count FROM resource_encryption_keys')).get();
    expect(Number(count?.count)).toBe(0);
  });

  test('separate database connections converge on one resource key', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'vibecanvas-encryption-key-'));
    const databasePath = path.join(directory, 'shared.turso');
    // @ts-expect-error custom_types not typed yet
    const first = await connect(databasePath, { experimental: ['custom_types', 'triggers', 'index_method', 'multiprocess_wal'] });
    // @ts-expect-error custom_types not typed yet
    const second = await connect(databasePath, { experimental: ['custom_types', 'triggers', 'index_method', 'multiprocess_wal'] });
    try {
      await migrate(first);
      for (const connection of [first, second]) {
        await connection.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
      }
      await createSecretResource(first, SECRET_SHARED);

      const [one, two] = await Promise.all([
        txActorResourceEncryptionKeyGetOrCreate({ db: first }, keyArgs(SECRET_SHARED, KEY_ONE, '11'.repeat(32))),
        txActorResourceEncryptionKeyGetOrCreate({ db: second }, keyArgs(SECRET_SHARED, KEY_TWO, '22'.repeat(32))),
      ]);
      expect(one).toEqual(two);
      expect(['11'.repeat(32), '22'.repeat(32)]).toContain(one.key_hex);
      const count = await (await first.prepare('SELECT COUNT(*) AS count FROM resource_encryption_keys')).get();
      expect(Number(count?.count)).toBe(1);
    } finally {
      await Promise.allSettled([first.close(), second.close()]);
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('rejects malformed keys and missing or non-secret resources', async () => {
    await txActorResourceCreate({ db }, { id: KV_ONE, kind: 'kv', name: 'KV one', status: 'ready' });
    await expect(txActorResourceEncryptionKeyGetOrCreate({ db }, keyArgs(SECRET_ONE, KEY_ONE, ''))).rejects.toThrow();
    await expect(txActorResourceEncryptionKeyGetOrCreate({ db }, keyArgs(SECRET_ONE, KEY_ONE, 'a'))).rejects.toThrow();
    await expect(txActorResourceEncryptionKeyGetOrCreate({ db }, keyArgs(SECRET_ONE, KEY_ONE, 'AA'.repeat(32)))).rejects.toThrow();
    await expect(txActorResourceEncryptionKeyGetOrCreate({ db }, keyArgs(KEY_TWO, KEY_ONE))).rejects.toThrow();
    await expect(txActorResourceEncryptionKeyGetOrCreate({ db }, keyArgs(KV_ONE, KEY_ONE))).rejects.toThrow();
    const count = await (await db.prepare('SELECT COUNT(*) AS count FROM resource_encryption_keys')).get();
    expect(Number(count?.count)).toBe(0);
  });
});
