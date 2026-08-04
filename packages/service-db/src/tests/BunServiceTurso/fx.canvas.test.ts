import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DbServiceTurso } from '../../../src/DbServiceTurso/DbServiceTurso';

const TIMESTAMP_SEC = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

describe('direct canvas repository', () => {
  let service: DbServiceTurso;

  beforeEach(async () => {
    service = new DbServiceTurso({ databasePath: ':memory:', dataDir: '/tmp', cacheDir: '/tmp' });
    await service.start();
  });

  afterEach(async () => service.stop());

  test('creates, finds, renames, lists, and deletes by stable ID', async () => {
    const created = await service.canvas.create({ id: 'canvas-a', name: 'Canvas A' });
    expect(created).toEqual({
      id: 'canvas-a',
      name: 'Canvas A',
      revision: 0,
      createdAtSec: expect.stringMatching(TIMESTAMP_SEC),
      updatedAtSec: expect.stringMatching(TIMESTAMP_SEC),
    });
    expect(await service.canvas.findById({ id: 'canvas-a' })).toEqual(created);
    expect(await service.canvas.findByName({ name: 'Canvas A' })).toEqual(created);
    expect(await service.canvas.renameById({ id: 'canvas-a', name: 'Renamed' }))
      .toMatchObject({ id: 'canvas-a', name: 'Renamed' });
    expect(await service.canvas.listAll()).toHaveLength(1);
    expect(await service.canvas.deleteById({ id: 'canvas-a' })).toHaveLength(1);
    expect(await service.canvas.findById({ id: 'canvas-a' })).toBeNull();
  });
});
