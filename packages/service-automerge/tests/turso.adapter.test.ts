import { afterEach, describe, expect, test } from 'bun:test';
import { connect, type Database } from '@tursodatabase/database';
import { DEFAULT_OSS_ORGANIZATION_ID } from '@vibecanvas/shared-functions/vibecanvas-config/CONSTANTS';
import { TursoStorageAdapter } from '../src/adapters/turso.adapter';

async function createMemoryTurso(): Promise<Database> {
  const database = await connect(':memory:');
  await database.exec(`
    CREATE TABLE collaboration_documents (
      org_id TEXT NOT NULL,
      id TEXT NOT NULL,
      automerge_url TEXT NOT NULL,
      PRIMARY KEY (org_id, id),
      UNIQUE (org_id, automerge_url)
    ) STRICT;
    CREATE TABLE collaboration_chunks (
      org_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      chunk_key TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      chunk_bytes BLOB NOT NULL,
      created_at_ms INTEGER NOT NULL,
      PRIMARY KEY (org_id, document_id, chunk_key),
      UNIQUE (org_id, document_id, sequence)
    ) STRICT;
  `);
  return database;
}

async function registerDocument(database: Database, id: string, automergeUrl: string): Promise<void> {
  await (await database.prepare(`
    INSERT INTO collaboration_documents (org_id, id, automerge_url)
    VALUES (?, ?, ?)
  `)).run(DEFAULT_OSS_ORGANIZATION_ID, id, automergeUrl);
}

describe('TursoStorageAdapter', () => {
  const databases: Database[] = [];

  afterEach(async () => {
    while (databases.length > 0) {
      await databases.pop()?.close();
    }
  });

  test('loads registered document ranges through a turso connection', async () => {
    const turso = await createMemoryTurso();
    databases.push(turso);
    await registerDocument(turso, 'document-1', 'automerge:doc-1');
    await registerDocument(turso, 'document-2', 'automerge:doc-2');

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

  test('buffers a write until the document transaction registers and explicitly flushes it', async () => {
    const turso = await createMemoryTurso();
    databases.push(turso);
    const adapter = new TursoStorageAdapter(turso);
    let settled = false;
    const pending = adapter.save(['race-doc', 'snapshot', 'a'], new Uint8Array([1, 2, 3]))
      .finally(() => { settled = true; });

    await Promise.resolve();
    expect(settled).toBe(false);
    await registerDocument(turso, 'document-race', 'automerge:race-doc');
    await adapter.notifyDocumentRegistered('automerge:race-doc');
    await pending;

    expect(await adapter.load(['race-doc', 'snapshot', 'a'])).toEqual(new Uint8Array([1, 2, 3]));
  });

  test('bounds pending writes and rejects them when document registration fails', async () => {
    const turso = await createMemoryTurso();
    databases.push(turso);
    const adapter = new TursoStorageAdapter(turso, { maxPendingWrites: 1 });
    const first = adapter.save(['failed-doc', 'snapshot', 'a'], new Uint8Array([1]));

    await expect(adapter.save(['failed-doc', 'snapshot', 'b'], new Uint8Array([2])))
      .rejects.toThrow('capacity exceeded');
    adapter.failDocumentRegistration('automerge:failed-doc', new Error('canvas transaction failed'));
    await expect(first).rejects.toThrow('canvas transaction failed');
  });
});
