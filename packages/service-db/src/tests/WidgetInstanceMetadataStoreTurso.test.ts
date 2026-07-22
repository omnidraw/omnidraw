import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import { fnFreezeTenantContext } from '@vibecanvas/tenant-core';
import { DEFAULT_OSS_ACCOUNT_ID, DEFAULT_OSS_ORGANIZATION_ID } from '../CONSTANTS';
import { DbServiceTurso } from '../DbServiceTurso/DbServiceTurso';
import {
  WidgetInstanceMetadataStoreTurso,
  type TWidgetInstanceMetadataProjectionSnapshot,
} from '../WidgetInstanceMetadataStoreTurso';

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const CANVAS_ID = uuid(701);
const DEFINITION_ID = uuid(702);
const REVISION_ID = uuid(703);
const UI_ARTIFACT_ID = uuid(704);
const NEXT_DEFINITION_ID = uuid(706);
const NEXT_REVISION_ID = uuid(707);
const NEXT_UI_ARTIFACT_ID = uuid(708);
const STATE_DOCUMENT_ID = uuid(709);
const STATE_DOCUMENT_URL = 'automerge:4P9w8qKtNvbzkexUwmBRETTKQgLf';

const TENANT = fnFreezeTenantContext({
  orgId: DEFAULT_OSS_ORGANIZATION_ID,
  accountId: DEFAULT_OSS_ACCOUNT_ID,
  cellId: uuid(705),
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'widget-instance-projection',
});

const OTHER_TENANT: TTenantContext = Object.freeze({
  ...TENANT,
  orgId: uuid(799),
  requestId: 'foreign-widget-instance-projection',
});

function snapshot(
  sourceSequence: number,
  projectedAtMs: number,
  values: readonly number[],
): TWidgetInstanceMetadataProjectionSnapshot {
  return {
    canvasId: CANVAS_ID,
    sourceSequence,
    projectedAtMs,
    instances: values.map((value) => ({
      instanceId: uuid(800 + value),
      elementId: `element-${value}`,
      definitionId: DEFINITION_ID,
      revisionId: REVISION_ID,
      stateDocumentId: null,
    })),
  };
}

async function seedWidgetRevision(
  service: DbServiceTurso,
  args: Readonly<{
    definitionId: string;
    revisionId: string;
    artifactId: string;
    artifactDigest: string;
    slug: string;
  }> = {
    definitionId: DEFINITION_ID,
    revisionId: REVISION_ID,
    artifactId: UI_ARTIFACT_ID,
    artifactDigest: 'a'.repeat(64),
    slug: 'projection-fixture',
  },
): Promise<void> {
  await (await service.db.prepare(`
    INSERT INTO artifact_references (
      org_id, id, kind, digest_sha256, byte_size,
      retention_state, retain_until_ms, created_at_ms
    ) VALUES (?, ?, 'ui', ?, 10, 'pinned', NULL, 1)
  `)).run(TENANT.orgId, args.artifactId, args.artifactDigest);
  await (await service.db.prepare(`
    INSERT INTO widget_definitions (
      org_id, id, slug, name, status, active_revision_id, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, 'draft', NULL, 1, 1)
  `)).run(TENANT.orgId, args.definitionId, args.slug, args.slug);
  await (await service.db.prepare(`
    INSERT INTO widget_definition_revisions (
      org_id, id, definition_id, revision_number, ui_artifact_id,
      ui_artifact_kind, server_artifact_id, server_artifact_kind,
      manifest_json, contract_digest_sha256, created_at_ms
    ) VALUES (?, ?, ?, 1, ?, 'ui', NULL, NULL, ?, ?, 1)
  `)).run(
    TENANT.orgId,
    args.revisionId,
    args.definitionId,
    args.artifactId,
    JSON.stringify({ schemaVersion: 2, name: args.slug, slug: args.slug, ui: { entry: 'ui.ts' } }),
    'b'.repeat(64),
  );
  await (await service.db.prepare(`
    UPDATE widget_definitions
    SET status = 'published', active_revision_id = ?, updated_at_ms = 2
    WHERE org_id = ? AND id = ?
  `)).run(args.revisionId, TENANT.orgId, args.definitionId);
}

