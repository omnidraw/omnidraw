import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import { EventPublisherService } from '@vibecanvas/service-event-publisher/EventPublisherService';
import { ActorService } from '../src/ActorService';
import { ActorResourceError } from '../src/resources/ActorResourceError';
import { SecretStoreDatabaseKeyProvider } from '../src/resources/SecretStoreKeyProvider';

describe('ActorService KV and secret management', () => {
  let rootDir = '';
  let configPath = '';
  let dataRoot = '';
  let db: DbServiceTurso;
  let service: ActorService;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'vibecanvas-actor-service-resource-data-'));
    configPath = join(rootDir, 'config');
    dataRoot = join(rootDir, 'data');
    await mkdir(join(configPath, 'widgets'), { recursive: true });
    await mkdir(dataRoot, { recursive: true });
    db = new DbServiceTurso({ databasePath: ':memory:', dataDir: dataRoot, cacheDir: dataRoot });
    await db.start();
    service = new ActorService({
      db,
      configPath,
      dataRoot,
      secretStoreKeyProvider: new SecretStoreDatabaseKeyProvider({
        encryptionKeys: db.actorResourceEncryptionKey,
        randomBytes: () => Buffer.alloc(32, 0x5c),
        randomUUID: () => 'test-key-initial',
      }),
      eventPublisherService: new EventPublisherService(),
    });
    await service.start({} as never);
  });

  afterEach(async () => {
    await service.stop().catch(() => undefined);
    await db.db.close().catch(() => undefined);
    await rm(rootDir, { recursive: true, force: true });
  });

  test('uses expected revisions for KV writes and deletes', async () => {
    const resource = await service.createResource({ kind: 'kv', name: 'Preferences' });
    await expect(service.setResourceDataEntry({
      resourceId: resource.id,
      key: 'theme',
      expectedRevision: null,
      value: { mode: 'dark' },
    })).resolves.toMatchObject({ kind: 'kv', entry: { key: 'theme', revision: 1 } });
    await expect(service.setResourceDataEntry({
      resourceId: resource.id,
      key: 'theme',
      expectedRevision: 1,
      value: { mode: 'light' },
    })).resolves.toMatchObject({ kind: 'kv', entry: { key: 'theme', revision: 2 } });

    await expect(service.deleteResourceDataEntry({ resourceId: resource.id, key: 'theme', expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'KV_ENTRY_CONFLICT' });
    await expect(service.deleteResourceDataEntry({ resourceId: resource.id, key: 'theme', expectedRevision: 2 }))
      .resolves.toEqual({ deleted: true });
  });

  test('keeps secret plaintext out of management reads and mutation responses', async () => {
    const resource = await service.createResource({ kind: 'secretStore', name: 'Secrets' });
    const created = await service.setResourceDataEntry({
      resourceId: resource.id,
      key: 'api-token',
      expectedRevision: null,
      value: 'must-not-leak',
    });
    expect(created).toMatchObject({ kind: 'secretStore', entry: { name: 'api-token', revision: 1 } });
    expect(JSON.stringify(created)).not.toContain('must-not-leak');

    await service.setResourceDataEntry({
      resourceId: resource.id,
      key: 'api-user',
      expectedRevision: null,
      value: 'also-must-not-leak',
    });
    await expect(service.countResourceData({ resourceId: resource.id })).resolves.toBe(2);
    await expect(service.countResourceData({ resourceId: resource.id, search: 'token' })).resolves.toBe(1);

    const page = await service.listResourceData({ resourceId: resource.id, search: 'token' });
    expect(page).toMatchObject({ kind: 'secretStore', entries: [{ name: 'api-token', revision: 1 }] });
    expect(JSON.stringify(page)).not.toContain('must-not-leak');

    const rotated = await service.setResourceDataEntry({
      resourceId: resource.id,
      key: 'api-token',
      expectedRevision: 1,
      value: 'rotated-must-not-leak',
    });
    expect(rotated).toMatchObject({ kind: 'secretStore', entry: { name: 'api-token', revision: 2 } });
    expect(JSON.stringify(rotated)).not.toContain('rotated-must-not-leak');

    const invalid = service.setResourceDataEntry({
      resourceId: resource.id,
      key: 'wrong-type',
      expectedRevision: null,
      value: { plaintext: 'not-a-string' },
    });
    await expect(invalid).rejects.toBeInstanceOf(ActorResourceError);
    await expect(invalid).rejects.toMatchObject({ code: 'SECRET_VALUE_INVALID' });
  });

  test('reveals one ready secret through the dedicated operator-management method', async () => {
    const sentinel = 'operator-only-sentinel-secret';
    const resource = await service.createResource({ kind: 'secretStore', name: 'Reveal secrets' });
    await service.setResourceDataEntry({
      resourceId: resource.id,
      key: 'api-token',
      expectedRevision: null,
      value: sentinel,
    });

    await expect(service.revealResourceSecret({ resourceId: resource.id, name: 'api-token' })).resolves.toEqual({
      kind: 'secretStore',
      name: 'api-token',
      value: sentinel,
      revision: 1,
    });
    await service.setResourceDataEntry({
      resourceId: resource.id,
      key: 'api-token',
      expectedRevision: 1,
      value: 'rotated-operator-only-secret',
    });
    await expect(service.revealResourceSecret({ resourceId: resource.id, name: 'api-token' })).resolves.toEqual({
      kind: 'secretStore',
      name: 'api-token',
      value: 'rotated-operator-only-secret',
      revision: 2,
    });

    await expect(service.revealResourceSecret({ resourceId: resource.id, name: 'missing' }))
      .rejects.toMatchObject({ code: 'SECRET_NOT_FOUND', message: 'Secret was not found.' });
    const kv = await service.createResource({ kind: 'kv', name: 'Wrong reveal kind' });
    await expect(service.revealResourceSecret({ resourceId: kv.id, name: 'api-token' }))
      .rejects.toMatchObject({ code: 'RESOURCE_KIND_MISMATCH' });
    await expect(service.revealResourceSecret({ resourceId: 'missing-resource', name: 'api-token' }))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  test('returns a value-free stable error when a secret store is unavailable', async () => {
    const sentinel = 'native-decryption-detail-must-not-leak';
    const resource = await service.createResource({ kind: 'secretStore', name: 'Unavailable secrets' });
    await db.actorResource.updateProviderState({
      id: resource.id,
      status: 'error',
      lastError: { code: 'SECRET_STORE_DECRYPTION_FAILED', message: sentinel },
    });

    const reveal = service.revealResourceSecret({ resourceId: resource.id, name: 'api-token' });
    await expect(reveal).rejects.toMatchObject({
      code: 'SECRET_STORE_UNAVAILABLE',
      message: 'Secret-store resource is unavailable.',
    });
    await expect(reveal.catch((error) => JSON.stringify(error))).resolves.not.toContain(sentinel);
  });

  test('persists isolated KV and secret files across service reconstruction', async () => {
    const kv = await service.createResource({ kind: 'kv', name: 'Restart KV' });
    const secrets = await service.createResource({ kind: 'secretStore', name: 'Restart secrets' });
    await service.setResourceDataEntry({ resourceId: kv.id, key: 'theme', expectedRevision: null, value: 'dark' });
    await service.setResourceDataEntry({ resourceId: secrets.id, key: 'token', expectedRevision: null, value: 'persistent-secret' });

    expect((await stat(join(dataRoot, 'actor-resources', 'kv', kv.id, 'data.db'))).isFile()).toBe(true);
    expect((await stat(join(dataRoot, 'actor-resources', 'secret-store', secrets.id, 'data.db'))).isFile()).toBe(true);
    await service.stop();
    service = new ActorService({
      db,
      configPath,
      dataRoot,
      secretStoreKeyProvider: new SecretStoreDatabaseKeyProvider({
        encryptionKeys: db.actorResourceEncryptionKey,
        randomBytes: () => Buffer.alloc(32, 0xff),
        randomUUID: () => 'test-key-restart',
      }),
      eventPublisherService: new EventPublisherService(),
    });
    await service.start({} as never);

    expect(await service.getResourceDataEntry({ resourceId: kv.id, key: 'theme' })).toMatchObject({
      kind: 'kv',
      value: 'dark',
      revision: 1,
    });
    const secretMetadata = await service.getResourceDataEntry({ resourceId: secrets.id, key: 'token' });
    expect(secretMetadata).toMatchObject({ kind: 'secretStore', name: 'token', revision: 1 });
    expect(JSON.stringify(secretMetadata)).not.toContain('persistent-secret');
  });

  test('surfaces stable wrong-key reconciliation without replacing the encrypted file', async () => {
    const secrets = await service.createResource({ kind: 'secretStore', name: 'Wrong key after restart' });
    await service.setResourceDataEntry({
      resourceId: secrets.id,
      key: 'token',
      expectedRevision: null,
      value: 'wrong-key-startup-sentinel',
    });
    const databasePath = join(dataRoot, 'actor-resources', 'secret-store', secrets.id, 'data.db');
    await service.stop();
    const before = await readFile(databasePath);
    service = new ActorService({
      db,
      configPath,
      dataRoot,
      secretStoreKeyProvider: {
        getDatabaseHexKey: async () => '00'.repeat(32),
        getOrCreateDatabaseHexKey: async () => '00'.repeat(32),
      },
      eventPublisherService: new EventPublisherService(),
    });
    await service.start({} as never);

    expect(await service.getResource(secrets.id)).toMatchObject({
      status: 'error',
      last_error: {
        code: 'SECRET_STORE_DECRYPTION_FAILED',
        message: 'The secret-store database could not be decrypted or verified.',
      },
    });
    expect(await readFile(databasePath)).toEqual(before);
  });

  test('surfaces stable missing-key reconciliation without native details', async () => {
    const secrets = await service.createResource({ kind: 'secretStore', name: 'Missing key after restart' });
    await service.setResourceDataEntry({
      resourceId: secrets.id,
      key: 'token',
      expectedRevision: null,
      value: 'missing-key-startup-sentinel',
    });
    await service.stop();
    await (await db.db.prepare(`
      DELETE FROM actor_resource_encryption_keys
      WHERE actor_resource_id = ?
    `)).run(secrets.id);
    service = new ActorService({
      db,
      configPath,
      dataRoot,
      secretStoreKeyProvider: new SecretStoreDatabaseKeyProvider({
        encryptionKeys: db.actorResourceEncryptionKey,
        randomBytes: () => Buffer.alloc(32, 0xff),
        randomUUID: () => 'replacement-key-must-not-be-created',
      }),
      eventPublisherService: new EventPublisherService(),
    });
    await service.start({} as never);

    expect(await service.getResource(secrets.id)).toMatchObject({
      status: 'error',
      last_error: {
        code: 'SECRET_STORE_KEY_UNAVAILABLE',
        message: 'The secret-store database encryption key is unavailable or invalid.',
      },
    });
    expect(JSON.stringify(await service.getResource(secrets.id))).not.toContain('missing-key-startup-sentinel');
    await expect(db.actorResourceEncryptionKey.get({ resourceId: secrets.id })).resolves.toBeNull();
    const keyCount = await (await db.db.prepare('SELECT COUNT(*) AS count FROM encryption_keys')).get();
    expect(Number(keyCount?.count)).toBe(1);
  });

  test('marks only a missing ready physical resource as error without recreating it', async () => {
    const missing = await service.createResource({ kind: 'kv', name: 'Missing after restart' });
    const healthy = await service.createResource({ kind: 'secretStore', name: 'Healthy after restart' });
    await service.setResourceDataEntry({ resourceId: healthy.id, key: 'token', expectedRevision: null, value: 'healthy-secret' });
    await service.stop();
    const missingPath = join(dataRoot, 'actor-resources', 'kv', missing.id, 'data.db');
    await rm(missingPath);

    service = new ActorService({
      db,
      configPath,
      dataRoot,
      secretStoreKeyProvider: new SecretStoreDatabaseKeyProvider({
        encryptionKeys: db.actorResourceEncryptionKey,
        randomBytes: () => Buffer.alloc(32, 0xff),
        randomUUID: () => 'test-key-healthy-restart',
      }),
      eventPublisherService: new EventPublisherService(),
    });
    await service.start({} as never);
    expect(await service.getResource(missing.id)).toMatchObject({ status: 'error' });
    expect(await service.getResource(healthy.id)).toMatchObject({ status: 'ready' });
    expect(await stat(missingPath).catch(() => null)).toBeNull();
  });
});
