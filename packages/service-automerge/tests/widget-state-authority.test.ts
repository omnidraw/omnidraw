import { afterEach, describe, expect, test } from 'bun:test';
import * as Automerge from '@automerge/automerge';
import { generateAutomergeUrl, parseAutomergeUrl } from '@automerge/automerge-repo';
import { connect, type Database } from '@tursodatabase/database';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  MAX_AUTOMERGE_DOCUMENT_WRITE_AUTHORITIES,
  MAX_WIDGET_COLLABORATIVE_STATE_DURABLE_BYTES,
  MAX_WIDGET_COLLABORATIVE_STATE_ENCODED_CHANGE_BYTES,
  MAX_WIDGET_COLLABORATIVE_STATE_INCREMENTAL_CHUNK_BYTES,
} from '../src/CONSTANTS';
import { TursoStorageAdapter } from '../src/adapters/turso.adapter';
import { fnAssertWidgetCollaborativeStateEncodedQuota } from '../src/core/fn.widget-collaborative-state';
import type { TWidgetCollaborativeStateIdentity } from '../src/types/widget-state.types';

const TENANT: TTenantContext = Object.freeze({
  orgId: '11111111-1111-4111-8111-111111111111',
  accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  cellId: 'cell-test',
  placementEpoch: 1,
  roles: Object.freeze(['owner']),
  capabilities: Object.freeze(['canvas:write']),
  requestId: 'widget-state-authority',
  canvasId: '22222222-2222-4222-8222-222222222222',
});

const NON_MEMBER: TTenantContext = Object.freeze({
  ...TENANT,
  accountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  requestId: 'widget-state-authority-non-member',
});

const INSTANCE_ID = '33333333-3333-4333-8333-333333333333';
const DEFINITION_ID = '44444444-4444-4444-8444-444444444444';
const REVISION_ID = '55555555-5555-4555-8555-555555555555';
const DOCUMENT_ID = '66666666-6666-4666-8666-666666666666';
const CANVAS_DOCUMENT_ID = '77777777-7777-4777-8777-777777777777';
const ELEMENT_ID = 'widget-state-element';

type TMutableStateDocument = {
  schemaVersion: number;
  identity: Record<string, string>;
  state: unknown;
  unexpected?: boolean;
};

type THarness = Readonly<{
  database: Database;
  automergeUrl: string;
  documentKey: string;
  identity: TWidgetCollaborativeStateIdentity;
}>;

const databases: Database[] = [];

afterEach(async () => {
  while (databases.length > 0) await databases.pop()?.close();
});