describe('WidgetInstanceMetadataStoreTurso', () => {
  let service: DbServiceTurso;
  let store: WidgetInstanceMetadataStoreTurso;
  let initialDocumentVersion: number;

  beforeEach(async () => {
    service = new DbServiceTurso({ databasePath: ':memory:', dataDir: '.', cacheDir: '.' });
    await service.start();
    await service.canvas.create(TENANT, {
      id: CANVAS_ID,
      name: 'Projection Canvas',
      automerge_url: 'automerge:projection-canvas',
    });
    await seedWidgetRevision(service);
    store = new WidgetInstanceMetadataStoreTurso(service.db, {
      isCanonicalStateDocumentId: (candidate) => (
        candidate === STATE_DOCUMENT_URL
        || candidate === 'automerge:2Te2QA9mUvN25Auy2J1M1GckJsCg'
      ),
    });
    const document = await (await service.db.prepare(`
      SELECT updated_at_ms FROM collaboration_documents
      WHERE org_id = ? AND canvas_id = ?
    `)).get(TENANT.orgId, CANVAS_ID) as { updated_at_ms: unknown };
    initialDocumentVersion = Number(document.updated_at_ms);
  });

  afterEach(async () => {
    await service.stop();
  });

  test('atomically upserts active metadata, archives missing identities, and replays idempotently', async () => {
    const first = snapshot(1, initialDocumentVersion + 1, [1, 2]);
    await expect(store.applyProjectionBatch(TENANT, { snapshots: [first] })).resolves.toEqual([{
      canvasId: CANVAS_ID,
      sourceSequence: 1,
      projectedAtMs: first.projectedAtMs,
      status: 'applied',
      activeCount: 2,
      archivedCount: 0,
    }]);
    await expect(store.applyProjectionBatch(TENANT, { snapshots: [first] })).resolves.toEqual([{
      canvasId: CANVAS_ID,
      sourceSequence: 1,
      projectedAtMs: first.projectedAtMs,
      status: 'replayed',
      activeCount: 2,
      archivedCount: 0,
    }]);

    const second = snapshot(2, first.projectedAtMs + 1, [2]);
    await expect(store.applyProjectionBatch(TENANT, { snapshots: [second] })).resolves.toEqual([{
      canvasId: CANVAS_ID,
      sourceSequence: 2,
      projectedAtMs: second.projectedAtMs,
      status: 'applied',
      activeCount: 1,
      archivedCount: 1,
    }]);
    expect(await store.listInstances(TENANT, { canvasId: CANVAS_ID })).toMatchObject([
      { instanceId: uuid(801), elementId: 'element-1', status: 'archived' },
      { instanceId: uuid(802), elementId: 'element-2', status: 'active' },
    ]);
  });

  test('uses its durable source head to prevent stale resurrection and archive', async () => {
    const populated = snapshot(1, initialDocumentVersion + 1, [1]);
    const empty = snapshot(2, initialDocumentVersion + 2, []);
    await store.applyProjectionBatch(TENANT, { snapshots: [populated] });
    await store.applyProjectionBatch(TENANT, { snapshots: [empty] });
    await expect(store.applyProjectionBatch(TENANT, { snapshots: [populated] })).resolves.toEqual([{
      canvasId: CANVAS_ID,
      sourceSequence: 1,
      projectedAtMs: empty.projectedAtMs,
      status: 'stale',
      activeCount: 0,
      archivedCount: 0,
    }]);
    expect(await store.listInstances(TENANT, { canvasId: CANVAS_ID })).toMatchObject([
      { instanceId: uuid(801), status: 'archived' },
    ]);

    const restored = snapshot(3, initialDocumentVersion + 3, [1]);
    await store.applyProjectionBatch(TENANT, { snapshots: [restored] });
    await store.applyProjectionBatch(TENANT, { snapshots: [empty] });
    expect(await store.listInstances(TENANT, { canvasId: CANVAS_ID, status: 'active' })).toHaveLength(1);
  });

  test('rebases a post-restart clock behind the durable projection head', async () => {
    const beforeRestart = snapshot(40, initialDocumentVersion + 1_000, [1]);
    const [firstResult] = await store.applyProjectionBatch(TENANT, { snapshots: [beforeRestart] });
    const afterRestartWithClockBehind = snapshot(41, 1, [1, 2]);
    const [restartedResult] = await store.applyProjectionBatch(TENANT, {
      snapshots: [afterRestartWithClockBehind],
    });

    expect(firstResult).toMatchObject({ status: 'applied', sourceSequence: 40 });
    expect(restartedResult).toMatchObject({ status: 'applied', sourceSequence: 41 });
    expect(restartedResult!.projectedAtMs).toBeGreaterThan(firstResult!.projectedAtMs);
    expect(await store.getProjectionHead(TENANT, { canvasId: CANVAS_ID })).toMatchObject({
      sourceSequence: 41,
      projectedAtMs: restartedResult!.projectedAtMs,
    });
    expect(await store.listInstances(TENANT, { canvasId: CANVAS_ID, status: 'active' })).toHaveLength(2);
  });

  test('atomically converges a pinned definition and revision change for the same instance', async () => {
    await seedWidgetRevision(service, {
      definitionId: NEXT_DEFINITION_ID,
      revisionId: NEXT_REVISION_ID,
      artifactId: NEXT_UI_ARTIFACT_ID,
      artifactDigest: 'c'.repeat(64),
      slug: 'projection-fixture-next',
    });
    const first = snapshot(1, initialDocumentVersion + 1, [1]);
    await store.applyProjectionBatch(TENANT, { snapshots: [first] });
    const before = (await store.listInstances(TENANT, { canvasId: CANVAS_ID }))[0]!;
    const repinned: TWidgetInstanceMetadataProjectionSnapshot = {
      ...snapshot(2, first.projectedAtMs + 1, [1]),
      instances: [{
        ...first.instances[0]!,
        definitionId: NEXT_DEFINITION_ID,
        revisionId: NEXT_REVISION_ID,
      }],
    };

    await expect(store.applyProjectionBatch(TENANT, { snapshots: [repinned] }))
      .resolves.toMatchObject([{ status: 'applied', activeCount: 1, archivedCount: 0 }]);
    expect(await store.listInstances(TENANT, { canvasId: CANVAS_ID })).toMatchObject([{
      instanceId: uuid(801),
      elementId: 'element-1',
      definitionId: NEXT_DEFINITION_ID,
      revisionId: NEXT_REVISION_ID,
      stateDocumentId: null,
      status: 'active',
      createdAtMs: before.createdAtMs,
    }]);
  });

  test('replaces a stateless element with a fresh instance identity', async () => {
    const first = snapshot(1, initialDocumentVersion + 1, [1]);
    await store.applyProjectionBatch(TENANT, { snapshots: [first] });
    const replacement: TWidgetInstanceMetadataProjectionSnapshot = {
      ...snapshot(2, first.projectedAtMs + 1, []),
      instances: [{
        ...first.instances[0]!,
        instanceId: uuid(899),
      }],
    };

    await expect(store.applyProjectionBatch(TENANT, { snapshots: [replacement] }))
      .resolves.toMatchObject([{ status: 'applied', activeCount: 1, archivedCount: 1 }]);
    expect(await store.listInstances(TENANT, { canvasId: CANVAS_ID })).toMatchObject([{
      instanceId: uuid(899),
      elementId: 'element-1',
      status: 'active',
    }]);
  });

  test('requires exact state ownership and explicit detach before replacing a stateful instance', async () => {
    await seedWidgetRevision(service, {
      definitionId: NEXT_DEFINITION_ID,
      revisionId: NEXT_REVISION_ID,
      artifactId: NEXT_UI_ARTIFACT_ID,
      artifactDigest: 'c'.repeat(64),
      slug: 'projection-fixture-next',
    });
    const first = snapshot(1, initialDocumentVersion + 1, [1]);
    expect(() => store.applyProjectionBatch(TENANT, {
      snapshots: [{
        ...first,
        instances: [{ ...first.instances[0]!, stateDocumentId: 'automerge:not-valid' }],
      }],
    })).toThrow('state document id is invalid');
    await store.applyProjectionBatch(TENANT, { snapshots: [first] });
    await (await service.db.prepare(`
      INSERT INTO collaboration_documents (
        org_id, id, canvas_id, widget_instance_id, automerge_url, partition_key,
        created_at_ms, updated_at_ms, content_version
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 0)
    `)).run(
      TENANT.orgId,
      STATE_DOCUMENT_ID,
      first.instances[0]!.instanceId,
      STATE_DOCUMENT_URL,
      TENANT.orgId,
      first.projectedAtMs + 1,
      first.projectedAtMs + 1,
    );
    const stateful: TWidgetInstanceMetadataProjectionSnapshot = {
      ...snapshot(2, first.projectedAtMs + 2, [1]),
      instances: [{ ...first.instances[0]!, stateDocumentId: STATE_DOCUMENT_URL }],
    };
    await expect(store.applyProjectionBatch(TENANT, { snapshots: [stateful] }))
      .resolves.toMatchObject([{ status: 'applied', activeCount: 1 }]);

    const statefulRepin: TWidgetInstanceMetadataProjectionSnapshot = {
      ...snapshot(3, stateful.projectedAtMs + 1, [1]),
      instances: [{
        ...first.instances[0]!,
        definitionId: NEXT_DEFINITION_ID,
        revisionId: NEXT_REVISION_ID,
        stateDocumentId: STATE_DOCUMENT_URL,
      }],
    };
    await expect(store.applyProjectionBatch(TENANT, { snapshots: [statefulRepin] }))
      .rejects.toMatchObject({ code: 'WIDGET_INSTANCE_PROJECTION_STATEFUL_REPIN' });
    expect(await store.getProjectionHead(TENANT, { canvasId: CANVAS_ID }))
      .toMatchObject({ sourceSequence: 2 });

    const wrongStateReference: TWidgetInstanceMetadataProjectionSnapshot = {
      ...snapshot(3, stateful.projectedAtMs + 1, [1]),
      instances: [{
        ...first.instances[0]!,
        stateDocumentId: 'automerge:2Te2QA9mUvN25Auy2J1M1GckJsCg',
      }],
    };
    await expect(store.applyProjectionBatch(TENANT, { snapshots: [wrongStateReference] }))
      .rejects.toMatchObject({ code: 'WIDGET_INSTANCE_PROJECTION_STATE_OWNERSHIP_CONFLICT' });

    const omittedStateReference = snapshot(3, stateful.projectedAtMs + 1, [1]);
    await expect(store.applyProjectionBatch(TENANT, { snapshots: [omittedStateReference] }))
      .rejects.toMatchObject({ code: 'WIDGET_INSTANCE_PROJECTION_STATE_REFERENCE_REQUIRED' });

    const replacement: TWidgetInstanceMetadataProjectionSnapshot = {
      ...snapshot(3, stateful.projectedAtMs + 2, []),
      instances: [{
        ...first.instances[0]!,
        instanceId: uuid(899),
        stateDocumentId: null,
      }],
    };
    await expect(store.applyProjectionBatch(TENANT, { snapshots: [replacement] }))
      .rejects.toMatchObject({ code: 'WIDGET_INSTANCE_PROJECTION_STATEFUL_REPLACEMENT' });
    expect(await (await service.db.prepare(`
      SELECT automerge_url FROM collaboration_documents
      WHERE org_id = ? AND id = ?
    `)).get(TENANT.orgId, STATE_DOCUMENT_ID)).toMatchObject({
      automerge_url: STATE_DOCUMENT_URL,
    });
    expect(await store.getProjectionHead(TENANT, { canvasId: CANVAS_ID }))
      .toMatchObject({ sourceSequence: 2 });

    await (await service.db.prepare(`
      DELETE FROM collaboration_documents WHERE org_id = ? AND id = ?
    `)).run(TENANT.orgId, STATE_DOCUMENT_ID);
    await expect(store.applyProjectionBatch(TENANT, { snapshots: [replacement] }))
      .resolves.toMatchObject([{ status: 'applied', activeCount: 1, archivedCount: 1 }]);
    expect(await store.listInstances(TENANT, { canvasId: CANVAS_ID })).toMatchObject([{
      instanceId: uuid(899),
      stateDocumentId: null,
      status: 'active',
    }]);
  });

  test('rolls back a reused instance identity and never leaks rows across tenants', async () => {
    const first = snapshot(1, initialDocumentVersion + 1, [1]);
    await store.applyProjectionBatch(TENANT, { snapshots: [first] });
    const conflicting: TWidgetInstanceMetadataProjectionSnapshot = {
      canvasId: CANVAS_ID,
      sourceSequence: 2,
      projectedAtMs: first.projectedAtMs + 1,
      instances: [{
        ...first.instances[0]!,
        elementId: 'different-element',
      }],
    };
    await expect(store.applyProjectionBatch(TENANT, { snapshots: [conflicting] }))
      .rejects.toMatchObject({ code: 'WIDGET_INSTANCE_PROJECTION_IDENTITY_CONFLICT' });
    expect(await store.listInstances(TENANT, { canvasId: CANVAS_ID })).toMatchObject([
      { instanceId: uuid(801), elementId: 'element-1', status: 'active' },
    ]);
    await expect(store.listInstances(OTHER_TENANT, { canvasId: CANVAS_ID })).resolves.toEqual([]);
    await expect(store.applyProjectionBatch(OTHER_TENANT, { snapshots: [conflicting] }))
      .rejects.toMatchObject({ code: 'WIDGET_INSTANCE_PROJECTION_CANVAS_NOT_FOUND' });
  });
});
