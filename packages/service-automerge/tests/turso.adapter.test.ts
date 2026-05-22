import { afterEach, describe, expect, test } from 'bun:test';
import { connect, type Database } from '@tursodatabase/database';
import { TursoStorageAdapter } from '../src/adapters/turso.adapter';

async function createMemoryTurso(): Promise<Database> {
  return connect(':memory:');
}

describe('TursoStorageAdapter', () => {
  const databases: Database[] = [];

  afterEach(async () => {
    while (databases.length > 0) {
      await databases.pop()?.close();
    }
  });

  test('loadRange works when adapter uses a turso connection', async () => {
    const turso = await createMemoryTurso();
    databases.push(turso);

    const adapter = new TursoStorageAdapter(turso);
    await adapter.save(['doc-1', 'snapshot', 'a'], new Uint8Array([1, 2, 3]));
    await adapter.save(['doc-1', 'incremental', 'b'], new Uint8Array([4, 5, 6]));
    await adapter.save(['doc-2', 'snapshot', 'c'], new Uint8Array([7, 8, 9]));

    const chunks = await adapter.loadRange(['doc-1']);
    const keys = chunks.map((chunk) => chunk.key.join('.')).sort();

    expect(chunks).toHaveLength(2);
    expect(keys).toEqual([
      'doc-1.incremental.b',
      'doc-1.snapshot.a',
    ]);
  });
});
