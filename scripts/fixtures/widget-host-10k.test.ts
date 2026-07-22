import { expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import * as Automerge from '@automerge/automerge';
import {
  WidgetInstanceMetadataProjector,
  fnWidgetInstanceProjectionSnapshot,
  type TWidgetInstanceProjectionSource,
} from '../../packages/service-automerge/src/projection/index';
import type { TCanvasDoc, TElement } from '../../packages/service-automerge/src/types/canvas-doc.types';
import { zCanvasDoc } from '../../packages/service-automerge/src/types/canvas-doc.zod';
import {
  DEFAULT_OSS_ACCOUNT_ID,
  DEFAULT_OSS_ORGANIZATION_ID,
} from '../../packages/service-db/src/CONSTANTS';
import { DbServiceTurso } from '../../packages/service-db/src/DbServiceTurso/DbServiceTurso';
import { WidgetInstanceMetadataStoreTurso } from '../../packages/service-db/src/WidgetInstanceMetadataStoreTurso';
import { fnFreezeTenantContext } from '../../packages/tenant-core/src/index';

const INSTANCE_COUNT = 10_000;
const DELETE_COUNT = 100;
const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const CANVAS_ID = uuid(10_001);
const AUTOMERGE_DOCUMENT_ID = uuid(10_006);
const DEFINITION_ID = uuid(10_002);
const REVISION_ID = uuid(10_003);
const UI_ARTIFACT_ID = uuid(10_004);
const rejectUnexpectedStateDocument = () => false;

const TENANT = fnFreezeTenantContext({
  orgId: DEFAULT_OSS_ORGANIZATION_ID,
  accountId: DEFAULT_OSS_ACCOUNT_ID,
  cellId: uuid(10_005),
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'widget-host-10k',
});

function neutralWidgetElement(index: number): TElement {
  const elementId = `widget-element-${String(index).padStart(5, '0')}`;
  return {
    id: elementId,
    x: (index % 100) * 24,
    y: Math.floor(index / 100) * 18,
    rotation: 0,
    zIndex: `z-${String(index).padStart(5, '0')}`,
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    data: {
      type: 'widget-instance',
      definitionId: DEFINITION_ID,
      revisionId: REVISION_ID,
      instanceId: uuid(20_000 + index),
      w: 240,
      h: 180,
      expanded: true,
      window: 'contained',
    },
    style: {},
  };
}

function projectionSource(doc: TCanvasDoc, sourceSequence: number): TWidgetInstanceProjectionSource {
  return { canvasId: CANVAS_ID, sourceSequence, elements: doc.elements };
}

async function seedWidgetRevision(service: DbServiceTurso): Promise<void> {
  await (await service.db.prepare(`
    INSERT INTO artifact_references (
      org_id, id, kind, digest_sha256, byte_size,
      retention_state, retain_until_ms, created_at_ms
    ) VALUES (?, ?, 'ui', ?, 10, 'pinned', NULL, 1)
  `)).run(TENANT.orgId, UI_ARTIFACT_ID, 'a'.repeat(64));
  await (await service.db.prepare(`
    INSERT INTO widget_definitions (
      org_id, id, slug, name, status, active_revision_id, created_at_ms, updated_at_ms
    ) VALUES (?, ?, 'widget-host-10k', 'Widget Host 10k', 'draft', NULL, 1, 1)
  `)).run(TENANT.orgId, DEFINITION_ID);
  await (await service.db.prepare(`
    INSERT INTO widget_definition_revisions (
      org_id, id, definition_id, revision_number, ui_artifact_id,
      ui_artifact_kind, server_artifact_id, server_artifact_kind,
      manifest_json, contract_digest_sha256, created_at_ms
    ) VALUES (?, ?, ?, 1, ?, 'ui', NULL, NULL, ?, ?, 1)
  `)).run(
    TENANT.orgId,
    REVISION_ID,
    DEFINITION_ID,
    UI_ARTIFACT_ID,
    JSON.stringify({ schemaVersion: 2, name: 'Widget Host 10k', slug: 'widget-host-10k', ui: { entry: 'ui.ts' } }),
    'b'.repeat(64),
  );
  await (await service.db.prepare(`
    UPDATE widget_definitions
    SET status = 'published', active_revision_id = ?, updated_at_ms = 2
    WHERE org_id = ? AND id = ?
  `)).run(REVISION_ID, TENANT.orgId, DEFINITION_ID);
}

async function countRows(service: DbServiceTurso, table: string, predicate = ''): Promise<number> {
  const allowed = new Set([
    'widget_instances',
    'function_invocations',
    'function_attempts',
  ]);
  if (!allowed.has(table)) throw new Error('Unexpected acceptance-proof table.');
  const row = await (await service.db.prepare(`
    SELECT count(*) AS count FROM ${table} WHERE org_id = ? ${predicate}
  `)).get(TENANT.orgId) as { count: unknown };
  return Number(row.count);
}

test('10,000 neutral widgets remain CRDT-only and converge through projection replay and undo', async () => {
  const originalSpawn = Bun.spawn;
  let spawnedProcessCount = 0;
  const monitoredSpawn = ((...args: Parameters<typeof Bun.spawn>) => {
    spawnedProcessCount += 1;
    return originalSpawn(...args);
  }) as typeof Bun.spawn;
  Object.defineProperty(Bun, 'spawn', { value: monitoredSpawn });

  const service = new DbServiceTurso({ databasePath: ':memory:', dataDir: '.', cacheDir: '.' });
  try {
    await service.start();
    await service.canvas.create(TENANT, {
      id: CANVAS_ID,
      name: 'Widget Host 10k',
      automerge_url: 'automerge:widget-host-10k',
    });
    await seedWidgetRevision(service);
    const elements: Record<string, TElement> = {};
    for (let index = 0; index < INSTANCE_COUNT; index += 1) {
      const element = neutralWidgetElement(index);
      elements[element.id] = element;
    }
    const initialValue = zCanvasDoc.parse({
      id: AUTOMERGE_DOCUMENT_ID,
      name: 'Widget Host 10k',
      elements,
      groups: {},
    });
    let doc = Automerge.from<TCanvasDoc>(initialValue, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const initialCrdtBytes = Automerge.save(doc).byteLength;

    const metadataStore = new WidgetInstanceMetadataStoreTurso(service.db);
    const collaborationDocument = await (await service.db.prepare(`
      SELECT updated_at_ms FROM collaboration_documents
      WHERE org_id = ? AND canvas_id = ?
    `)).get(TENANT.orgId, CANVAS_ID) as { updated_at_ms: unknown };
    let clockMs = Number(collaborationDocument.updated_at_ms) + 100;
    const projector = new WidgetInstanceMetadataProjector({
      store: metadataStore,
      nowMs: () => clockMs,
    }, { batchSize: 8 });

    const initialProjection = projector.enqueue(TENANT, projectionSource(doc, 1));
    expect(initialProjection).toMatchObject({ status: 'queued', canvasId: CANVAS_ID, sourceSequence: 1 });
    expect(doc.id).toBe(AUTOMERGE_DOCUMENT_ID);
    expect(doc.id).not.toBe(CANVAS_ID);
    await projector.drain();
    expect(await countRows(service, 'widget_instances')).toBe(INSTANCE_COUNT);
    expect(await countRows(service, 'widget_instances', "AND status = 'active'")).toBe(INSTANCE_COUNT);

    const deletedElements = Array.from({ length: DELETE_COUNT }, (_, index) => neutralWidgetElement(index));
    clockMs += 10;
    doc = Automerge.change(doc, { message: 'delete neutral widgets', time: 2 }, (draft) => {
      for (const element of deletedElements) delete draft.elements[element.id];
    });
    const deletedCrdtBytes = Automerge.save(doc).byteLength;
    const deletedProjection = projector.enqueue(TENANT, projectionSource(doc, 2));
    expect(deletedProjection).toMatchObject({ status: 'queued', sourceSequence: 2 });
    await projector.drain();
    expect(await countRows(service, 'widget_instances', "AND status = 'active'")).toBe(INSTANCE_COUNT - DELETE_COUNT);

    const replayBytes = Automerge.save(doc);
    const replayed = Automerge.load<TCanvasDoc>(replayBytes, { actor: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' });
    expect(Object.keys(replayed.elements)).toHaveLength(INSTANCE_COUNT - DELETE_COUNT);
    clockMs += 10;
    projector.enqueue(TENANT, projectionSource(replayed, 2));
    await projector.drain();
    expect(await countRows(service, 'widget_instances', "AND status = 'active'")).toBe(INSTANCE_COUNT - DELETE_COUNT);

    clockMs += 10;
    doc = Automerge.change(doc, { message: 'undo neutral widget deletion', time: 3 }, (draft) => {
      for (const element of deletedElements) draft.elements[element.id] = element;
    });
    const undoCrdtBytes = Automerge.save(doc).byteLength;
    projector.enqueue(TENANT, projectionSource(doc, 3));
    await projector.drain();
    expect(await countRows(service, 'widget_instances', "AND status = 'active'")).toBe(INSTANCE_COUNT);

    const staleDeletedSnapshot = fnWidgetInstanceProjectionSnapshot(
      projectionSource(replayed, 2),
      1,
      rejectUnexpectedStateDocument,
    );
    await expect(metadataStore.applyProjectionBatch(TENANT, { snapshots: [staleDeletedSnapshot] }))
      .resolves.toMatchObject([{ status: 'stale', activeCount: INSTANCE_COUNT }]);
    expect(await countRows(service, 'widget_instances')).toBe(INSTANCE_COUNT);
    expect(await countRows(service, 'widget_instances', "AND status = 'active'")).toBe(INSTANCE_COUNT);

    const initialSnapshot = fnWidgetInstanceProjectionSnapshot(
      projectionSource(initialValue, 1),
      1,
      rejectUnexpectedStateDocument,
    );
    const projectionPayloadBytes = Buffer.byteLength(JSON.stringify(initialSnapshot));
    expect(Buffer.byteLength(JSON.stringify(initialSnapshot))).toBe(projectionPayloadBytes);
    expect(initialCrdtBytes).toBeGreaterThan(0);
    expect(deletedCrdtBytes).toBeGreaterThan(0);
    expect(undoCrdtBytes).toBeGreaterThan(0);
    expect(projectionPayloadBytes).toBeGreaterThan(initialCrdtBytes);

    await projector.stop();
    expect(await countRows(service, 'function_invocations')).toBe(0);
    expect(await countRows(service, 'function_attempts')).toBe(0);
    expect(spawnedProcessCount).toBe(0);
    console.log(`[widget-host-10k-metrics] ${JSON.stringify({
      neutralWidgetCount: INSTANCE_COUNT,
      initialCrdtBytes,
      deletedCrdtBytes,
      replayCrdtBytes: replayBytes.byteLength,
      undoCrdtBytes,
      projectionPayloadBytes,
      guestChildProcesses: spawnedProcessCount,
      functionSandboxStarts: spawnedProcessCount,
      functionInvocationRows: 0,
      widgetInstanceRows: INSTANCE_COUNT,
    })}`);
  } finally {
    await service.stop();
    Object.defineProperty(Bun, 'spawn', { value: originalSpawn });
  }
}, 120_000);
