import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DbServiceTurso } from '../../../src/DbServiceTurso/DbServiceTurso';
import { ResourceControlStoreTurso } from '../../../src/ResourceControlStoreTurso';

describe('resource encryption key repository', () => {
  let service: DbServiceTurso;

  beforeEach(async () => {
    service = new DbServiceTurso({ databasePath: ':memory:', dataDir: '/tmp', cacheDir: '/tmp' });
    await service.start();
    await new ResourceControlStoreTurso(service.db).createResource({
      id: 'secrets-a',
      kind: 'secretStore',
      name: 'Secrets',
      cellId: 'local-cell',
      placementEpoch: 1,
      storageKey: 'resources/secrets-a',
    });
  });

  afterEach(async () => service.stop());

  test('creates exactly one valid key per secret-store resource', async () => {
    const args = {
      resourceId: 'secrets-a',
      keyId: 'key-a',
      purpose: 'resource-data',
      algorithm: 'aegis-256',
      keyHex: 'ab'.repeat(32),
    };
    const created = await service.resourceEncryptionKey.getOrCreate(args);
    expect(created).toMatchObject({
      id: args.keyId,
      resourceId: args.resourceId,
      purpose: args.purpose,
      algorithm: args.algorithm,
      keyHex: args.keyHex,
    });
    expect(await service.resourceEncryptionKey.get({ resourceId: 'secrets-a' })).toEqual(created);
    expect(await service.resourceEncryptionKey.getOrCreate({
      ...args,
      keyId: 'key-b',
      keyHex: 'cd'.repeat(32),
    })).toEqual(created);
  });

  test('rejects unsupported algorithms, malformed bytes, and non-secret resources', async () => {
    await expect(service.resourceEncryptionKey.getOrCreate({
      resourceId: 'secrets-a',
      keyId: 'key-a',
      purpose: 'resource-data',
      algorithm: 'unknown',
      keyHex: 'ab'.repeat(32),
    })).rejects.toThrow('unsupported');
    await expect(service.resourceEncryptionKey.getOrCreate({
      resourceId: 'secrets-a',
      keyId: 'key-a',
      purpose: 'resource-data',
      algorithm: 'aegis-256',
      keyHex: 'ABC',
    })).rejects.toThrow('32 lowercase hexadecimal bytes');
    await expect(service.resourceEncryptionKey.getOrCreate({
      resourceId: 'missing',
      keyId: 'key-a',
      purpose: 'resource-data',
      algorithm: 'aegis-256',
      keyHex: 'ab'.repeat(32),
    })).rejects.toThrow('not found');
  });
});
