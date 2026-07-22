import { afterEach, describe, expect, test } from 'bun:test';
import { generateAutomergeUrl, parseAutomergeUrl } from '@automerge/automerge-repo';
import { connect, type Database } from '@tursodatabase/database';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  TursoStorageAdapter,
  type TAutomergeStorageDocumentContent,
} from '../src/adapters/turso.adapter';

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
    CREATE TABLE canvas_members (
      org_id TEXT NOT NULL,
      canvas_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'editor',
      PRIMARY KEY (org_id, canvas_id, account_id)
    ) STRICT;
    CREATE TABLE widget_instances (
      org_id TEXT NOT NULL,
      id TEXT NOT NULL,
      canvas_id TEXT NOT NULL,
      element_id TEXT NOT NULL,
      definition_id TEXT NOT NULL,
      revision_id TEXT NOT NULL,
      status TEXT NOT NULL,
      PRIMARY KEY (org_id, id)
    ) STRICT;
    CREATE TABLE collaboration_documents (
      org_id TEXT NOT NULL,
      id TEXT NOT NULL,
      canvas_id TEXT,
      widget_instance_id TEXT,
      automerge_url TEXT NOT NULL,
      content_version INTEGER NOT NULL DEFAULT 0 CHECK (content_version >= 0),
      PRIMARY KEY (org_id, id),
      UNIQUE (org_id, automerge_url)
    ) STRICT;
    CREATE TABLE collaboration_chunks (
      org_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      chunk_key TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      chunk_bytes BLOB NOT NULL CHECK (length(chunk_bytes) > 0),
      created_at_ms INTEGER NOT NULL,
      PRIMARY KEY (org_id, document_id, chunk_key),
      UNIQUE (org_id, document_id, sequence)
    ) STRICT;
    CREATE TABLE widget_instance_projection_heads (
      org_id TEXT NOT NULL,
      canvas_id TEXT NOT NULL,
      source_sequence INTEGER NOT NULL,
      PRIMARY KEY (org_id, canvas_id)
    ) STRICT;
  `);
  return database;
}

async function registerDocument(
  database: Database,
  tenantContext: TTenantContext,
  id: string,
  automergeUrl: string,
  canvasId = `${id}-canvas`,
): Promise<void> {
  await (await database.prepare(`
    INSERT INTO collaboration_documents (
      org_id, id, canvas_id, widget_instance_id, automerge_url
    ) VALUES (?, ?, ?, NULL, ?)
  `)).run(tenantContext.orgId, id, canvasId, automergeUrl);
  await (await database.prepare(`
    INSERT OR IGNORE INTO canvas_members (org_id, canvas_id, account_id)
    VALUES (?, ?, ?)
  `)).run(tenantContext.orgId, canvasId, tenantContext.accountId);
}

describe('TursoStorageAdapter', () => {
  const databases: Database[] = [];

  afterEach(async () => {
    while (databases.length > 0) await databases.pop()?.close();
  });

  test('loads registered document ranges through a tenant-qualified directory', async () => {
    const turso = await createMemoryTurso();
    databases.push(turso);
    const firstUrl = generateAutomergeUrl();
    const secondUrl = generateAutomergeUrl();
    const firstKey = parseAutomergeUrl(firstUrl).documentId;
    const secondKey = parseAutomergeUrl(secondUrl).documentId;
    await registerDocument(turso, TENANT_A, 'document-1', firstUrl);
    await registerDocument(turso, TENANT_A, 'document-2', secondUrl);

    const adapter = new TursoStorageAdapter(turso);
    expect(await adapter.admitDocument(TENANT_A, firstUrl)).toBe(true);
    expect(await adapter.admitDocument(TENANT_A, secondUrl)).toBe(true);
    await adapter.save([firstKey, 'snapshot', 'a'], new Uint8Array([1, 2, 3]));
    await adapter.save([firstKey, 'incremental', 'b'], new Uint8Array([4, 5, 6]));
    await adapter.save([secondKey, 'snapshot', 'c'], new Uint8Array([7, 8, 9]));

    const chunks = await adapter.loadRange([firstKey]);
    const keys = chunks.map((chunk) => chunk.key.join('.')).sort();

    expect(chunks).toHaveLength(2);
    expect(keys).toEqual([
      `${firstKey}.incremental.b`,
      `${firstKey}.snapshot.a`,
    ]);
  });

  test('keeps viewer admission readable while rejecting durable writes after a role downgrade', async () => {
    const turso = await createMemoryTurso();
    databases.push(turso);
    const automergeUrl = generateAutomergeUrl();
    const documentKey = parseAutomergeUrl(automergeUrl).documentId;
    await registerDocument(
      turso,
      TENANT_A,
      'document-role-downgrade',
      automergeUrl,
      'canvas-role-downgrade',
    );
    const adapter = new TursoStorageAdapter(turso);

    await expect(adapter.admitDocumentAccess(TENANT_A, automergeUrl)).resolves.toMatchObject({
      canWrite: true,
      access: {
        kind: 'canvas',
        orgId: TENANT_A.orgId,
        canvasId: 'canvas-role-downgrade',
      },
    });
    await (await turso.prepare(`
      UPDATE canvas_members
      SET role = 'viewer'
      WHERE org_id = ? AND canvas_id = ? AND account_id = ?
    `)).run(TENANT_A.orgId, 'canvas-role-downgrade', TENANT_A.accountId);

    await expect(adapter.save(
      [documentKey, 'snapshot', 'viewer-write'],
      new Uint8Array([1]),
    )).rejects.toThrow('Automerge document is unavailable.');
    await expect(adapter.admitDocumentAccess(TENANT_A, automergeUrl)).resolves.toMatchObject({
      canWrite: false,
      access: {
        kind: 'canvas',
        canvasId: 'canvas-role-downgrade',
      },
    });
    const persisted = await (await turso.prepare(`
      SELECT count(*) AS count
      FROM collaboration_chunks
      WHERE org_id = ? AND document_id = ?
    `)).get(TENANT_A.orgId, 'document-role-downgrade') as { count: number };
    expect(persisted.count).toBe(0);
  });

  test('increments the durable content version for inserts and in-place updates and notifies only after commit', async () => {
    const turso = await createMemoryTurso();
    databases.push(turso);
    const automergeUrl = generateAutomergeUrl();
    const documentKey = parseAutomergeUrl(automergeUrl).documentId;
    await registerDocument(
      turso,
      TENANT_A,
      'document-versioned',
      automergeUrl,
      'canvas-versioned',
    );
    let transactionOpen = false;
    const rawTransaction = turso.transaction.bind(turso);
    const monitoredTransaction = ((
      callback: Parameters<Database['transaction']>[0],
    ) => {
      const execute = rawTransaction(callback);
      return async () => {
        transactionOpen = true;
        try {
          return await execute();
        } finally {
          transactionOpen = false;
        }
      };
    }) as Database['transaction'];
    Object.defineProperty(turso, 'transaction', {
      configurable: true,
      value: monitoredTransaction,
    });
    const notifications: Array<{
      duringTransaction: boolean;
      frozen: boolean;
      version: TAutomergeStorageDocumentContent;
    }> = [];
    const adapter = new TursoStorageAdapter(turso, {
      onDocumentContentVersion: (version) => {
        notifications.push({
          duringTransaction: transactionOpen,
          frozen: Object.isFrozen(version),
          version,
        });
      },
    });

    expect(await adapter.admitDocument(TENANT_A, automergeUrl)).toBe(true);
    expect(adapter.getAdmittedDocumentIdentity(TENANT_A, automergeUrl)).toEqual({
      orgId: TENANT_A.orgId,
      documentId: 'document-versioned',
      canvasId: 'canvas-versioned',
      automergeUrl,
      contentVersion: 0,
    });
    expect(adapter.getAdmittedDocumentAccess(TENANT_A, automergeUrl)).toEqual({
      kind: 'canvas',
      orgId: TENANT_A.orgId,
      canvasId: 'canvas-versioned',
    });
    expect(Object.isFrozen(
      adapter.getAdmittedDocumentIdentity(TENANT_A, automergeUrl),
    )).toBe(true);

    await expect(adapter.save(
      [documentKey, 'snapshot', 'same-key'],
      new Uint8Array(),
    )).rejects.toThrow();
    expect(notifications).toEqual([]);

    await adapter.save([documentKey, 'snapshot', 'same-key'], new Uint8Array([1]));
    await adapter.save([documentKey, 'sync-state', 'peer-a'], new Uint8Array([9]));
    await adapter.save([documentKey, 'snapshot', 'same-key'], new Uint8Array([2]));

    const document = await (await turso.prepare(`
      SELECT content_version FROM collaboration_documents
      WHERE org_id = ? AND id = ?
    `)).get(TENANT_A.orgId, 'document-versioned') as { content_version: unknown };
    const chunks = await (await turso.prepare(`
      SELECT sequence, chunk_bytes FROM collaboration_chunks
      WHERE org_id = ? AND document_id = ? AND chunk_key = ?
    `)).all(
      TENANT_A.orgId,
      'document-versioned',
      `${documentKey}.snapshot.same-key`,
    ) as Array<{
      sequence: unknown;
      chunk_bytes: Uint8Array;
    }>;
    expect(Number(document.content_version)).toBe(2);
    expect(chunks).toHaveLength(1);
    expect(Number(chunks[0]?.sequence)).toBe(0);
    expect(chunks[0]?.chunk_bytes).toEqual(new Uint8Array([2]));
    expect(notifications).toEqual([
      {
        duringTransaction: false,
        frozen: true,
        version: {
          orgId: TENANT_A.orgId,
          documentId: 'document-versioned',
          canvasId: 'canvas-versioned',
          automergeUrl,
          contentVersion: 1,
          contentBytes: new Uint8Array([1]),
          contentKind: 'snapshot',
        },
      },
      {
        duringTransaction: false,
        frozen: true,
        version: {
          orgId: TENANT_A.orgId,
          documentId: 'document-versioned',
          canvasId: 'canvas-versioned',
          automergeUrl,
          contentVersion: 2,
          contentBytes: new Uint8Array([2]),
          contentKind: 'snapshot',
        },
      },
    ]);
    expect(adapter.getAdmittedDocumentIdentity(TENANT_A, automergeUrl))
      .toMatchObject({ contentVersion: 2 });
    expect(await adapter.load([documentKey, 'sync-state', 'peer-a']))
      .toEqual(new Uint8Array([9]));
  });

  test('buffers a claimed write until the document transaction registers and explicitly flushes it', async () => {
    const turso = await createMemoryTurso();
    databases.push(turso);
    const adapter = new TursoStorageAdapter(turso);
    const automergeUrl = generateAutomergeUrl();
    const documentKey = parseAutomergeUrl(automergeUrl).documentId;
    adapter.claimDocument(TENANT_A, automergeUrl);
    let settled = false;
    const pending = adapter.save([documentKey, 'snapshot', 'a'], new Uint8Array([1, 2, 3]))
      .finally(() => { settled = true; });

    await Promise.resolve();
    expect(settled).toBe(false);
    await registerDocument(turso, TENANT_A, 'document-race', automergeUrl);
    await adapter.notifyDocumentRegistered(TENANT_A, automergeUrl);
    await pending;

    expect(await adapter.load([documentKey, 'snapshot', 'a'])).toEqual(new Uint8Array([1, 2, 3]));
  });

  test('bounds pending writes and rejects only the claiming tenant queue when registration fails', async () => {
    const turso = await createMemoryTurso();
    databases.push(turso);
    const adapter = new TursoStorageAdapter(turso, { maxPendingWrites: 1 });
    const automergeUrl = generateAutomergeUrl();
    const documentKey = parseAutomergeUrl(automergeUrl).documentId;
    adapter.claimDocument(TENANT_A, automergeUrl);
    const first = adapter.save([documentKey, 'snapshot', 'a'], new Uint8Array([1]));

    await expect(adapter.save([documentKey, 'snapshot', 'b'], new Uint8Array([2])))
      .rejects.toThrow('capacity exceeded');
    adapter.failDocumentRegistration(TENANT_A, automergeUrl, new Error('canvas transaction failed'));
    await expect(first).rejects.toThrow('canvas transaction failed');
  });

  test('stores the same directory document id independently for two organizations', async () => {
    const turso = await createMemoryTurso();
    databases.push(turso);
    const orgAUrl = generateAutomergeUrl();
    const orgBUrl = generateAutomergeUrl();
    const orgAKey = parseAutomergeUrl(orgAUrl).documentId;
    const orgBKey = parseAutomergeUrl(orgBUrl).documentId;
    await registerDocument(turso, TENANT_A, 'same-document-id', orgAUrl);
    await registerDocument(turso, TENANT_B, 'same-document-id', orgBUrl);

    const adapter = new TursoStorageAdapter(turso);
    expect(await adapter.admitDocument(TENANT_A, orgAUrl)).toBe(true);
    expect(await adapter.admitDocument(TENANT_B, orgBUrl)).toBe(true);
    await adapter.save([orgAKey, 'snapshot', 'same-key'], new Uint8Array([1]));
    await adapter.save([orgBKey, 'snapshot', 'same-key'], new Uint8Array([2]));

    expect(await adapter.load([orgAKey, 'snapshot', 'same-key'])).toEqual(new Uint8Array([1]));
    expect(await adapter.load([orgBKey, 'snapshot', 'same-key'])).toEqual(new Uint8Array([2]));
    expect(await adapter.admitDocument(TENANT_B, orgAUrl)).toBe(false);
    expect(await adapter.admitDocument(TENANT_B, generateAutomergeUrl())).toBe(false);

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
    const ambiguousUrl = generateAutomergeUrl();
    await registerDocument(turso, TENANT_A, 'document-a', ambiguousUrl);
    await registerDocument(turso, TENANT_B, 'document-b', ambiguousUrl);
    const adapter = new TursoStorageAdapter(turso);

    expect(await adapter.admitDocument(TENANT_A, ambiguousUrl)).toBe(false);
    expect(await adapter.admitDocument(TENANT_B, ambiguousUrl)).toBe(false);
  });
});
