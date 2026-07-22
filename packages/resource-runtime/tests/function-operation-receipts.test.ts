import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from '@tursodatabase/database';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DbResource,
  KvResource,
  ResourceKeyValueStore,
  SecretStoreResource,
  type TDatabaseFactory,
  type TResourceKeyValueDatabaseFactory,
} from '../src/local';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const tenant = {
  orgId: 'org-a',
  accountId: 'account-a',
  cellId: 'cell-a',
  placementEpoch: 1,
  roles: ['member'],
  capabilities: [],
  requestId: 'request-a',
} as const;

const OPERATION_FINGERPRINT_A = 'a'.repeat(64);
const OPERATION_FINGERPRINT_B = 'b'.repeat(64);

const identity = (
  resourceId: string,
  operationId: string,
  operationFingerprintSha256 = OPERATION_FINGERPRINT_A,
) => ({
  orgId: tenant.orgId,
  resourceId,
  invocationId: 'invocation-a',
  attemptId: 'attempt-a',
  operationId,
  operationFingerprintSha256,
});

const allowCommit = { assertCanCommit: async () => undefined };

describe('durable function resource operation receipts', () => {
  test('fault matrix: resource owner restart/retry replays its receipt and a stale permit rolls back', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibecanvas-kv-receipt-'));
    roots.push(root);
    const databaseFactory: TResourceKeyValueDatabaseFactory = (path, options) => new Database(
      path,
      options as ConstructorParameters<typeof Database>[1],
    );
    let persistence = new ResourceKeyValueStore({ dataRoot: root, kind: 'kv', databaseFactory });
    await persistence.provision({ resourceId: 'preferences', kind: 'kv' });
    let provider = new KvResource(persistence);
    const context = {
      tenant,
      resource: { id: 'preferences', kind: 'kv' as const },
      requirement: { kind: 'kv' as const, required: true, scope: ['read', 'write'] as const },
      canRead: false,
      canWrite: true,
    };

    const first = await provider.dispatchWithReceipt(
      context,
      'set',
      { key: 'theme', value: 'dark' },
      identity('preferences', 'operation-1'),
      allowCommit,
    );
    expect(first).toMatchObject({ committed: true, replayed: false, output: { value: 'dark', revision: 1 } });
    await persistence.close();
    await expect(provider.dispatchWithReceipt(
      context,
      'set',
      { key: 'during-restart', value: true },
      identity('preferences', 'operation-unavailable'),
      allowCommit,
    )).rejects.toBeInstanceOf(Error);

    persistence = new ResourceKeyValueStore({ dataRoot: root, kind: 'kv', databaseFactory });
    await persistence.verify({ resourceId: 'preferences', kind: 'kv' });
    provider = new KvResource(persistence);
    await expect(provider.readCommittedOperation(context.resource, {
      invocationId: identity('preferences', 'operation-1').invocationId,
      operationId: 'operation-1',
    })).resolves.toEqual({
      invocationId: 'invocation-a',
      operationId: 'operation-1',
      attemptId: 'attempt-a',
      operationName: 'set',
      operationFingerprintSha256: OPERATION_FINGERPRINT_A,
      output: { value: 'dark', revision: 1 },
    });
    await expect(provider.dispatchWithReceipt(
      context,
      'set',
      { key: 'theme', value: 'light' },
      identity('preferences', 'operation-1', OPERATION_FINGERPRINT_B),
      allowCommit,
    )).rejects.toMatchObject({ code: 'KV_OPERATION_FAILED' });
    const replay = await provider.dispatchWithReceipt(
      context,
      'set',
      { key: 'theme', value: 'dark' },
      { ...identity('preferences', 'operation-1'), attemptId: 'attempt-b' },
      allowCommit,
    );
    expect(replay).toEqual({ committed: true, replayed: true, output: { value: 'dark', revision: 1 } });
    expect(await persistence.get({ resourceId: 'preferences', key: 'theme' })).toMatchObject({ value: 'dark', revision: 1 });

    let guardReached!: () => void;
    let rejectGuard!: () => void;
    const reached = new Promise<void>((resolve) => { guardReached = resolve; });
    const delayedExpiry = new Promise<void>((_resolve, reject) => {
      rejectGuard = () => reject(new Error('permit expired before commit'));
    });
    const rejected = provider.dispatchWithReceipt(
      context,
      'set',
      { key: 'rolled-back', value: true },
      identity('preferences', 'operation-2'),
      {
        assertCanCommit: async () => {
          guardReached();
          await delayedExpiry;
        },
      },
    );
    await reached;
    rejectGuard();
    await expect(rejected).rejects.toBeInstanceOf(Error);
    expect(await persistence.get({ resourceId: 'preferences', key: 'rolled-back' })).toBeNull();
    await persistence.close();
  });

  test('keeps secret write receipts encrypted and replays metadata without plaintext output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibecanvas-secret-receipt-'));
    roots.push(root);
    const databaseFactory: TResourceKeyValueDatabaseFactory = (path, options) => new Database(
      path,
      options as ConstructorParameters<typeof Database>[1],
    );
    const databaseHexKey = '11'.repeat(32);
    const persistence = new ResourceKeyValueStore({
      dataRoot: root,
      kind: 'secretStore',
      databaseFactory,
      secretStoreKeyProvider: {
        getDatabaseHexKey: async () => databaseHexKey,
        getOrCreateDatabaseHexKey: async () => databaseHexKey,
      },
    });
    await persistence.provision({ resourceId: 'credentials', kind: 'secretStore' });
    const provider = new SecretStoreResource(persistence);
    const context = {
      tenant,
      resource: { id: 'credentials', kind: 'secretStore' as const },
      requirement: { kind: 'secretStore' as const, required: true, scope: ['write'] as const },
      canRead: false,
      canWrite: true,
    };
    const first = await provider.dispatchWithReceipt(
      context,
      'set',
      { name: 'api-token', value: 'plaintext-secret' },
      identity('credentials', 'secret-1'),
      allowCommit,
    );
    await expect(provider.dispatchWithReceipt(
      context,
      'set',
      { name: 'api-token', value: 'different-secret' },
      identity('credentials', 'secret-1', OPERATION_FINGERPRINT_B),
      allowCommit,
    )).rejects.toMatchObject({ code: 'SECRET_OPERATION_FAILED' });
    const replay = await provider.dispatchWithReceipt(
      context,
      'set',
      { name: 'api-token', value: 'plaintext-secret' },
      { ...identity('credentials', 'secret-1'), attemptId: 'attempt-b' },
      allowCommit,
    );
    expect(first).toEqual({ output: { name: 'api-token', revision: 1 }, committed: true, replayed: false });
    expect(replay).toEqual({ output: { name: 'api-token', revision: 1 }, committed: true, replayed: true });
    const committed = await provider.readCommittedOperation(context.resource, {
      invocationId: 'invocation-a',
      operationId: 'secret-1',
    });
    expect(committed).toMatchObject({
      operationName: 'set',
      output: { name: 'api-token', revision: 1 },
    });
    expect(JSON.stringify(first)).not.toContain('plaintext-secret');
    expect(JSON.stringify(committed)).not.toContain('plaintext-secret');
    await persistence.close();
  });

  test('deduplicates DB writes inside the same transaction as their receipt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibecanvas-db-receipt-'));
    roots.push(root);
    const databaseFactory: TDatabaseFactory = (path, options) => new Database(path, options);
    const provider = new DbResource({
      db: { dbResource: { draft: { list: async () => [] } } },
      dataRoot: root,
      databaseFactory,
    });
    await provider.provision({ id: 'notes', kind: 'db' }, {});
    const context = {
      tenant,
      resource: { id: 'notes', kind: 'db' as const },
      requirement: {
        kind: 'db' as const,
        required: true,
        scope: ['read', 'write'] as const,
        arbitrarySql: true,
      },
      canRead: true,
      canWrite: true,
    };
    await provider.dispatchWithReceipt(
      context,
      'execute',
      { sql: 'CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL) STRICT' },
      identity('notes', 'schema-1'),
      allowCommit,
    );
    const inserted = await provider.dispatchWithReceipt(
      context,
      'execute',
      { sql: 'INSERT INTO notes (body) VALUES ($body)', parameters: { body: 'first' } },
      identity('notes', 'insert-1'),
      allowCommit,
    );
    await expect(provider.dispatchWithReceipt(
      context,
      'execute',
      { sql: "INSERT INTO notes (body) VALUES ('different-sql')" },
      identity('notes', 'insert-1', OPERATION_FINGERPRINT_B),
      allowCommit,
    )).rejects.toMatchObject({ code: 'DB_EXECUTE_FAILED' });
    await expect(provider.dispatchWithReceipt(
      context,
      'execute',
      { sql: 'INSERT INTO notes (body) VALUES ($body)', parameters: { body: 'different-params' } },
      identity('notes', 'insert-1', OPERATION_FINGERPRINT_B),
      allowCommit,
    )).rejects.toMatchObject({ code: 'DB_EXECUTE_FAILED' });
    const replay = await provider.dispatchWithReceipt(
      context,
      'execute',
      { sql: 'INSERT INTO notes (body) VALUES ($body)', parameters: { body: 'first' } },
      { ...identity('notes', 'insert-1'), attemptId: 'attempt-b' },
      allowCommit,
    );
    expect(inserted.replayed).toBe(false);
    expect(replay).toEqual({ ...inserted, replayed: true });
    await expect(provider.readCommittedOperation(context.resource, {
      invocationId: 'invocation-a',
      operationId: 'insert-1',
    })).resolves.toMatchObject({
      invocationId: 'invocation-a',
      operationId: 'insert-1',
      attemptId: 'attempt-a',
      operationName: 'execute',
      output: inserted.output,
    });
    const rows = await provider.dispatch(context, 'query', { sql: 'SELECT body FROM notes ORDER BY id' });
    expect(rows).toEqual([{ body: 'first' }]);
    await provider.close();
  });
});
