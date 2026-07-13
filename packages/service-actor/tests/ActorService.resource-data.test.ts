import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import { EventPublisherService } from '@vibecanvas/service-event-publisher/EventPublisherService';
import { ActorService } from '../src/ActorService';
import { ActorResourceError } from '../src/resources/ActorResourceError';

describe('ActorService KV and secret management', () => {
  let rootDir = '';
  let db: DbServiceTurso;
  let service: ActorService;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'vibecanvas-actor-service-resource-data-'));
    const configPath = join(rootDir, 'config');
    const dataRoot = join(rootDir, 'data');
    await mkdir(join(configPath, 'widgets'), { recursive: true });
    await mkdir(dataRoot, { recursive: true });
    db = new DbServiceTurso({ databasePath: ':memory:', dataDir: dataRoot, cacheDir: dataRoot });
    await db.start();
    service = new ActorService({ db, configPath, dataRoot, eventPublisherService: new EventPublisherService() });
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

    const page = await service.listResourceData({ resourceId: resource.id });
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
});
