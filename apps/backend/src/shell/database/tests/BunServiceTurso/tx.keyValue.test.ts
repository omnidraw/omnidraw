import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DbServiceTurso } from '../../DbServiceTurso/DbServiceTurso';

describe('direct key-value repository', () => {
  let service: DbServiceTurso;

  beforeEach(async () => {
    service = new DbServiceTurso({ applicationVersion: 'test', databasePath: ':memory:', dataDir: '/tmp', cacheDir: '/tmp' });
    await service.start();
  });

  afterEach(async () => service.stop());

  test('round-trips each exactly-one typed value and supports replacement/removal', async () => {
    expect(await service.keyValue.add({ name: 'text', type: 'text', value: 'hello' }))
      .toEqual({ name: 'text', type: 'text', value: 'hello' });
    expect(await service.keyValue.add({ name: 'json', type: 'json', value: { ok: true } }))
      .toEqual({ name: 'json', type: 'json', value: { ok: true } });
    expect(await service.keyValue.add({ name: 'number', type: 'number', value: 42 }))
      .toEqual({ name: 'number', type: 'number', value: 42 });
    expect(await service.keyValue.add({ name: 'bool', type: 'bool', value: true }))
      .toEqual({ name: 'bool', type: 'bool', value: true });
    expect(await service.keyValue.add({ name: 'blob', type: 'blob', value: new Uint8Array([1, 2]) }))
      .toEqual({ name: 'blob', type: 'blob', value: new Uint8Array([1, 2]) });

    await service.keyValue.add({ name: 'text', type: 'number', value: 7 });
    expect(await service.keyValue.get({ name: 'text' })).toEqual({ name: 'text', type: 'number', value: 7 });
    await service.keyValue.remove({ name: 'text' });
    expect(await service.keyValue.get({ name: 'text' })).toBeNull();
  });
});
