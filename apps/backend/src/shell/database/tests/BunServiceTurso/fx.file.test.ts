import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DbServiceTurso } from '../../DbServiceTurso/DbServiceTurso';

describe('direct media repository', () => {
  let service: DbServiceTurso;

  beforeEach(async () => {
    service = new DbServiceTurso({ applicationVersion: 'test', databasePath: ':memory:', dataDir: '/tmp', cacheDir: '/tmp' });
    await service.start();
    await service.canvas.create({ id: 'canvas-a', name: 'Canvas A' });
  });

  afterEach(async () => service.stop());

  test('persists bytes and stable hashes, then follows canvas deletion', async () => {
    const created = await service.file.create({
      id: 'media-a',
      canvasId: 'canvas-a',
      hash: 'source-hash',
      digestSha256: 'a'.repeat(64),
      mimeType: 'image/png',
      data: new Uint8Array([1, 2, 3]),
    });
    expect(created).toMatchObject({
      id: 'media-a',
      canvasId: 'canvas-a',
      hash: 'source-hash',
      digestSha256: 'a'.repeat(64),
      mimeType: 'image/png',
      data: new Uint8Array([1, 2, 3]),
      createdAtSec: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
    });
    expect(await service.file.getById({ id: 'media-a' })).toEqual(created);
    expect(await service.file.listAll()).toEqual([created]);
    await service.canvas.deleteById({ id: 'canvas-a' });
    expect(await service.file.getById({ id: 'media-a' })).toBeNull();
  });

  test('rejects a missing canvas and malformed digest', async () => {
    await expect(service.file.create({
      id: 'media-missing-canvas',
      canvasId: 'missing',
      hash: 'source-hash',
      digestSha256: 'a'.repeat(64),
      mimeType: 'image/png',
      data: new Uint8Array([1]),
    })).rejects.toThrow();
    await expect(service.file.create({
      id: 'media-bad-digest',
      canvasId: null,
      hash: 'source-hash',
      digestSha256: 'not-a-digest',
      mimeType: 'image/png',
      data: new Uint8Array([1]),
    })).rejects.toThrow();
  });
});