async function createDatabase(): Promise<Database> {
  const database = await connect(':memory:');
  databases.push(database);
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

async function createHarness(): Promise<THarness> {
  const database = await createDatabase();
  const automergeUrl = generateAutomergeUrl();
  const identity: TWidgetCollaborativeStateIdentity = Object.freeze({
    orgId: TENANT.orgId,
    canvasId: TENANT.canvasId!,
    elementId: ELEMENT_ID,
    widgetInstanceId: INSTANCE_ID,
    definitionId: DEFINITION_ID,
    revisionId: REVISION_ID,
    stateDocumentId: automergeUrl,
  });
  await (await database.prepare(`
    INSERT INTO canvas_members (org_id, canvas_id, account_id)
    VALUES (?, ?, ?)
  `)).run(TENANT.orgId, TENANT.canvasId!, TENANT.accountId);
  await (await database.prepare(`
    INSERT INTO widget_instances (
      org_id, id, canvas_id, element_id, definition_id, revision_id, status
    ) VALUES (?, ?, ?, ?, ?, ?, 'active')
  `)).run(
    TENANT.orgId,
    INSTANCE_ID,
    TENANT.canvasId!,
    ELEMENT_ID,
    DEFINITION_ID,
    REVISION_ID,
  );
  await (await database.prepare(`
    INSERT INTO collaboration_documents (
      org_id, id, canvas_id, widget_instance_id, automerge_url
    ) VALUES (?, ?, ?, NULL, ?)
  `)).run(
    TENANT.orgId,
    CANVAS_DOCUMENT_ID,
    TENANT.canvasId!,
    generateAutomergeUrl(),
  );
  await (await database.prepare(`
    INSERT INTO widget_instance_projection_heads (org_id, canvas_id, source_sequence)
    VALUES (?, ?, 0)
  `)).run(TENANT.orgId, TENANT.canvasId!);
  await (await database.prepare(`
    INSERT INTO collaboration_documents (
      org_id, id, canvas_id, widget_instance_id, automerge_url
    ) VALUES (?, ?, NULL, ?, ?)
  `)).run(TENANT.orgId, DOCUMENT_ID, INSTANCE_ID, automergeUrl);
  return {
    database,
    automergeUrl,
    documentKey: parseAutomergeUrl(automergeUrl).documentId,
    identity,
  };
}

function documentBinary(value: TMutableStateDocument): Uint8Array {
  const document = Automerge.from<TMutableStateDocument>(value);
  try {
    return Automerge.save(document);
  } finally {
    Automerge.free(document);
  }
}

function validDocument(
  identity: TWidgetCollaborativeStateIdentity,
  state: unknown = {},
): TMutableStateDocument {
  return {
    schemaVersion: 1,
    identity: { ...identity },
    state,
  };
}

async function durableCounts(database: Database): Promise<Readonly<{
  contentVersion: number;
  chunkCount: number;
}>> {
  const document = await (await database.prepare(`
    SELECT content_version FROM collaboration_documents
    WHERE org_id = ? AND id = ?
  `)).get(TENANT.orgId, DOCUMENT_ID) as { content_version: number };
  const chunks = await (await database.prepare(`
    SELECT count(*) AS chunk_count FROM collaboration_chunks
    WHERE org_id = ? AND document_id = ?
  `)).get(TENANT.orgId, DOCUMENT_ID) as { chunk_count: number };
  return {
    contentVersion: Number(document.content_version),
    chunkCount: Number(chunks.chunk_count),
  };
}

function deeplyNestedState(): unknown {
  let value: unknown = null;
  for (let depth = 0; depth < 34; depth += 1) value = { child: value };
  return value;
}

function deterministicIncompressibleText(length: number): string {
  let seed = 0x12345678;
  const chunks: string[] = [];
  for (let offset = 0; offset < length; offset += 8_192) {
    const codes: number[] = [];
    const chunkLength = Math.min(8_192, length - offset);
    for (let index = 0; index < chunkLength; index += 1) {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      codes.push(33 + (seed % 90));
    }
    chunks.push(String.fromCharCode(...codes));
  }
  return chunks.join('');
}

describe('server-authoritative widget collaborative state', () => {
  test('accepts exact encoded byte boundaries and rejects each boundary plus one', () => {
    expect(() => fnAssertWidgetCollaborativeStateEncodedQuota([{
      byteLength: MAX_WIDGET_COLLABORATIVE_STATE_INCREMENTAL_CHUNK_BYTES,
      contentKind: 'incremental',
    }], [])).not.toThrow();
    expect(() => fnAssertWidgetCollaborativeStateEncodedQuota([{
      byteLength: MAX_WIDGET_COLLABORATIVE_STATE_INCREMENTAL_CHUNK_BYTES + 1,
      contentKind: 'incremental',
    }], [])).toThrow('incremental chunk');

    expect(() => fnAssertWidgetCollaborativeStateEncodedQuota([{
      byteLength: MAX_WIDGET_COLLABORATIVE_STATE_DURABLE_BYTES,
      contentKind: 'snapshot',
    }], [])).not.toThrow();
    expect(() => fnAssertWidgetCollaborativeStateEncodedQuota([{
      byteLength: MAX_WIDGET_COLLABORATIVE_STATE_DURABLE_BYTES + 1,
      contentKind: 'snapshot',
    }], [])).toThrow('durable byte quota');

    expect(() => fnAssertWidgetCollaborativeStateEncodedQuota([], [
      MAX_WIDGET_COLLABORATIVE_STATE_ENCODED_CHANGE_BYTES,
    ])).not.toThrow();
    expect(() => fnAssertWidgetCollaborativeStateEncodedQuota([], [
      MAX_WIDGET_COLLABORATIVE_STATE_ENCODED_CHANGE_BYTES + 1,
    ])).toThrow('change exceeds');

    const exactHistory = Array.from(
      {
        length: MAX_WIDGET_COLLABORATIVE_STATE_DURABLE_BYTES
          / MAX_WIDGET_COLLABORATIVE_STATE_ENCODED_CHANGE_BYTES,
      },
      () => MAX_WIDGET_COLLABORATIVE_STATE_ENCODED_CHANGE_BYTES,
    );
    expect(() => fnAssertWidgetCollaborativeStateEncodedQuota([], exactHistory)).not.toThrow();
    expect(() => fnAssertWidgetCollaborativeStateEncodedQuota(
      [],
      [...exactHistory, 1],
    )).toThrow('durable byte quota');
  });

  test('rejects a non-canonical URL before preparing storage statements', async () => {
    const database = await createDatabase();
    const adapter = new TursoStorageAdapter(database);
    await expect(adapter.admitDocument(TENANT, 'automerge:not-valid')).resolves.toBe(false);
  });

  test('serializes concurrent first admission into one retained replica and one flush', async () => {
    const harness = await createHarness();
    const seed = new TursoStorageAdapter(harness.database);
    await seed.admitDocument(TENANT, harness.automergeUrl);
    await seed.save(
      [harness.documentKey, 'snapshot', 'concurrent-admission-seed'],
      documentBinary(validDocument(harness.identity)),
    );
    seed.releaseDocument(TENANT, harness.automergeUrl);

    const adapter = new TursoStorageAdapter(harness.database);
    const internals = adapter as unknown as {
      loadWidgetStateReplica: (
        ...args: never[]
      ) => Automerge.Doc<unknown> | null;
      flushPendingWrites: (...args: never[]) => Promise<void>;
      widgetStateDocuments: Map<string, Automerge.Doc<unknown>>;
    };
    const loadWidgetStateReplica = internals.loadWidgetStateReplica.bind(adapter);
    const flushPendingWrites = internals.flushPendingWrites.bind(adapter);
    let replicaLoadCount = 0;
    let pendingFlushCount = 0;
    internals.loadWidgetStateReplica = (...args: never[]) => {
      replicaLoadCount += 1;
      return loadWidgetStateReplica(...args);
    };
    internals.flushPendingWrites = async (...args: never[]) => {
      pendingFlushCount += 1;
      await flushPendingWrites(...args);
    };

    const admissions = await Promise.all(Array.from(
      { length: 8 },
      () => adapter.admitDocument(TENANT, harness.automergeUrl),
    ));

    expect(admissions).toEqual(Array.from({ length: 8 }, () => true));
    expect(replicaLoadCount).toBe(1);
    expect(pendingFlushCount).toBe(1);
    expect(internals.widgetStateDocuments.size).toBe(1);
    adapter.releaseDocument(TENANT, harness.automergeUrl);
    expect(internals.widgetStateDocuments.size).toBe(0);
  });

  test('classifies only an exact active member-owned widget state identity', async () => {
    const harness = await createHarness();
    const adapter = new TursoStorageAdapter(harness.database);

    await expect(adapter.admitDocument(NON_MEMBER, harness.automergeUrl)).resolves.toBe(false);
    await expect(adapter.admitDocument(TENANT, harness.automergeUrl)).resolves.toBe(true);
    expect(adapter.getAdmittedDocumentAccess(TENANT, harness.automergeUrl)).toEqual({
      kind: 'widget-state',
      orgId: TENANT.orgId,
      canvasId: TENANT.canvasId,
      identity: harness.identity,
    });
  });

  test('denies known widget state while its owning canvas projection is behind', async () => {
    const harness = await createHarness();
    const adapter = new TursoStorageAdapter(harness.database);
    await expect(adapter.admitDocument(TENANT, harness.automergeUrl)).resolves.toBe(true);
    await adapter.save(
      [harness.documentKey, 'snapshot', 'projection-current'],
      documentBinary(validDocument(harness.identity)),
    );
    await (await harness.database.prepare(`
      UPDATE collaboration_documents
      SET content_version = content_version + 1
      WHERE org_id = ? AND id = ?
    `)).run(TENANT.orgId, CANVAS_DOCUMENT_ID);

    await expect(adapter.admitDocument(TENANT, harness.automergeUrl)).resolves.toBe(false);
    await expect(adapter.cloneAdmittedWidgetStateDocument(
      TENANT,
      harness.automergeUrl,
    )).resolves.toBeUndefined();
    await expect(adapter.save(
      [harness.documentKey, 'snapshot', 'projection-delayed'],
      documentBinary(validDocument(harness.identity)),
    )).rejects.toThrow('unavailable');
    expect(await durableCounts(harness.database)).toEqual({
      contentVersion: 1,
      chunkCount: 1,
    });
  });

  const invalidDocuments: ReadonlyArray<readonly [string, (identity: TWidgetCollaborativeStateIdentity) => TMutableStateDocument]> = [
    ['schema version', (identity) => ({ ...validDocument(identity), schemaVersion: 2 })],
    ['immutable identity', (identity) => validDocument({ ...identity, revisionId: DEFINITION_ID })],
    ['reserved key', (identity) => validDocument(identity, { constructor: 'forbidden' })],
    ['depth', (identity) => validDocument(identity, deeplyNestedState())],
    ['node count', (identity) => validDocument(identity, Array.from({ length: 10_001 }, () => null))],
    ['UTF-8 byte size', (identity) => validDocument(identity, 'x'.repeat(64 * 1024))],
    ['JSON-only values', (identity) => validDocument(identity, { counter: new Automerge.Counter(1) })],
    ['exact document shape', (identity) => ({ ...validDocument(identity), unexpected: true })],
  ];

  for (const [label, createInvalidDocument] of invalidDocuments) {
    test(`rejects invalid ${label} without a durable write or version advance`, async () => {
      const harness = await createHarness();
      const adapter = new TursoStorageAdapter(harness.database);
      await expect(adapter.admitDocument(TENANT, harness.automergeUrl)).resolves.toBe(true);

      await expect(adapter.save(
        [harness.documentKey, 'snapshot', `invalid-${label}`],
        documentBinary(createInvalidDocument(harness.identity)),
      )).rejects.toThrow();
      expect(await durableCounts(harness.database)).toEqual({
        contentVersion: 0,
        chunkCount: 0,
      });
    });
  }

  test('rechecks active ownership inside the serialized storage boundary', async () => {
    const harness = await createHarness();
    const adapter = new TursoStorageAdapter(harness.database);
    await expect(adapter.admitDocument(TENANT, harness.automergeUrl)).resolves.toBe(true);
    await (await harness.database.prepare(`
      UPDATE widget_instances SET status = 'archived'
      WHERE org_id = ? AND id = ?
    `)).run(TENANT.orgId, INSTANCE_ID);

    await expect(adapter.save(
      [harness.documentKey, 'snapshot', 'archived-owner'],
      documentBinary(validDocument(harness.identity)),
    )).rejects.toThrow('unavailable');
    expect(await durableCounts(harness.database)).toEqual({
      contentVersion: 0,
      chunkCount: 0,
    });
  });

  test('refreshes cached write authority when membership moves to another account', async () => {
    const harness = await createHarness();
    const adapter = new TursoStorageAdapter(harness.database);
    await expect(adapter.admitDocument(TENANT, harness.automergeUrl)).resolves.toBe(true);
    await (await harness.database.prepare(`
      INSERT INTO canvas_members (org_id, canvas_id, account_id)
      VALUES (?, ?, ?)
    `)).run(TENANT.orgId, TENANT.canvasId!, NON_MEMBER.accountId);
    await (await harness.database.prepare(`
      DELETE FROM canvas_members
      WHERE org_id = ? AND canvas_id = ? AND account_id = ?
    `)).run(TENANT.orgId, TENANT.canvasId!, TENANT.accountId);

    await expect(adapter.admitDocument(NON_MEMBER, harness.automergeUrl)).resolves.toBe(true);
    await expect(adapter.admitDocument(TENANT, harness.automergeUrl)).resolves.toBe(false);
    await adapter.save(
      [harness.documentKey, 'snapshot', 'replacement-member'],
      documentBinary(validDocument(harness.identity)),
    );
    expect(await durableCounts(harness.database)).toEqual({
      contentVersion: 1,
      chunkCount: 1,
    });
  });

  test('keeps an earlier valid account authorized across a later account admission', async () => {
    const harness = await createHarness();
    const adapter = new TursoStorageAdapter(harness.database);
    await adapter.admitDocument(TENANT, harness.automergeUrl);
    await adapter.save(
      [harness.documentKey, 'snapshot', 'interleaved-account-base'],
      documentBinary(validDocument(harness.identity, { count: 0 })),
    );
    const base = await adapter.cloneAdmittedWidgetStateDocument(
      TENANT,
      harness.automergeUrl,
    );
    expect(base).toBeDefined();
    if (base === undefined) throw new Error('Expected an admitted widget-state replica.');
    const prospective = Automerge.change(Automerge.clone(base), (draft) => {
      (draft as TMutableStateDocument).state = { count: 1 };
    });
    const changes = Automerge.getChanges(base, prospective);

    await (await harness.database.prepare(`
      INSERT INTO canvas_members (org_id, canvas_id, account_id)
      VALUES (?, ?, ?)
    `)).run(TENANT.orgId, TENANT.canvasId!, NON_MEMBER.accountId);
    await expect(adapter.admitDocument(NON_MEMBER, harness.automergeUrl)).resolves.toBe(true);
    await expect(adapter.preflightWidgetStateSync(
      TENANT,
      harness.automergeUrl,
      prospective,
      changes,
    )).resolves.toBeUndefined();

    Automerge.free(prospective);
    Automerge.free(base);
  });

  test('bounds cached document write authorities with least-recent replacement', async () => {
    const harness = await createHarness();
    const adapter = new TursoStorageAdapter(harness.database);
    await adapter.admitDocument(TENANT, harness.automergeUrl);
    const insertMember = await harness.database.prepare(`
      INSERT INTO canvas_members (org_id, canvas_id, account_id)
      VALUES (?, ?, ?)
    `);
    const additionalTenants = Array.from(
      { length: MAX_AUTOMERGE_DOCUMENT_WRITE_AUTHORITIES },
      (_, index): TTenantContext => Object.freeze({
        ...TENANT,
        accountId: `bounded-authority-${index}`,
        requestId: `bounded-authority-${index}`,
      }),
    );
    for (const tenantContext of additionalTenants) {
      await insertMember.run(TENANT.orgId, TENANT.canvasId!, tenantContext.accountId);
      await expect(adapter.admitDocument(tenantContext, harness.automergeUrl)).resolves.toBe(true);
    }

    const internals = adapter as unknown as {
      documentWriteAuthorities: Map<string, Map<string, unknown>>;
    };
    const authorities = [...internals.documentWriteAuthorities.values()][0];
    expect(authorities?.size).toBe(MAX_AUTOMERGE_DOCUMENT_WRITE_AUTHORITIES);
    expect(authorities?.has(TENANT.accountId)).toBe(false);
    expect(authorities?.has(additionalTenants.at(-1)!.accountId)).toBe(true);
  });

  test('stops a pending registration flush after the first invalid write', async () => {
    const harness = await createHarness();
    const adapter = new TursoStorageAdapter(harness.database);
    await expect(adapter.admitDocument(NON_MEMBER, harness.automergeUrl)).resolves.toBe(false);
    adapter.claimDocument(TENANT, harness.automergeUrl);
    const invalid = adapter.save(
      [harness.documentKey, 'snapshot', 'pending-invalid'],
      new Uint8Array([1, 2, 3]),
    ).then(() => null, (error: unknown) => error);
    const valid = adapter.save(
      [harness.documentKey, 'snapshot', 'pending-valid'],
      documentBinary(validDocument(harness.identity)),
    ).then(() => null, (error: unknown) => error);
    await Promise.resolve();
    expect(adapter.getTenantMetrics(TENANT).pendingWrites).toBe(2);

    await expect(adapter.notifyDocumentRegistered(TENANT, harness.automergeUrl)).rejects.toThrow();
    expect(await invalid).toBeInstanceOf(Error);
    expect(await valid).toBeInstanceOf(Error);
    expect(await durableCounts(harness.database)).toEqual({
      contentVersion: 0,
      chunkCount: 0,
    });
  });

  test('rejects invalid pre-existing state content on admission', async () => {
    const harness = await createHarness();
    const invalid = documentBinary({ ...validDocument(harness.identity), schemaVersion: 2 });
    await (await harness.database.prepare(`
      INSERT INTO collaboration_chunks (
        org_id, document_id, chunk_key, sequence, chunk_bytes, created_at_ms
      ) VALUES (?, ?, ?, 0, ?, 1)
    `)).run(
      TENANT.orgId,
      DOCUMENT_ID,
      `${harness.documentKey}.snapshot.invalid`,
      invalid,
    );
    await (await harness.database.prepare(`
      UPDATE collaboration_documents SET content_version = 1
      WHERE org_id = ? AND id = ?
    `)).run(TENANT.orgId, DOCUMENT_ID);

    const adapter = new TursoStorageAdapter(harness.database);
    await expect(adapter.admitDocument(TENANT, harness.automergeUrl)).resolves.toBe(false);
    expect(await durableCounts(harness.database)).toEqual({
      contentVersion: 1,
      chunkCount: 1,
    });
  });

  test('rejects a persisted widget document over its storage quota before decoding', async () => {
    const harness = await createHarness();
    await (await harness.database.prepare(`
      INSERT INTO collaboration_chunks (
        org_id, document_id, chunk_key, sequence, chunk_bytes, created_at_ms
      ) VALUES (?, ?, ?, 0, ?, 1)
    `)).run(
      TENANT.orgId,
      DOCUMENT_ID,
      `${harness.documentKey}.metadata.oversized`,
      new Uint8Array(MAX_WIDGET_COLLABORATIVE_STATE_DURABLE_BYTES + 1),
    );

    const adapter = new TursoStorageAdapter(harness.database);
    await expect(adapter.admitDocument(TENANT, harness.automergeUrl)).resolves.toBe(false);
    expect(await durableCounts(harness.database)).toEqual({
      contentVersion: 0,
      chunkCount: 1,
    });
  });

  test('admits the exact durable storage boundary and rejects one additional byte', async () => {
    const harness = await createHarness();
    const adapter = new TursoStorageAdapter(harness.database);
    await expect(adapter.admitDocument(TENANT, harness.automergeUrl)).resolves.toBe(true);

    await adapter.save(
      [harness.documentKey, 'metadata', 'exact-quota'],
      new Uint8Array(MAX_WIDGET_COLLABORATIVE_STATE_DURABLE_BYTES),
    );
    await expect(adapter.save(
      [harness.documentKey, 'metadata', 'over-quota'],
      new Uint8Array([1]),
    )).rejects.toThrow('durable byte quota');
    expect(await durableCounts(harness.database)).toEqual({
      contentVersion: 0,
      chunkCount: 1,
    });
  });

  test('rejects transient deleted values retained only in encoded Automerge history', async () => {
    const harness = await createHarness();
    const adapter = new TursoStorageAdapter(harness.database);
    await expect(adapter.admitDocument(TENANT, harness.automergeUrl)).resolves.toBe(true);

    let document = Automerge.from<TMutableStateDocument>(validDocument(harness.identity));
    await adapter.save(
      [harness.documentKey, 'snapshot', 'transient-base'],
      Automerge.save(document),
    );
    const payload = deterministicIncompressibleText(
      MAX_WIDGET_COLLABORATIVE_STATE_ENCODED_CHANGE_BYTES + 32 * 1024,
    );
    document = Automerge.change(document, (draft) => {
      const state = draft.state as Record<string, string>;
      state.transient = payload;
      delete state.transient;
    });
    const lastChange = Automerge.getLastLocalChange(document);
    const snapshot = Automerge.save(document);
    expect(Automerge.toJS(document).state).toEqual({});
    expect(lastChange?.byteLength).toBeGreaterThan(
      MAX_WIDGET_COLLABORATIVE_STATE_ENCODED_CHANGE_BYTES,
    );
    expect(snapshot.byteLength).toBeLessThanOrEqual(
      MAX_WIDGET_COLLABORATIVE_STATE_DURABLE_BYTES,
    );

    await expect(adapter.save(
      [harness.documentKey, 'snapshot', 'transient-deleted'],
      snapshot,
    )).rejects.toThrow('change exceeds');
    expect(await durableCounts(harness.database)).toEqual({
      contentVersion: 1,
      chunkCount: 1,
    });
    Automerge.free(document);
  });

  test('enforces twenty durable mutations per second without advancing the rejected change', async () => {
    const harness = await createHarness();
    let now = 100;
    const adapter = new TursoStorageAdapter(harness.database, { nowMs: () => now });
    await adapter.admitDocument(TENANT, harness.automergeUrl);

    let document = Automerge.from<TMutableStateDocument>(validDocument(harness.identity, { count: 0 }));
    await adapter.save(
      [harness.documentKey, 'snapshot', 'rate-0'],
      Automerge.save(document),
    );
    for (let mutation = 1; mutation < 20; mutation += 1) {
      const heads = Automerge.getHeads(document);
      document = Automerge.change(document, (draft) => {
        draft.state = { count: mutation };
      });
      await adapter.save(
        [harness.documentKey, 'incremental', `rate-${mutation}`],
        Automerge.saveSince(document, heads),
      );
    }

    const heads = Automerge.getHeads(document);
    document = Automerge.change(document, (draft) => {
      draft.state = { count: 20 };
    });
    const rejectedChange = Automerge.saveSince(document, heads);
    await expect(adapter.save(
      [harness.documentKey, 'incremental', 'rate-20'],
      rejectedChange,
    )).rejects.toThrow('rate limit');
    expect(await durableCounts(harness.database)).toEqual({
      contentVersion: 20,
      chunkCount: 20,
    });

    now = 1_101;
    await adapter.save(
      [harness.documentKey, 'incremental', 'rate-20'],
      rejectedChange,
    );
    expect(await durableCounts(harness.database)).toEqual({
      contentVersion: 21,
      chunkCount: 21,
    });
    Automerge.free(document);
  });

  test('expires, bounds, and clears remote mutation reservations', async () => {
    const harness = await createHarness();
    let now = 0;
    const adapter = new TursoStorageAdapter(harness.database, {
      nowMs: () => now,
      widgetStateMutationRateLimit: 100,
      widgetStateMutationReservationTtlMs: 10,
      maxWidgetStateMutationReservationsPerDocument: 4,
    });
    await adapter.admitDocument(TENANT, harness.automergeUrl);
    await adapter.save(
      [harness.documentKey, 'snapshot', 'reservation-base'],
      documentBinary(validDocument(harness.identity, { count: 0 })),
    );
    const base = await adapter.cloneAdmittedWidgetStateDocument(
      TENANT,
      harness.automergeUrl,
    );
    expect(base).toBeDefined();
    if (base === undefined) throw new Error('Expected an admitted widget-state replica.');
    const first = Automerge.change(Automerge.clone(base), (draft) => {
      (draft as TMutableStateDocument).state = { count: 1 };
    });
    const firstChanges = Automerge.getChanges(base, first);
    const firstHash = Automerge.decodeChange(firstChanges[0]!).hash;
    now = 1;
    await adapter.preflightWidgetStateSync(
      TENANT,
      harness.automergeUrl,
      first,
      firstChanges,
    );

    const internals = adapter as unknown as {
      widgetStateReservedChangeHashes: Map<string, Map<string, unknown>>;
    };
    expect([...internals.widgetStateReservedChangeHashes.values()][0]?.has(firstHash)).toBe(true);

    const second = Automerge.change(Automerge.clone(base), (draft) => {
      (draft as TMutableStateDocument).state = { count: 2 };
    });
    const secondChanges = Automerge.getChanges(base, second);
    now = 12;
    await adapter.preflightWidgetStateSync(
      TENANT,
      harness.automergeUrl,
      second,
      secondChanges,
    );
    const afterExpiry = [...internals.widgetStateReservedChangeHashes.values()][0];
    expect(afterExpiry?.size).toBe(1);
    expect(afterExpiry?.has(firstHash)).toBe(false);

    adapter.releaseDocument(TENANT, harness.automergeUrl);
    expect(internals.widgetStateReservedChangeHashes.size).toBe(0);
    Automerge.free(second);
    Automerge.free(first);
    Automerge.free(base);

    const capped = new TursoStorageAdapter(harness.database, {
      nowMs: () => now,
      widgetStateMutationRateLimit: 100,
      maxWidgetStateMutationReservationsPerDocument: 1,
    });
    await capped.admitDocument(TENANT, harness.automergeUrl);
    const cappedBase = await capped.cloneAdmittedWidgetStateDocument(
      TENANT,
      harness.automergeUrl,
    );
    expect(cappedBase).toBeDefined();
    if (cappedBase === undefined) throw new Error('Expected an admitted widget-state replica.');
    let cappedProspective = Automerge.change(Automerge.clone(cappedBase), (draft) => {
      (draft as TMutableStateDocument).state = { count: 3 };
    });
    cappedProspective = Automerge.change(cappedProspective, (draft) => {
      (draft as TMutableStateDocument).state = { count: 4 };
    });
    const cappedChanges = Automerge.getChanges(cappedBase, cappedProspective);
    expect(cappedChanges).toHaveLength(2);
    await expect(capped.preflightWidgetStateSync(
      TENANT,
      harness.automergeUrl,
      cappedProspective,
      cappedChanges,
    )).rejects.toThrow('reservation capacity');
    const cappedInternals = capped as unknown as {
      widgetStateReservedChangeHashes: Map<string, Map<string, unknown>>;
    };
    expect(cappedInternals.widgetStateReservedChangeHashes.size).toBe(0);
    Automerge.free(cappedProspective);
    Automerge.free(cappedBase);
  });

  test('rejects more than twenty Automerge changes hidden in one incremental', async () => {
    const harness = await createHarness();
    let now = 0;
    const adapter = new TursoStorageAdapter(harness.database, { nowMs: () => now });
    await adapter.admitDocument(TENANT, harness.automergeUrl);
    let document = Automerge.from<TMutableStateDocument>(validDocument(harness.identity, { count: 0 }));
    await adapter.save(
      [harness.documentKey, 'snapshot', 'batch-0'],
      Automerge.save(document),
    );
    const batchHeads = Automerge.getHeads(document);
    for (let mutation = 1; mutation <= 21; mutation += 1) {
      document = Automerge.change(document, (draft) => {
        draft.state = { count: mutation };
      });
    }
    now = 1_001;

    await expect(adapter.save(
      [harness.documentKey, 'incremental', 'batch-21'],
      Automerge.saveSince(document, batchHeads),
    )).rejects.toThrow('rate limit');
    expect(await durableCounts(harness.database)).toEqual({
      contentVersion: 1,
      chunkCount: 1,
    });
    Automerge.free(document);
  });

  test('does not charge a same-head compaction snapshot as a mutation', async () => {
    const harness = await createHarness();
    let now = 0;
    const adapter = new TursoStorageAdapter(harness.database, {
      nowMs: () => now,
      widgetStateMutationRateLimit: 1,
    });
    await adapter.admitDocument(TENANT, harness.automergeUrl);
    let document = Automerge.from<TMutableStateDocument>(validDocument(harness.identity, { count: 0 }));
    await adapter.save(
      [harness.documentKey, 'snapshot', 'compaction-0'],
      Automerge.save(document),
    );
    now = 1_001;
    await adapter.save(
      [harness.documentKey, 'snapshot', 'compaction-same-head'],
      Automerge.save(document),
    );

    const heads = Automerge.getHeads(document);
    document = Automerge.change(document, (draft) => {
      draft.state = { count: 1 };
    });
    await adapter.save(
      [harness.documentKey, 'incremental', 'compaction-next-change'],
      Automerge.saveSince(document, heads),
    );
    expect(await durableCounts(harness.database)).toEqual({
      contentVersion: 3,
      chunkCount: 3,
    });
    Automerge.free(document);
  });

  test('reconstructs valid state across release, reconnect, and further convergence', async () => {
    const harness = await createHarness();
    const first = new TursoStorageAdapter(harness.database);
    await first.admitDocument(TENANT, harness.automergeUrl);
    let document = Automerge.from<TMutableStateDocument>(validDocument(harness.identity, { count: 0 }));
    await first.save(
      [harness.documentKey, 'snapshot', 'valid-0'],
      Automerge.save(document),
    );
    const firstHeads = Automerge.getHeads(document);
    document = Automerge.change(document, (draft) => {
      draft.state = { count: 1 };
    });
    await first.save(
      [harness.documentKey, 'incremental', 'valid-1'],
      Automerge.saveSince(document, firstHeads),
    );
    first.releaseDocument(TENANT, harness.automergeUrl);

    const second = new TursoStorageAdapter(harness.database);
    await expect(second.admitDocument(TENANT, harness.automergeUrl)).resolves.toBe(true);
    const secondHeads = Automerge.getHeads(document);
    document = Automerge.change(document, (draft) => {
      draft.state = { count: 2 };
    });
    await second.save(
      [harness.documentKey, 'incremental', 'valid-2'],
      Automerge.saveSince(document, secondHeads),
    );
    second.releaseDocument(TENANT, harness.automergeUrl);

    const third = new TursoStorageAdapter(harness.database);
    await expect(third.admitDocument(TENANT, harness.automergeUrl)).resolves.toBe(true);
    expect(await durableCounts(harness.database)).toEqual({
      contentVersion: 3,
      chunkCount: 3,
    });
    Automerge.free(document);
  });

  test('retains a bounded rate window across release and clears it on forget or dispose', async () => {
    const harness = await createHarness();
    let now = 100;
    const adapter = new TursoStorageAdapter(harness.database, {
      nowMs: () => now,
      widgetStateMutationRateLimit: 1,
    });
    await adapter.admitDocument(TENANT, harness.automergeUrl);
    let document = Automerge.from<TMutableStateDocument>(validDocument(harness.identity, { count: 0 }));
    await adapter.save(
      [harness.documentKey, 'snapshot', 'cleanup-0'],
      Automerge.save(document),
    );

    let heads = Automerge.getHeads(document);
    document = Automerge.change(document, (draft) => {
      draft.state = { count: 1 };
    });
    const afterRelease = Automerge.saveSince(document, heads);
    await expect(adapter.save(
      [harness.documentKey, 'incremental', 'cleanup-1'],
      afterRelease,
    )).rejects.toThrow('rate limit');
    adapter.releaseDocument(TENANT, harness.automergeUrl);
    const retained = adapter as unknown as {
      widgetStateDocuments: Map<string, unknown>;
      widgetStateMutationTimes: Map<string, unknown>;
      widgetStateLastClock: Map<string, unknown>;
    };
    expect(retained.widgetStateDocuments.size).toBe(0);
    expect(retained.widgetStateMutationTimes.size).toBe(1);
    await adapter.admitDocument(TENANT, harness.automergeUrl);
    await expect(adapter.save(
      [harness.documentKey, 'incremental', 'cleanup-1'],
      afterRelease,
    )).rejects.toThrow('rate limit');

    now = 1_101;
    adapter.releaseDocument(TENANT, harness.automergeUrl);
    expect(retained.widgetStateDocuments.size).toBe(0);
    expect(retained.widgetStateMutationTimes.size).toBe(0);
    expect(retained.widgetStateLastClock.size).toBe(0);
    await adapter.admitDocument(TENANT, harness.automergeUrl);
    await adapter.save(
      [harness.documentKey, 'incremental', 'cleanup-1'],
      afterRelease,
    );

    heads = Automerge.getHeads(document);
    document = Automerge.change(document, (draft) => {
      draft.state = { count: 2 };
    });
    const afterForget = Automerge.saveSince(document, heads);
    await expect(adapter.save(
      [harness.documentKey, 'incremental', 'cleanup-2'],
      afterForget,
    )).rejects.toThrow('rate limit');
    adapter.forgetDocument(TENANT, harness.automergeUrl);
    expect(retained.widgetStateDocuments.size).toBe(0);
    expect(retained.widgetStateMutationTimes.size).toBe(0);
    expect(retained.widgetStateLastClock.size).toBe(0);
    await adapter.admitDocument(TENANT, harness.automergeUrl);
    await adapter.save(
      [harness.documentKey, 'incremental', 'cleanup-2'],
      afterForget,
    );

    adapter.dispose();
    expect(retained.widgetStateDocuments.size).toBe(0);
    expect(retained.widgetStateMutationTimes.size).toBe(0);
    expect(retained.widgetStateLastClock.size).toBe(0);
    Automerge.free(document);
  });
});
