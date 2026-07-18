import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '@vibecanvas/service-db/DbServiceTurso/turso-native';
import {
  ActorResourceKeyValueStore,
  type TActorResourceKeyValueDatabaseFactory,
} from '../src/resources/ActorResourceKeyValueStore';

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
  } = {}) {
    const value = new ActorResourceKeyValueStore({ dataRoot: rootDir, kind, ...options });
    stores.push(value);
    return value;
  }

  test('provisions exact kind paths and rejects unsafe or mismatched identities', async () => {
    const kv = store('kv');
    const secrets = store('secretStore');
    await kv.provision({ resourceId: 'kv-safe_1', kind: 'kv' });
    await secrets.provision({ resourceId: 'secret-safe_1', kind: 'secretStore' });

    expect((await stat(join(rootDir, 'actor-resources', 'kv', 'kv-safe_1', 'data.db'))).isFile()).toBe(true);
    expect((await stat(join(rootDir, 'actor-resources', 'secret-store', 'secret-safe_1', 'data.db'))).isFile()).toBe(true);

    for (const databasePath of [
      join(rootDir, 'actor-resources', 'kv', 'kv-safe_1', 'data.db'),
      join(rootDir, 'actor-resources', 'secret-store', 'secret-safe_1', 'data.db'),
    ]) {
      const database = new Database(databasePath, {
        fileMustExist: true,
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
