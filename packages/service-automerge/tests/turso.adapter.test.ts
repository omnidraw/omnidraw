import { afterEach, describe, expect, test } from 'bun:test';
import { connect, type Database } from '@tursodatabase/database';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import { TursoStorageAdapter } from '../src/adapters/turso.adapter';

const TENANT_A: TTenantContext = Object.freeze({
  orgId: '11111111-1111-4111-8111-111111111111',
  accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  cellId: 'cell-test',
  placementEpoch: 1,
  roles: Object.freeze(['owner']),
  capabilities: Object.freeze(['canvas:write']),
  requestId: 'request-a',
});

const TENANT_B: TTenantContext = Object.freeze({
  orgId: '22222222-2222-4222-8222-222222222222',
  accountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  cellId: 'cell-test',
  placementEpoch: 1,
  roles: Object.freeze(['owner']),
  capabilities: Object.freeze(['canvas:write']),
  requestId: 'request-b',
});

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

async function registerDocument(
  database: Database,
  tenantContext: TTenantContext,
  id: string,
  automergeUrl: string,
): Promise<void> {
  await (await database.prepare(`
    INSERT INTO collaboration_documents (org_id, id, automerge_url)
    VALUES (?, ?, ?)
  `)).run(tenantContext.orgId, id, automergeUrl);
}

describe('TursoStorageAdapter', () => {
  const databases: Database[] = [];

  afterEach(async () => {
    while (databases.length > 0) await databases.pop()?.close();
  });

  test('loads registered document ranges through a tenant-qualified directory', async () => {
    const turso = await createMemoryTurso();
    databases.push(turso);
    await registerDocument(turso, TENANT_A, 'document-1', 'automerge:doc-1');
    await registerDocument(turso, TENANT_A, 'document-2', 'automerge:doc-2');

    const adapter = new TursoStorageAdapter(turso);
    expect(await adapter.admitDocument(TENANT_A, 'automerge:doc-1')).toBe(true);
    expect(await adapter.admitDocument(TENANT_A, 'automerge:doc-2')).toBe(true);
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

  test('buffers a claimed write until the document transaction registers and explicitly flushes it', async () => {
    const turso = await createMemoryTurso();
    databases.push(turso);
    const adapter = new TursoStorageAdapter(turso);
    adapter.claimDocument(TENANT_A, 'automerge:race-doc');
    let settled = false;
    const pending = adapter.save(['race-doc', 'snapshot', 'a'], new Uint8Array([1, 2, 3]))
      .finally(() => { settled = true; });

    await Promise.resolve();
    expect(settled).toBe(false);
    await registerDocument(turso, TENANT_A, 'document-race', 'automerge:race-doc');
    await adapter.notifyDocumentRegistered(TENANT_A, 'automerge:race-doc');
    await pending;

    expect(await adapter.load(['race-doc', 'snapshot', 'a'])).toEqual(new Uint8Array([1, 2, 3]));
  });

  test('bounds pending writes and rejects only the claiming tenant queue when registration fails', async () => {
    const turso = await createMemoryTurso();
    databases.push(turso);
    const adapter = new TursoStorageAdapter(turso, { maxPendingWrites: 1 });
    adapter.claimDocument(TENANT_A, 'automerge:failed-doc');
    const first = adapter.save(['failed-doc', 'snapshot', 'a'], new Uint8Array([1]));

    await expect(adapter.save(['failed-doc', 'snapshot', 'b'], new Uint8Array([2])))
      .rejects.toThrow('capacity exceeded');
    adapter.failDocumentRegistration(TENANT_A, 'automerge:failed-doc', new Error('canvas transaction failed'));
    await expect(first).rejects.toThrow('canvas transaction failed');
  });

  test('stores the same directory document id independently for two organizations', async () => {
    const turso = await createMemoryTurso();
    databases.push(turso);
    await registerDocument(turso, TENANT_A, 'same-document-id', 'automerge:org-a-doc');
    await registerDocument(turso, TENANT_B, 'same-document-id', 'automerge:org-b-doc');

    const adapter = new TursoStorageAdapter(turso);
    expect(await adapter.admitDocument(TENANT_A, 'automerge:org-a-doc')).toBe(true);
    expect(await adapter.admitDocument(TENANT_B, 'automerge:org-b-doc')).toBe(true);
    await adapter.save(['org-a-doc', 'snapshot', 'same-key'], new Uint8Array([1]));
    await adapter.save(['org-b-doc', 'snapshot', 'same-key'], new Uint8Array([2]));

    expect(await adapter.load(['org-a-doc', 'snapshot', 'same-key'])).toEqual(new Uint8Array([1]));
    expect(await adapter.load(['org-b-doc', 'snapshot', 'same-key'])).toEqual(new Uint8Array([2]));
    expect(await adapter.admitDocument(TENANT_B, 'automerge:org-a-doc')).toBe(false);
    expect(await adapter.admitDocument(TENANT_B, 'automerge:missing-doc')).toBe(false);

    const rows = await (await turso.prepare(`
      SELECT org_id, document_id, chunk_bytes
      FROM collaboration_chunks
      ORDER BY org_id ASC
    `)).all() as Array<{ org_id: string; document_id: string; chunk_bytes: Uint8Array }>;
    expect(rows.map((row) => [row.org_id, row.document_id, [...row.chunk_bytes]])).toEqual([
      [TENANT_A.orgId, 'same-document-id', [1]],
      [TENANT_B.orgId, 'same-document-id', [2]],
    ]);
  });

  test('rejects an ambiguous Automerge URL even when each organization has a directory row', async () => {
    const turso = await createMemoryTurso();
    databases.push(turso);
    await registerDocument(turso, TENANT_A, 'document-a', 'automerge:ambiguous-doc');
    await registerDocument(turso, TENANT_B, 'document-b', 'automerge:ambiguous-doc');
    const adapter = new TursoStorageAdapter(turso);

    expect(await adapter.admitDocument(TENANT_A, 'automerge:ambiguous-doc')).toBe(false);
    expect(await adapter.admitDocument(TENANT_B, 'automerge:ambiguous-doc')).toBe(false);
  });
});
