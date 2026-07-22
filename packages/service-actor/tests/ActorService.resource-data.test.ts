import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResourceError } from '@vibecanvas/resource-runtime';
import { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import type { ActorService, IActorResourceService } from '../src/ActorService';
import { createNeutralActorResourceComposition, type TNeutralActorResourceComposition } from './neutral-resource.fixture';
import { createTestCrypto } from './test-uuid';
import { bindTestTenantDb, createTestTenantEvents, TEST_TENANT, type TActorTestDb } from './tenant.fixture';

describe('neutral ResourceService KV and secret management', () => {
  let rootDir = '';
  let configPath = '';
  let dataRoot = '';
  let dbService: DbServiceTurso;
  let db: TActorTestDb;
  let resources: TNeutralActorResourceComposition['resourceService'];
  let composition: TNeutralActorResourceComposition;
  let testCrypto: Pick<Crypto, 'randomUUID'>;

  const createComposition = (): TNeutralActorResourceComposition => createNeutralActorResourceComposition({
    tenant: TEST_TENANT,
    dbService,
    db,
    crypto: testCrypto,
    configPath,
    dataRoot,
    eventPublisherService: createTestTenantEvents(),
  });

  const startFreshComposition = async (): Promise<void> => {
    composition = createComposition();
    resources = composition.resourceService;
    await composition.start();
  };

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'vibecanvas-actor-service-resource-data-'));
    configPath = join(rootDir, 'config');
    dataRoot = join(rootDir, 'data');
    await mkdir(join(configPath, 'widgets'), { recursive: true });
    await mkdir(dataRoot, { recursive: true });
    dbService = new DbServiceTurso({ databasePath: ':memory:', dataDir: dataRoot, cacheDir: dataRoot });
    await dbService.start();
    db = bindTestTenantDb(dbService);
    testCrypto = createTestCrypto('actor-service-resource-data');
    await startFreshComposition();
  });

  afterEach(async () => {
    await composition.stop().catch(() => undefined);
    await db.db.close().catch(() => undefined);
    await rm(rootDir, { recursive: true, force: true });
  });

  test('keeps resource ownership fencing in the injected neutral owner', async () => {
    const competing = createComposition();
    try {
      await expect(competing.start()).rejects.toMatchObject({
        code: 'RESOURCE_OWNER_CONFLICT',
      });
    } finally {
      await competing.stop().catch(() => undefined);
    }
  });

  test('uses expected revisions for KV writes and deletes', async () => {
    const resource = await resources.createResource({ kind: 'kv', name: 'Preferences' });
    await expect(resources.setResourceDataEntry({
      resourceId: resource.id,
      key: 'theme',
      expectedRevision: null,
      value: { mode: 'dark' },
    })).resolves.toMatchObject({ kind: 'kv', entry: { key: 'theme', revision: 1 } });
    await expect(resources.setResourceDataEntry({
      resourceId: resource.id,
      key: 'theme',
      expectedRevision: 1,
      value: { mode: 'light' },
    })).resolves.toMatchObject({ kind: 'kv', entry: { key: 'theme', revision: 2 } });

    await expect(resources.deleteResourceDataEntry({ resourceId: resource.id, key: 'theme', expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'KV_ENTRY_CONFLICT' });
    await expect(resources.deleteResourceDataEntry({ resourceId: resource.id, key: 'theme', expectedRevision: 2 }))
      .resolves.toEqual({ deleted: true });
  });

  test('keeps secret plaintext out of management reads and mutation responses', async () => {
    const resource = await resources.createResource({ kind: 'secretStore', name: 'Secrets' });
    const created = await resources.setResourceDataEntry({
      resourceId: resource.id,
      key: 'api-token',
      expectedRevision: null,
      value: 'must-not-leak',
    });
    expect(created).toMatchObject({ kind: 'secretStore', entry: { name: 'api-token', revision: 1 } });
    expect(JSON.stringify(created)).not.toContain('must-not-leak');

    await resources.setResourceDataEntry({
      resourceId: resource.id,
      key: 'api-user',
      expectedRevision: null,
      value: 'also-must-not-leak',
    });
    await expect(resources.countResourceData({ resourceId: resource.id })).resolves.toBe(2);
    await expect(resources.countResourceData({ resourceId: resource.id, search: 'token' })).resolves.toBe(1);

    const page = await resources.listResourceData({ resourceId: resource.id, search: 'token' });
    expect(page).toMatchObject({ kind: 'secretStore', entries: [{ name: 'api-token', revision: 1 }] });
    expect(JSON.stringify(page)).not.toContain('must-not-leak');

    const rotated = await resources.setResourceDataEntry({
      resourceId: resource.id,
      key: 'api-token',
      expectedRevision: 1,
      value: 'rotated-must-not-leak',
    });
    expect(rotated).toMatchObject({ kind: 'secretStore', entry: { name: 'api-token', revision: 2 } });
    expect(JSON.stringify(rotated)).not.toContain('rotated-must-not-leak');

    const invalid = resources.setResourceDataEntry({
      resourceId: resource.id,
      key: 'wrong-type',
      expectedRevision: null,
      value: { plaintext: 'not-a-string' },
    });
    await expect(invalid).rejects.toBeInstanceOf(ResourceError);
    await expect(invalid).rejects.toMatchObject({ code: 'SECRET_VALUE_INVALID' });
  });

  test('does not expose plaintext secret reveal through actor surfaces', () => {
    type TActorServiceHasNoReveal = 'revealResourceSecret' extends keyof ActorService ? false : true;
    type TActorResourceServiceHasNoReveal = 'revealResourceSecret' extends keyof IActorResourceService ? false : true;
    const actorServiceHasNoReveal: TActorServiceHasNoReveal = true;
    const actorResourceServiceHasNoReveal: TActorResourceServiceHasNoReveal = true;

    expect(actorServiceHasNoReveal).toBe(true);
    expect(actorResourceServiceHasNoReveal).toBe(true);
    expect('revealResourceSecret' in composition.actor).toBe(false);
    expect('revealSecret' in composition.actor).toBe(false);
  });

  test('persists isolated KV and secret files across service reconstruction', async () => {
    const kv = await resources.createResource({ kind: 'kv', name: 'Restart KV' });
    const secrets = await resources.createResource({ kind: 'secretStore', name: 'Restart secrets' });
    await resources.setResourceDataEntry({ resourceId: kv.id, key: 'theme', expectedRevision: null, value: 'dark' });
    await resources.setResourceDataEntry({ resourceId: secrets.id, key: 'token', expectedRevision: null, value: 'persistent-secret' });

    expect((await stat(join(dataRoot, kv.id, 'data.db'))).isFile()).toBe(true);
    expect((await stat(join(dataRoot, secrets.id, 'data.db'))).isFile()).toBe(true);
    await composition.stop();
    await startFreshComposition();

    expect(await resources.getResourceDataEntry({ resourceId: kv.id, key: 'theme' })).toMatchObject({
      kind: 'kv',
      value: 'dark',
      revision: 1,
    });
    const secretMetadata = await resources.getResourceDataEntry({ resourceId: secrets.id, key: 'token' });
    expect(secretMetadata).toMatchObject({ kind: 'secretStore', name: 'token', revision: 1 });
    expect(JSON.stringify(secretMetadata)).not.toContain('persistent-secret');
  });

  test('surfaces stable wrong-key reconciliation without replacing the encrypted file', async () => {
    const secrets = await resources.createResource({ kind: 'secretStore', name: 'Wrong key after restart' });
    await resources.setResourceDataEntry({
      resourceId: secrets.id,
      key: 'token',
      expectedRevision: null,
      value: 'wrong-key-startup-sentinel',
    });
    const databasePath = join(dataRoot, secrets.id, 'data.db');
    await composition.stop();
    const before = await readFile(databasePath);
    await db.db.exec(`
      UPDATE resource_encryption_keys
      SET key_material = X'${'00'.repeat(32)}'
      WHERE resource_id = '${secrets.id}'
    `);
    await startFreshComposition();

    expect(await resources.getResource(secrets.id)).toMatchObject({
      status: 'error',
      last_error: {
        code: 'SECRET_STORE_DECRYPTION_FAILED',
        message: 'The secret-store database could not be decrypted or verified.',
      },
    });
    expect(await readFile(databasePath)).toEqual(before);
  });

  test('surfaces stable missing-key reconciliation without native details', async () => {
    const secrets = await resources.createResource({ kind: 'secretStore', name: 'Missing key after restart' });
    await resources.setResourceDataEntry({
      resourceId: secrets.id,
      key: 'token',
      expectedRevision: null,
      value: 'missing-key-startup-sentinel',
    });
    await composition.stop();
    await (await db.db.prepare(`
      DELETE FROM resource_encryption_keys
      WHERE resource_id = ?
    `)).run(secrets.id);
    await startFreshComposition();

    expect(await resources.getResource(secrets.id)).toMatchObject({
      status: 'error',
      last_error: {
        code: 'SECRET_STORE_KEY_UNAVAILABLE',
        message: 'The secret-store database encryption key is unavailable or invalid.',
      },
    });
    expect(JSON.stringify(await resources.getResource(secrets.id))).not.toContain('missing-key-startup-sentinel');
    await expect(db.actorResourceEncryptionKey.get({ resourceId: secrets.id })).resolves.toBeNull();
    const keyCount = await (await db.db.prepare('SELECT COUNT(*) AS count FROM resource_encryption_keys')).get();
    expect(Number(keyCount?.count)).toBe(0);
  });

  test('marks only a missing ready physical resource as error without recreating it', async () => {
    const missing = await resources.createResource({ kind: 'kv', name: 'Missing after restart' });
    const healthy = await resources.createResource({ kind: 'secretStore', name: 'Healthy after restart' });
    await resources.setResourceDataEntry({ resourceId: healthy.id, key: 'token', expectedRevision: null, value: 'healthy-secret' });
    await composition.stop();
    const missingPath = join(dataRoot, missing.id, 'data.db');
    await rm(missingPath);

    await startFreshComposition();
    expect(await resources.getResource(missing.id)).toMatchObject({ status: 'error' });
    expect(await resources.getResource(healthy.id)).toMatchObject({ status: 'ready' });
    expect(await stat(missingPath).catch(() => null)).toBeNull();
  });
});
