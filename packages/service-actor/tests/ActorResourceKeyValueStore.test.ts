import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '@vibecanvas/service-db/DbServiceTurso/turso-native';
import {
  ActorResourceKeyValueStore,
  type TActorResourceKeyValueDatabaseFactory,
  type TSecretStoreConversionCheckpoint,
} from '../src/resources/ActorResourceKeyValueStore';
import { SecretStoreResource } from '../src/resources/SecretStoreResource';
import type {
  IActorResourceKeyValuePersistence,
  TActorResourceKeyValueEntry,
  TActorResourceKeyValueEntryMetadata,
} from '../src/resources/ActorResourceKeyValuePersistence';
import type { TActorResolvedResourceCall } from '../src/resources/resource-types';
import { testSecretStoreDatabaseHexKey, testSecretStoreKeyProvider } from './test-secret-store-key-provider';

describe('ActorResourceKeyValueStore', () => {
  let rootDir = '';
  const stores: ActorResourceKeyValueStore[] = [];

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'vibecanvas-actor-resource-kv-store-'));
  });

  afterEach(async () => {
    await Promise.allSettled(stores.splice(0).map((store) => store.close()));
    await rm(rootDir, { recursive: true, force: true });
  });

  function store(kind: 'kv' | 'secretStore', options: {
    maxOpenHandles?: number;
    databaseFactory?: TActorResourceKeyValueDatabaseFactory;
    secretStoreConversionCheckpoint?: (
      checkpoint: TSecretStoreConversionCheckpoint,
      resourceId: string,
    ) => void | Promise<void>;
  } = {}) {
    const value = new ActorResourceKeyValueStore({
      dataRoot: rootDir,
      kind,
      ...(kind === 'secretStore' ? { secretStoreKeyProvider: testSecretStoreKeyProvider } : {}),
      ...options,
    });
    stores.push(value);
    return value;
  }

  async function createLegacySecretDatabase(args: {
    resourceId: string;
    value: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
  }): Promise<void> {
    const legacy = store('kv');
    await legacy.provision({ resourceId: args.resourceId, kind: 'kv' });
    for (let revision = 0; revision < args.revision; revision += 1) {
      await legacy.set({ resourceId: args.resourceId, key: 'token', value: args.value });
    }
    await legacy.close();
    const kvDirectory = join(rootDir, 'actor-resources', 'kv', args.resourceId);
    const database = new Database(join(kvDirectory, 'data.db'), { fileMustExist: true });
    await database.connect();
    try {
      await (await database.prepare(`
        UPDATE _vibecanvas_resource_metadata
        SET resource_kind = 'secretStore'
      `)).run();
      await (await database.prepare(`
        UPDATE actor_resource_entries
        SET created_at = ?, updated_at = ?
      `)).run(args.createdAt, args.updatedAt);
      await database.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } finally {
      await database.close();
    }
    await mkdir(join(rootDir, 'actor-resources', 'secret-store'), { recursive: true });
    await rename(kvDirectory, join(rootDir, 'actor-resources', 'secret-store', args.resourceId));
  }

  async function moveDatabaseArtifacts(fromPath: string, toPath: string): Promise<void> {
    await rename(fromPath, toPath);
    for (const suffix of ['-wal', '-shm', '-tshm']) {
      await rename(`${fromPath}${suffix}`, `${toPath}${suffix}`).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
    }
  }

  async function copyDatabaseArtifacts(fromPath: string, toPath: string): Promise<void> {
    await copyFile(fromPath, toPath);
    for (const suffix of ['-wal', '-shm', '-tshm']) {
      await copyFile(`${fromPath}${suffix}`, `${toPath}${suffix}`).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
    }
  }

  test('provisions exact kind paths and rejects unsafe or mismatched identities', async () => {
    const kv = store('kv');
    const secrets = store('secretStore');
    await kv.provision({ resourceId: 'kv-safe_1', kind: 'kv' });
    await secrets.provision({ resourceId: 'secret-safe_1', kind: 'secretStore' });

    expect((await stat(join(rootDir, 'actor-resources', 'kv', 'kv-safe_1', 'data.db'))).isFile()).toBe(true);
    expect((await stat(join(rootDir, 'actor-resources', 'secret-store', 'secret-safe_1', 'data.db'))).isFile()).toBe(true);

    for (const [databasePath, encryption] of [
      [join(rootDir, 'actor-resources', 'kv', 'kv-safe_1', 'data.db'), undefined],
      [
        join(rootDir, 'actor-resources', 'secret-store', 'secret-safe_1', 'data.db'),
        { cipher: 'aegis256' as const, hexkey: testSecretStoreDatabaseHexKey('secret-safe_1') },
      ],
    ] as const) {
      const database = new Database(databasePath, {
        fileMustExist: true,
        ...(encryption ? { encryption } : {}),
        // @ts-expect-error Turso runtime features are ahead of its public union.
        experimental: ['custom_types', 'strict'],
      });
      await database.connect();
      try {
        const columns = await (await database.prepare('PRAGMA table_info(actor_resource_entries);')).all();
        expect(columns.find((column) => column.name === 'value')).toMatchObject({
          type: 'JSON',
          notnull: 1,
        });
        await expect((await database.prepare(`
          INSERT INTO actor_resource_entries (key, value)
          VALUES ('invalid-json', 'not-json')
        `)).run()).rejects.toBeInstanceOf(Error);
      } finally {
        await database.close();
      }
    }

    await expect(kv.provision({ resourceId: '../escape', kind: 'kv' })).rejects.toBeInstanceOf(TypeError);
    await expect(kv.provision({ resourceId: 'wrong-kind', kind: 'secretStore' })).rejects.toBeInstanceOf(TypeError);
  });

  test('encrypts secret database and WAL bytes while leaving KV options unencrypted', async () => {
    const openedOptions: {
      kind: 'kv' | 'secretStore';
      options: NonNullable<ConstructorParameters<typeof Database>[1]>;
    }[] = [];
    const capturingFactory = (kind: 'kv' | 'secretStore'): TActorResourceKeyValueDatabaseFactory => (databasePath, options) => {
      openedOptions.push({ kind, options: options! });
      return new Database(databasePath, options);
    };
    const kv = store('kv', { databaseFactory: capturingFactory('kv') });
    const secrets = store('secretStore', { databaseFactory: capturingFactory('secretStore') });
    await kv.provision({ resourceId: 'plain-kv', kind: 'kv' });
    await kv.set({ resourceId: 'plain-kv', key: 'token', value: 'ordinary-kv-sentinel' });
    await secrets.provision({ resourceId: 'encrypted-secret', kind: 'secretStore' });
    const sentinel = 'secret-at-rest-sentinel-9f7c';
    await secrets.set({ resourceId: 'encrypted-secret', key: 'token', value: sentinel });
    await secrets.set({ resourceId: 'encrypted-secret', key: 'token', value: sentinel });
    const directory = join(rootDir, 'actor-resources', 'secret-store', 'encrypted-secret');
    const liveSidecars = (await readdir(directory)).filter((name) => name !== 'data.db' && name.startsWith('data.db'));
    expect(liveSidecars.length).toBeGreaterThan(0);
    expect(liveSidecars).toContain('data.db-wal');
    const liveWal = await readFile(join(directory, 'data.db-wal'));
    expect(liveWal.length).toBeGreaterThan(0);
    expect(liveWal.includes(Buffer.from(sentinel))).toBe(false);
    const liveSidecarSizes = await Promise.all(liveSidecars.map(async (file) => (
      await stat(join(directory, file))
    ).size));
    expect(liveSidecarSizes.some((size) => size > 0)).toBe(true);
    for (const file of liveSidecars) {
      expect((await readFile(join(directory, file))).includes(Buffer.from(sentinel))).toBe(false);
    }
    await kv.close();
    await secrets.close();

    expect(openedOptions.filter((entry) => entry.kind === 'kv').every((entry) => !entry.options.encryption)).toBe(true);
    expect(openedOptions.filter((entry) => entry.kind === 'secretStore').every((entry) => (
      entry.options.encryption?.cipher === 'aegis256'
      && entry.options.encryption.hexkey === testSecretStoreDatabaseHexKey('encrypted-secret')
    ))).toBe(true);

    const files = (await readdir(directory)).filter((name) => name.startsWith('data.db'));
    for (const file of files) {
      expect((await readFile(join(directory, file))).includes(Buffer.from(sentinel))).toBe(false);
    }
    expect((await readFile(join(directory, 'data.db'))).subarray(0, 6).toString('ascii')).toBe('Turso\0');

    for (const encryption of [
      undefined,
      { cipher: 'aegis256' as const, hexkey: '00'.repeat(32) },
    ]) {
      const database = new Database(join(directory, 'data.db'), {
        fileMustExist: true,
        ...(encryption ? { encryption } : {}),
      });
      await expect((async () => {
        await database.connect();
        await (await database.prepare('SELECT value FROM actor_resource_entries')).all();
      })()).rejects.toBeInstanceOf(Error);
      await database.close().catch(() => undefined);
    }
  });

  test('converts plaintext-v1 through encrypted-v2 without changing values, revisions, or timestamps', async () => {
    const expected = {
      resourceId: 'legacy-secret',
      value: 'legacy-plaintext-sentinel',
      revision: 7,
      createdAt: '2020-01-02T03:04:05.006Z',
      updatedAt: '2021-02-03T04:05:06.007Z',
    };
    await createLegacySecretDatabase(expected);
    const secrets = store('secretStore');
    await secrets.verify({ resourceId: expected.resourceId, kind: 'secretStore' });
    expect(await secrets.get({ resourceId: expected.resourceId, key: 'token' })).toEqual({
      key: 'token',
      value: expected.value,
      revision: expected.revision,
      createdAt: expected.createdAt,
      updatedAt: expected.updatedAt,
    });
    await secrets.close();

    const directory = join(rootDir, 'actor-resources', 'secret-store', expected.resourceId);
    expect((await readFile(join(directory, 'data.db'))).subarray(0, 6).toString('ascii')).toBe('Turso\0');
    expect((await readdir(directory)).some((name) => name.includes('.tmp') || name.includes('.recovery'))).toBe(false);
    const database = new Database(join(directory, 'data.db'), {
      fileMustExist: true,
      encryption: { cipher: 'aegis256', hexkey: testSecretStoreDatabaseHexKey(expected.resourceId) },
    });
    await database.connect();
    expect(await (await database.prepare('SELECT format_version FROM _vibecanvas_resource_metadata')).get())
      .toEqual({ format_version: 2 });
    await database.close();
  });

  test('recovers safely from faults at every conversion lifecycle checkpoint', async () => {
    const checkpoints: readonly TSecretStoreConversionCheckpoint[] = [
      'temporary-created',
      'entries-copied',
      'temporary-checkpointed',
      'temporary-verified',
      'source-closed',
      'plaintext-renamed',
      'encrypted-renamed',
      'final-reopened',
      'before-recovery-cleanup',
    ];
    for (const [index, checkpoint] of checkpoints.entries()) {
      const resourceId = `fault-${index}`;
      const value = `fault-sentinel-${checkpoint}`;
      await createLegacySecretDatabase({
        resourceId,
        value,
        revision: 2,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-02T00:00:00.000Z',
      });
      let injected = false;
      const interrupted = store('secretStore', {
        secretStoreConversionCheckpoint(current, currentResourceId) {
          if (!injected && current === checkpoint && currentResourceId === resourceId) {
            injected = true;
            throw new Error(`injected conversion fault: ${checkpoint}`);
          }
        },
      });
      await expect(interrupted.verify({ resourceId, kind: 'secretStore' }))
        .rejects.toThrow(`injected conversion fault: ${checkpoint}`);
      expect(injected).toBe(true);

      const directory = join(rootDir, 'actor-resources', 'secret-store', resourceId);
      const migrationFiles = await readdir(directory);
      expect(migrationFiles.some((name) => (
        name === 'data.db'
        || name === 'data.db.encryption-v2.tmp'
        || name === 'data.db.plaintext-v1.recovery'
      ))).toBe(true);

      const restarted = store('secretStore');
      await restarted.verify({ resourceId, kind: 'secretStore' });
      expect(await restarted.get({ resourceId, key: 'token' })).toEqual({
        key: 'token',
        value,
        revision: 2,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-02T00:00:00.000Z',
      });
      expect((await readdir(directory)).some((name) => name.includes('.tmp') || name.includes('.recovery'))).toBe(false);
    }
  });

  test('serializes concurrent verification under one resource lifecycle lock', async () => {
    await createLegacySecretDatabase({
      resourceId: 'concurrent-verify',
      value: 'concurrent-conversion-value',
      revision: 4,
      createdAt: '2025-02-01T00:00:00.000Z',
      updatedAt: '2025-02-02T00:00:00.000Z',
    });
    let releaseConversion!: () => void;
    let markConversionReached!: () => void;
    const conversionGate = new Promise<void>((resolve) => { releaseConversion = resolve; });
    const conversionReached = new Promise<void>((resolve) => { markConversionReached = resolve; });
    let conversionStarts = 0;
    const secrets = store('secretStore', {
      async secretStoreConversionCheckpoint(checkpoint, resourceId) {
        if (checkpoint !== 'temporary-created' || resourceId !== 'concurrent-verify') return;
        conversionStarts += 1;
        markConversionReached();
        await conversionGate;
      },
    });

    const first = secrets.verify({ resourceId: 'concurrent-verify', kind: 'secretStore' });
    await conversionReached;
    const second = secrets.verify({ resourceId: 'concurrent-verify', kind: 'secretStore' });
    await Promise.resolve();
    expect(conversionStarts).toBe(1);
    await expect(secrets.get({ resourceId: 'concurrent-verify', key: 'token' }))
      .rejects.toThrow('unavailable during lifecycle work');
    releaseConversion();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(conversionStarts).toBe(1);
    expect(await secrets.get({ resourceId: 'concurrent-verify', key: 'token' })).toMatchObject({
      value: 'concurrent-conversion-value',
      revision: 4,
    });
  });

  test('recovers interrupted swap states without guessing or deleting the only valid copy', async () => {
    await createLegacySecretDatabase({
      resourceId: 'recovery-only',
      value: 'recovered-legacy-value',
      revision: 2,
      createdAt: '2022-01-01T00:00:00.000Z',
      updatedAt: '2022-01-02T00:00:00.000Z',
    });
    const recoveryBase = join(rootDir, 'actor-resources', 'secret-store', 'recovery-only', 'data.db');
    await moveDatabaseArtifacts(recoveryBase, `${recoveryBase}.plaintext-v1.recovery`);
    const recoveryStore = store('secretStore');
    await recoveryStore.verify({ resourceId: 'recovery-only', kind: 'secretStore' });
    expect(await recoveryStore.get({ resourceId: 'recovery-only', key: 'token' }))
      .toMatchObject({ value: 'recovered-legacy-value', revision: 2 });

    await createLegacySecretDatabase({
      resourceId: 'temporary-with-recovery',
      value: 'promoted-encrypted-value',
      revision: 3,
      createdAt: '2023-01-01T00:00:00.000Z',
      updatedAt: '2023-01-03T00:00:00.000Z',
    });
    const temporaryBase = join(rootDir, 'actor-resources', 'secret-store', 'temporary-with-recovery', 'data.db');
    const plaintextBackup = `${temporaryBase}.test-plaintext-backup`;
    await copyDatabaseArtifacts(temporaryBase, plaintextBackup);
    const converter = store('secretStore');
    await converter.verify({ resourceId: 'temporary-with-recovery', kind: 'secretStore' });
    await converter.close();
    await moveDatabaseArtifacts(temporaryBase, `${temporaryBase}.encryption-v2.tmp`);
    await moveDatabaseArtifacts(plaintextBackup, `${temporaryBase}.plaintext-v1.recovery`);
    const promotionStore = store('secretStore');
    await promotionStore.verify({ resourceId: 'temporary-with-recovery', kind: 'secretStore' });
    expect(await promotionStore.get({ resourceId: 'temporary-with-recovery', key: 'token' }))
      .toMatchObject({ value: 'promoted-encrypted-value', revision: 3 });
  });

  test('fails closed for an encrypted temporary without recovery and for final/recovery mismatch', async () => {
    const orphan = store('secretStore');
    await orphan.provision({ resourceId: 'orphan-temporary', kind: 'secretStore' });
    await orphan.set({ resourceId: 'orphan-temporary', key: 'token', value: 'unproven-temporary' });
    await orphan.close();
    const orphanBase = join(rootDir, 'actor-resources', 'secret-store', 'orphan-temporary', 'data.db');
    await moveDatabaseArtifacts(orphanBase, `${orphanBase}.encryption-v2.tmp`);
    const orphanRecovery = store('secretStore');
    await expect(orphanRecovery.verify({ resourceId: 'orphan-temporary', kind: 'secretStore' }))
      .rejects.toMatchObject({ code: 'SECRET_STORE_DECRYPTION_FAILED' });
    expect(await stat(orphanBase).catch(() => null)).toBeNull();
    expect((await stat(`${orphanBase}.encryption-v2.tmp`)).isFile()).toBe(true);

    const authoritative = store('secretStore');
    await authoritative.provision({ resourceId: 'mismatch-final', kind: 'secretStore' });
    await authoritative.set({ resourceId: 'mismatch-final', key: 'token', value: 'authoritative-value' });
    await authoritative.close();
    await createLegacySecretDatabase({
      resourceId: 'mismatch-source',
      value: 'different-recovery-value',
      revision: 1,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    const sourceBase = join(rootDir, 'actor-resources', 'secret-store', 'mismatch-source', 'data.db');
    const source = new Database(sourceBase, { fileMustExist: true });
    await source.connect();
    await (await source.prepare('UPDATE _vibecanvas_resource_metadata SET resource_id = ?')).run('mismatch-final');
    await source.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    await source.close();
    const mismatchBase = join(rootDir, 'actor-resources', 'secret-store', 'mismatch-final', 'data.db');
    await moveDatabaseArtifacts(sourceBase, `${mismatchBase}.plaintext-v1.recovery`);
    const mismatch = store('secretStore');
    await expect(mismatch.verify({ resourceId: 'mismatch-final', kind: 'secretStore' }))
      .rejects.toMatchObject({ code: 'SECRET_STORE_DECRYPTION_FAILED' });
    expect((await stat(`${mismatchBase}.plaintext-v1.recovery`)).isFile()).toBe(true);
    const correct = new Database(mismatchBase, {
      fileMustExist: true,
      encryption: { cipher: 'aegis256', hexkey: testSecretStoreDatabaseHexKey('mismatch-final') },
    });
    await correct.connect();
    expect(await (await correct.prepare('SELECT value FROM actor_resource_entries WHERE key = ?')).get('token'))
      .toEqual({ value: JSON.stringify('authoritative-value') });
    await correct.close();
  });

  test('rejects a legacy candidate with a same-named but weakened trigger before conversion', async () => {
    await createLegacySecretDatabase({
      resourceId: 'weakened-schema',
      value: 'schema-tamper-sentinel',
      revision: 1,
      createdAt: '2024-03-01T00:00:00.000Z',
      updatedAt: '2024-03-01T00:00:00.000Z',
    });
    const databasePath = join(rootDir, 'actor-resources', 'secret-store', 'weakened-schema', 'data.db');
    const database = new Database(databasePath, { fileMustExist: true });
    await database.connect();
    await database.exec(`
      DROP TRIGGER actor_resource_entries_updated_at_after_update;
      CREATE TRIGGER actor_resource_entries_updated_at_after_update
      AFTER UPDATE OF value, revision ON actor_resource_entries
      BEGIN
        SELECT 1;
      END;
      PRAGMA wal_checkpoint(TRUNCATE);
    `);
    await database.close();

    const secrets = store('secretStore');
    await expect(secrets.verify({ resourceId: 'weakened-schema', kind: 'secretStore' }))
      .rejects.toMatchObject({ code: 'SECRET_STORE_DECRYPTION_FAILED' });
    expect((await readFile(databasePath)).subarray(0, 16).toString('ascii')).toBe('SQLite format 3\0');
    expect(await stat(`${databasePath}.encryption-v2.tmp`).catch(() => null)).toBeNull();
    expect(await stat(`${databasePath}.plaintext-v1.recovery`).catch(() => null)).toBeNull();
  });

  test('reports a stable decryption failure and never replaces a wrong-key encrypted file', async () => {
    const secrets = store('secretStore');
    await secrets.provision({ resourceId: 'wrong-key', kind: 'secretStore' });
    await secrets.set({ resourceId: 'wrong-key', key: 'token', value: 'must-remain-encrypted' });
    await secrets.close();
    const databasePath = join(rootDir, 'actor-resources', 'secret-store', 'wrong-key', 'data.db');
    const before = await readFile(databasePath);

    const wrongKeyStore = new ActorResourceKeyValueStore({
      dataRoot: rootDir,
      kind: 'secretStore',
      secretStoreKeyProvider: { getDatabaseHexKey: async () => '00'.repeat(32) },
    });
    stores.push(wrongKeyStore);
    await expect(wrongKeyStore.verify({ resourceId: 'wrong-key', kind: 'secretStore' })).rejects.toMatchObject({
      code: 'SECRET_STORE_DECRYPTION_FAILED',
      message: 'The secret-store database could not be decrypted or verified.',
    });
    expect(await readFile(databasePath)).toEqual(before);
    expect((await readdir(join(rootDir, 'actor-resources', 'secret-store', 'wrong-key')))
      .some((name) => name.includes('.recovery'))).toBe(false);
  });

  test('persists every JSON family, stored null, isolation, revisions, and timestamps across restart', async () => {
    const first = store('kv');
    await first.provision({ resourceId: 'one', kind: 'kv' });
    await first.provision({ resourceId: 'two', kind: 'kv' });
    const values = [null, 'text', 42, true, [1, 'two', null], { nested: { ok: true } }] as const;
    for (const [index, value] of values.entries()) {
      await first.set({ resourceId: 'one', key: `key-${index}`, value });
    }
    expect(await first.get({ resourceId: 'one', key: 'key-0' })).toMatchObject({ value: null, revision: 1 });
    expect(await first.get({ resourceId: 'one', key: 'missing' })).toBeNull();

    const created = await first.set({ resourceId: 'one', key: 'shared', value: 'one-v1' });
    const updated = await first.set({ resourceId: 'one', key: 'shared', value: 'one-v2' });
    await first.set({ resourceId: 'two', key: 'shared', value: 'two-v1' });
    expect(updated).toMatchObject({ value: 'one-v2', revision: 2, createdAt: created.createdAt });
    expect(updated.updatedAt).not.toBe(created.updatedAt);
    expect(await first.get({ resourceId: 'two', key: 'shared' })).toMatchObject({ value: 'two-v1', revision: 1 });

    await first.close();
    const reopened = store('kv');
    await reopened.verify({ resourceId: 'one', kind: 'kv' });
    expect(await reopened.get({ resourceId: 'one', key: 'shared' })).toMatchObject({ value: 'one-v2', revision: 2 });
  });

  test('projects secret metadata without selecting or materializing plaintext values', async () => {
    const preparedSql: string[] = [];
    const capturingFactory: TActorResourceKeyValueDatabaseFactory = (databasePath, options) => {
      const database = new Database(databasePath, options);
      const prepare = database.prepare.bind(database);
      database.prepare = async (...args) => {
        preparedSql.push(String(args[0]));
        return prepare(...args);
      };
      return database;
    };
    const secrets = store('secretStore', { databaseFactory: capturingFactory });
    await secrets.provision({ resourceId: 'metadata-only', kind: 'secretStore' });
    const sentinel = 'metadata-projection-plaintext-sentinel';
    const written = await secrets.set({ resourceId: 'metadata-only', key: 'token', value: sentinel });

    preparedSql.length = 0;
    const entry = await secrets.getMetadata({ resourceId: 'metadata-only', key: 'token' });
    const page = await secrets.listMetadata({ resourceId: 'metadata-only', limit: 10 });
    const entryQueries = preparedSql
      .map((sql) => sql.replace(/\s+/g, ' ').trim())
      .filter((sql) => sql.includes('FROM actor_resource_entries'));

    expect(entryQueries).toHaveLength(2);
    expect(entryQueries.every((sql) => !/\bvalue\b/i.test(sql))).toBe(true);
    expect(entry).toEqual({
      key: written.key,
      revision: written.revision,
      createdAt: written.createdAt,
      updatedAt: written.updatedAt,
    });
    if (!entry) throw new Error('Expected persisted secret metadata.');
    expect(page).toEqual({ entries: [entry], nextCursor: null });
    expect(Object.hasOwn(entry, 'value')).toBe(false);
    expect(page.entries.some((item) => Object.hasOwn(item, 'value'))).toBe(false);
    expect(JSON.stringify({ entry, page })).not.toContain(sentinel);
  });

  test('routes secret management metadata through value-free persistence while actor get and reveal use full reads', async () => {
    const calls: string[] = [];
    const entry: TActorResourceKeyValueEntry = {
      key: 'token',
      value: 'authorized-plaintext',
      revision: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };
    const metadata: TActorResourceKeyValueEntryMetadata = {
      key: entry.key,
      revision: entry.revision,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
    const persistence: IActorResourceKeyValuePersistence = {
      async provision() {},
      async verify() {},
      async deleteResource() {},
      async get() { calls.push('get'); return entry; },
      async getMetadata() { calls.push('getMetadata'); return metadata; },
      async has() { return true; },
      async count() { return 1; },
      async list() { calls.push('list'); return { entries: [entry], nextCursor: null }; },
      async listMetadata() { calls.push('listMetadata'); return { entries: [metadata], nextCursor: null }; },
      async set() { return entry; },
      async delete() { return { deleted: true }; },
      async compareAndSet() { return { ok: true, entry }; },
      async close() {},
    };
    const resource = new SecretStoreResource(persistence);

    expect(await resource.getEntryMetadata({ resourceId: 'secret-1', name: 'token' })).toEqual(metadata);
    expect(await resource.listEntries({ resourceId: 'secret-1' })).toEqual({ entries: [metadata], nextCursor: null });
    expect(calls).toEqual(['getMetadata', 'listMetadata']);

    expect(await resource.revealEntry({ resourceId: 'secret-1', name: 'token' })).toEqual({
      key: 'token',
      value: 'authorized-plaintext',
      revision: 3,
    });
    const actorContext = {
      resource: { id: 'secret-1', kind: 'secretStore' },
      requirement: { kind: 'secretStore' },
    } as TActorResolvedResourceCall;
    expect(await resource.dispatch(actorContext, 'get', { name: 'token' })).toEqual({
      value: 'authorized-plaintext',
      revision: 3,
    });
    expect(calls).toEqual(['getMetadata', 'listMetadata', 'get', 'get']);
  });

  test('uses literal prefix/search filters and bounded ordered cursor pages', async () => {
    const kv = store('kv');
    await kv.provision({ resourceId: 'filters', kind: 'kv' });
    for (const key of ['plain', 'todo%1', 'todo%2', 'todo_3', 'todoX4']) {
      await kv.set({ resourceId: 'filters', key, value: key });
    }

    const first = await kv.list({ resourceId: 'filters', prefix: 'todo%', limit: 1 });
    expect(first.entries.map((entry) => entry.key)).toEqual(['todo%1']);
    expect(first.nextCursor).toBe('todo%1');
    const second = await kv.list({ resourceId: 'filters', prefix: 'todo%', cursor: first.nextCursor!, limit: 2 });
    expect(second.entries.map((entry) => entry.key)).toEqual(['todo%2']);
    expect(second.nextCursor).toBeNull();
    expect(await kv.count({ resourceId: 'filters' })).toBe(5);
    expect(await kv.count({ resourceId: 'filters', prefix: 'todo%' })).toBe(2);
    expect(await kv.count({ resourceId: 'filters', search: '%' })).toBe(2);
    expect(await kv.list({ resourceId: 'filters', search: '_', limit: 10 })).toMatchObject({
      entries: [{ key: 'todo_3' }],
      nextCursor: null,
    });
    await expect(kv.list({ resourceId: 'filters', limit: 501 })).rejects.toBeInstanceOf(RangeError);
  });

  test('implements atomic create/update CAS and expected-revision deletion', async () => {
    const kv = store('kv');
    await kv.provision({ resourceId: 'cas', kind: 'kv' });
    expect(await kv.compareAndSet({ resourceId: 'cas', key: 'counter', expectedRevision: null, value: 1 }))
      .toMatchObject({ ok: true, entry: { value: 1, revision: 1 } });
    expect(await kv.compareAndSet({ resourceId: 'cas', key: 'counter', expectedRevision: null, value: 2 }))
      .toEqual({ ok: false, expectedRevision: null, currentRevision: 1 });

    const concurrent = await Promise.all([
      kv.compareAndSet({ resourceId: 'cas', key: 'counter', expectedRevision: 1, value: 2 }),
      kv.compareAndSet({ resourceId: 'cas', key: 'counter', expectedRevision: 1, value: 3 }),
    ]);
    expect(concurrent.filter((result) => result.ok)).toHaveLength(1);
    expect(concurrent.filter((result) => !result.ok)).toHaveLength(1);
    expect(await kv.delete({ resourceId: 'cas', key: 'counter', expectedRevision: 1 })).toEqual({ deleted: false });
    expect(await kv.delete({ resourceId: 'cas', key: 'counter', expectedRevision: 2 })).toEqual({ deleted: true });
  });

  test('rejects missing, corrupt, and kind-swapped files without recreating them', async () => {
    const kv = store('kv');
    const secrets = store('secretStore');
    await kv.provision({ resourceId: 'missing', kind: 'kv' });
    await kv.provision({ resourceId: 'corrupt', kind: 'kv' });
    await kv.provision({ resourceId: 'swapped-kv', kind: 'kv' });
    await kv.provision({ resourceId: 'swapped-id-source', kind: 'kv' });
    await kv.provision({ resourceId: 'swapped-id-target', kind: 'kv' });
    await kv.provision({ resourceId: 'unsupported', kind: 'kv' });
    await secrets.provision({ resourceId: 'swapped-secret', kind: 'secretStore' });
    await kv.close();
    await secrets.close();

    const missingPath = join(rootDir, 'actor-resources', 'kv', 'missing', 'data.db');
    await rm(missingPath);
    const corruptPath = join(rootDir, 'actor-resources', 'kv', 'corrupt', 'data.db');
    await writeFile(corruptPath, 'not a database');
    const kvPath = join(rootDir, 'actor-resources', 'kv', 'swapped-kv', 'data.db');
    const secretPath = join(rootDir, 'actor-resources', 'secret-store', 'swapped-secret', 'data.db');
    await rm(`${secretPath}-wal`, { force: true });
    await rm(`${secretPath}-shm`, { force: true });
    await copyFile(kvPath, secretPath);
    const idSourcePath = join(rootDir, 'actor-resources', 'kv', 'swapped-id-source', 'data.db');
    const idTargetPath = join(rootDir, 'actor-resources', 'kv', 'swapped-id-target', 'data.db');
    await rm(`${idTargetPath}-wal`, { force: true });
    await rm(`${idTargetPath}-shm`, { force: true });
    await copyFile(idSourcePath, idTargetPath);
    const unsupportedPath = join(rootDir, 'actor-resources', 'kv', 'unsupported', 'data.db');
    const unsupported = new Database(unsupportedPath, { fileMustExist: true });
    await unsupported.connect();
    await (await unsupported.prepare('UPDATE _vibecanvas_resource_metadata SET format_version = 2')).run();
    await unsupported.close();

    const kvReopened = store('kv');
    const secretsReopened = store('secretStore');
    await expect(kvReopened.verify({ resourceId: 'missing', kind: 'kv' })).rejects.toBeInstanceOf(Error);
    await expect(kvReopened.verify({ resourceId: 'corrupt', kind: 'kv' })).rejects.toBeInstanceOf(Error);
    await expect(secretsReopened.verify({ resourceId: 'swapped-secret', kind: 'secretStore' })).rejects.toBeInstanceOf(Error);
    await expect(kvReopened.verify({ resourceId: 'swapped-id-target', kind: 'kv' })).rejects.toBeInstanceOf(Error);
    await expect(kvReopened.verify({ resourceId: 'unsupported', kind: 'kv' })).rejects.toBeInstanceOf(Error);
    expect(await stat(missingPath).catch(() => null)).toBeNull();
  });

  test('cleans failed provisioning without deleting pre-existing or sibling directories', async () => {
    const sibling = join(rootDir, 'actor-resources', 'kv', 'sibling');
    const existing = join(rootDir, 'actor-resources', 'kv', 'existing');
    await mkdir(sibling, { recursive: true });
    await writeFile(join(sibling, 'keep.txt'), 'keep');
    await mkdir(existing, { recursive: true });
    await writeFile(join(existing, 'unknown.txt'), 'unknown');

    const failingFactory: TActorResourceKeyValueDatabaseFactory = (databasePath, options) => {
      const database = new Database(databasePath, options);
      if (databasePath.includes('/failed/')) {
        database.connect = async () => { throw new Error('injected provisioning failure'); };
      }
      return database;
    };
    const kv = store('kv', { databaseFactory: failingFactory });
    await expect(kv.provision({ resourceId: 'failed', kind: 'kv' })).rejects.toThrow('injected provisioning failure');
    await expect(kv.provision({ resourceId: 'existing', kind: 'kv' })).rejects.toBeInstanceOf(Error);
    expect(await Bun.file(join(sibling, 'keep.txt')).text()).toBe('keep');
    expect(await Bun.file(join(existing, 'unknown.txt')).text()).toBe('unknown');
    expect(await stat(join(rootDir, 'actor-resources', 'kv', 'failed')).catch(() => null)).toBeNull();
  });

  test('bounds lazy handles with idle LRU eviction', async () => {
    const kv = store('kv', { maxOpenHandles: 2 });
    for (const resourceId of ['one', 'two', 'three']) {
      await kv.provision({ resourceId, kind: 'kv' });
      await kv.set({ resourceId, key: 'value', value: resourceId });
    }
    expect(kv.openHandleCount).toBeLessThanOrEqual(2);
    expect(await kv.get({ resourceId: 'one', key: 'value' })).toMatchObject({ value: 'one' });
    expect(kv.openHandleCount).toBeLessThanOrEqual(2);
  });

  test('drains accepted running and queued writes before closing handles', async () => {
    let releaseWrite!: () => void;
    let markWriteStarted!: () => void;
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const writeStarted = new Promise<void>((resolve) => { markWriteStarted = resolve; });
    let heldWrite = false;
    const factory: TActorResourceKeyValueDatabaseFactory = (databasePath, options) => {
      const database = new Database(databasePath, options);
      const prepare = database.prepare.bind(database);
      database.prepare = async (...args) => {
        const statement = await prepare(...args);
        if (!heldWrite && String(args[0]).includes('INSERT INTO actor_resource_entries (key, value)')) {
          const run = statement.run.bind(statement);
          statement.run = async (...runArgs) => {
            heldWrite = true;
            markWriteStarted();
            await writeGate;
            return run(...runArgs);
          };
        }
        return statement;
      };
      return database;
    };
    const kv = store('kv', { databaseFactory: factory });
    await kv.provision({ resourceId: 'close-drain', kind: 'kv' });

    const first = kv.set({ resourceId: 'close-drain', key: 'first', value: 1 });
    const second = kv.set({ resourceId: 'close-drain', key: 'second', value: 2 });
    await writeStarted;
    const closing = kv.close();
    await expect(kv.get({ resourceId: 'close-drain', key: 'late' })).rejects.toThrow('closed');
    releaseWrite();

    await expect(first).resolves.toMatchObject({ key: 'first', value: 1, revision: 1 });
    await expect(second).resolves.toMatchObject({ key: 'second', value: 2, revision: 1 });
    await closing;

    const reopened = store('kv');
    await reopened.verify({ resourceId: 'close-drain', kind: 'kv' });
    await expect(reopened.get({ resourceId: 'close-drain', key: 'first' })).resolves.toMatchObject({ value: 1 });
    await expect(reopened.get({ resourceId: 'close-drain', key: 'second' })).resolves.toMatchObject({ value: 2 });
  });

  test('shutdown closes every handle even when one close fails', async () => {
    let injectCloseFailure = false;
    const closeAttempts: string[] = [];
    const factory: TActorResourceKeyValueDatabaseFactory = (databasePath, options) => {
      const database = new Database(databasePath, options);
      const close = database.close.bind(database);
      database.close = async () => {
        closeAttempts.push(databasePath);
        await close();
        if (injectCloseFailure && databasePath.includes('/bad/')) throw new Error('injected close failure');
      };
      return database;
    };
    const kv = store('kv', { databaseFactory: factory, maxOpenHandles: 4 });
    await kv.provision({ resourceId: 'bad', kind: 'kv' });
    await kv.provision({ resourceId: 'good', kind: 'kv' });
    await kv.get({ resourceId: 'bad', key: 'none' });
    await kv.get({ resourceId: 'good', key: 'none' });
    closeAttempts.length = 0;
    injectCloseFailure = true;

    await expect(kv.close()).rejects.toBeInstanceOf(AggregateError);
    expect(closeAttempts.some((path) => path.includes('/bad/'))).toBe(true);
    expect(closeAttempts.some((path) => path.includes('/good/'))).toBe(true);
    expect(closeAttempts.filter((path) => path.includes('/bad/')).length).toBeGreaterThanOrEqual(2);
    expect(kv.openHandleCount).toBe(1);
    await expect(kv.get({ resourceId: 'good', key: 'none' })).rejects.toThrow('closed');
  });
});
