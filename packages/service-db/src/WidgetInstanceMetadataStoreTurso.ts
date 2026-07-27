import { createHash } from 'node:crypto';
import type { Database } from '@tursodatabase/database';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  fnNextWidgetInstanceProjectionTimestamp,
  fnValidateWidgetInstanceMetadataProjectionSnapshot,
} from './fn.widget-instance-metadata-projection';
import { txRunDatabaseTransaction } from './tx.run-database-transaction';

export type TWidgetInstanceMetadataProjectionRecord = Readonly<{
  instanceId: string;
  elementId: string;
  definitionId: string;
  revisionId: string;
  stateDocumentId: string | null;
}>;

export type TWidgetInstanceMetadataProjectionSnapshot = Readonly<{
  canvasId: string;
  sourceSequence: number;
  projectedAtMs: number;
  instances: readonly TWidgetInstanceMetadataProjectionRecord[];
}>;

export type TWidgetInstanceMetadataProjectionBatchRequest = Readonly<{
  snapshots: readonly TWidgetInstanceMetadataProjectionSnapshot[];
}>;

export type TWidgetInstanceMetadataProjectionApplyResult = Readonly<{
  canvasId: string;
  sourceSequence: number;
  projectedAtMs: number;
  status: 'applied' | 'replayed' | 'stale';
  activeCount: number;
  archivedCount: number;
}>;

export type TWidgetInstanceMetadataProjectionHead = Readonly<{
  canvasId: string;
  sourceSequence: number;
  snapshotDigestSha256: string;
  projectedAtMs: number;
}>;

export type TWidgetInstanceMetadataDescriptor = Readonly<{
  orgId: string;
  instanceId: string;
  canvasId: string;
  elementId: string;
  definitionId: string;
  revisionId: string;
  stateDocumentId: string | null;
  status: 'active' | 'archived';
  createdAtMs: number;
  updatedAtMs: number;
}>;

type TStoredWidgetInstanceRow = Readonly<{
  org_id: string;
  id: string;
  canvas_id: string;
  element_id: string;
  definition_id: string;
  revision_id: string;
  state_document_id: string | null;
  status: 'active' | 'archived';
  created_at_ms: unknown;
  updated_at_ms: unknown;
}>;

type TStoredProjectionHeadRow = Readonly<{
  canvas_id: string;
  source_sequence: unknown;
  snapshot_digest_sha256: string;
  projected_at_ms: unknown;
}>;

const MAX_PROJECTION_BATCH = 100;
const INSERT_CHUNK_SIZE = 250;

export type TWidgetInstanceMetadataStoreOptions = Readonly<{
  isCanonicalStateDocumentId?: (candidate: unknown) => boolean;
}>;

function projectionError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function safeInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw projectionError('WIDGET_INSTANCE_PROJECTION_ROW_INVALID', `${label} is invalid.`);
  }
  return parsed;
}

/** Durable, tenant-qualified metadata projection for neutral canvas widgets. */
export class WidgetInstanceMetadataStoreTurso {
  readonly #database: Database;
  readonly #isCanonicalStateDocumentId: (candidate: unknown) => boolean;

  constructor(
    database: Database,
    options: TWidgetInstanceMetadataStoreOptions = {},
  ) {
    this.#database = database;
    this.#isCanonicalStateDocumentId = options.isCanonicalStateDocumentId ?? (() => false);
  }

  applyProjectionBatch(
    tenant: TTenantContext,
    request: TWidgetInstanceMetadataProjectionBatchRequest,
  ): Promise<readonly TWidgetInstanceMetadataProjectionApplyResult[]> {
    if (request.snapshots.length < 1 || request.snapshots.length > MAX_PROJECTION_BATCH) {
      return Promise.reject(new RangeError('Widget instance projection batch must contain 1 to 100 snapshots.'));
    }
    const canvasIds = new Set<string>();
    for (const snapshot of request.snapshots) {
      fnValidateWidgetInstanceMetadataProjectionSnapshot(
        snapshot,
        this.#isCanonicalStateDocumentId,
      );
      if (canvasIds.has(snapshot.canvasId)) {
        return Promise.reject(new TypeError('Widget instance projection batch contains the same canvas twice.'));
      }
      canvasIds.add(snapshot.canvasId);
    }
    return this.#runImmediate(async () => {
      const results: TWidgetInstanceMetadataProjectionApplyResult[] = [];
      for (const snapshot of request.snapshots) {
        results.push(await this.#applySnapshot(tenant, snapshot));
      }
      return Object.freeze(results);
    });
  }

  async listInstances(
    tenant: TTenantContext,
    request: Readonly<{ canvasId: string; status?: 'active' | 'archived' }>,
  ): Promise<readonly TWidgetInstanceMetadataDescriptor[]> {
    const rows = await (await this.#database.prepare(`
      SELECT instance.*,
        state_document.automerge_url AS state_document_id
      FROM widget_instances AS instance
      LEFT JOIN collaboration_documents AS state_document
        ON state_document.org_id = instance.org_id
        AND state_document.widget_instance_id = instance.id
      WHERE instance.org_id = ? AND instance.canvas_id = ?
        AND (? IS NULL OR instance.status = ?)
      ORDER BY instance.element_id ASC, instance.id ASC
    `)).all(
      tenant.orgId,
      request.canvasId,
      request.status ?? null,
      request.status ?? null,
    ) as TStoredWidgetInstanceRow[];
    return Object.freeze(rows.map((row) => this.#descriptor(row)));
  }

  async getProjectionHead(
    tenant: TTenantContext,
    request: Readonly<{ canvasId: string }>,
  ): Promise<TWidgetInstanceMetadataProjectionHead | null> {
    const row = await (await this.#database.prepare(`
      SELECT canvas_id, source_sequence, snapshot_digest_sha256, projected_at_ms
      FROM widget_instance_projection_heads
      WHERE org_id = ? AND canvas_id = ?
    `)).get(tenant.orgId, request.canvasId) as TStoredProjectionHeadRow | null;
    return row ? this.#projectionHead(row) : null;
  }

  async #applySnapshot(
    tenant: TTenantContext,
    snapshot: TWidgetInstanceMetadataProjectionSnapshot,
  ): Promise<TWidgetInstanceMetadataProjectionApplyResult> {
    const document = await (await this.#database.prepare(`
      SELECT created_at_ms, updated_at_ms
      FROM collaboration_documents
      WHERE org_id = ? AND canvas_id = ?
    `)).get(tenant.orgId, snapshot.canvasId) as {
      created_at_ms: unknown;
      updated_at_ms: unknown;
    } | null;
    if (!document) {
      throw projectionError(
        'WIDGET_INSTANCE_PROJECTION_CANVAS_NOT_FOUND',
        'Widget instance projection canvas was not found in the tenant.',
      );
    }
    const digestSha256 = this.#snapshotDigest(snapshot);
    const head = await this.getProjectionHead(tenant, { canvasId: snapshot.canvasId });
    if (head && head.sourceSequence > snapshot.sourceSequence) {
      return {
        canvasId: snapshot.canvasId,
        sourceSequence: snapshot.sourceSequence,
        projectedAtMs: head.projectedAtMs,
        status: 'stale',
        activeCount: await this.#activeCount(tenant, snapshot.canvasId),
        archivedCount: 0,
      };
    }
    if (head && head.sourceSequence === snapshot.sourceSequence) {
      if (head.snapshotDigestSha256 !== digestSha256) {
        throw projectionError(
          'WIDGET_INSTANCE_PROJECTION_VERSION_CONFLICT',
          'A different widget instance snapshot already owns this collaboration source sequence.',
        );
      }
      if (!await this.#snapshotMatches(tenant, snapshot)) {
        throw projectionError(
          'WIDGET_INSTANCE_PROJECTION_STATE_CORRUPT',
          'Widget instance metadata differs from its durable projection head.',
        );
      }
      return {
        canvasId: snapshot.canvasId,
        sourceSequence: snapshot.sourceSequence,
        projectedAtMs: head.projectedAtMs,
        status: 'replayed',
        activeCount: snapshot.instances.length,
        archivedCount: 0,
      };
    }

    const existingTimestamp = await (await this.#database.prepare(`
      SELECT max(updated_at_ms) AS updated_at_ms
      FROM widget_instances
      WHERE org_id = ? AND canvas_id = ?
    `)).get(tenant.orgId, snapshot.canvasId) as { updated_at_ms: unknown };
    const projectedAtMs = fnNextWidgetInstanceProjectionTimestamp(snapshot.projectedAtMs, [
      safeInteger(document.created_at_ms, 'Collaboration document creation time'),
      safeInteger(document.updated_at_ms, 'Collaboration document update time'),
      ...(head ? [head.projectedAtMs] : []),
      ...(existingTimestamp.updated_at_ms === null
        ? []
        : [safeInteger(existingTimestamp.updated_at_ms, 'Widget instance update time')]),
    ]);
    const advanced = head
      ? await (await this.#database.prepare(`
          UPDATE widget_instance_projection_heads
          SET source_sequence = ?, snapshot_digest_sha256 = ?, projected_at_ms = ?
          WHERE org_id = ? AND canvas_id = ?
            AND source_sequence = ? AND snapshot_digest_sha256 = ?
        `)).run(
          snapshot.sourceSequence,
          digestSha256,
          projectedAtMs,
          tenant.orgId,
          snapshot.canvasId,
          head.sourceSequence,
          head.snapshotDigestSha256,
        )
      : await (await this.#database.prepare(`
          INSERT INTO widget_instance_projection_heads (
            org_id, canvas_id, source_sequence, snapshot_digest_sha256, projected_at_ms
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (org_id, canvas_id) DO NOTHING
        `)).run(
          tenant.orgId,
          snapshot.canvasId,
          snapshot.sourceSequence,
          digestSha256,
          projectedAtMs,
        );
    if (advanced.changes !== 1) {
      throw projectionError(
        'WIDGET_INSTANCE_PROJECTION_RACE',
        'Widget instance projection lost its durable source-sequence race.',
      );
    }

    const archivedCount = await this.#reconcileSnapshot(tenant, snapshot, projectedAtMs);
    if (!await this.#snapshotMatches(tenant, snapshot)) {
      throw projectionError(
        'WIDGET_INSTANCE_PROJECTION_IDENTITY_CONFLICT',
        'Widget instance identity differs from its existing canvas metadata.',
      );
    }
    return {
      canvasId: snapshot.canvasId,
      sourceSequence: snapshot.sourceSequence,
      projectedAtMs,
      status: 'applied',
      activeCount: snapshot.instances.length,
      archivedCount,
    };
  }

  async #reconcileSnapshot(
    tenant: TTenantContext,
    snapshot: TWidgetInstanceMetadataProjectionSnapshot,
    projectedAtMs: number,
  ): Promise<number> {
    const existing = await (await this.#database.prepare(`
      SELECT instance.*,
        state_document.automerge_url AS state_document_id
      FROM widget_instances AS instance
      LEFT JOIN collaboration_documents AS state_document
        ON state_document.org_id = instance.org_id
        AND state_document.widget_instance_id = instance.id
      WHERE instance.org_id = ? AND instance.canvas_id = ?
      ORDER BY instance.element_id ASC, instance.id ASC
    `)).all(tenant.orgId, snapshot.canvasId) as TStoredWidgetInstanceRow[];
    const existingById = new Map(existing.map((row) => [row.id, row]));
    const existingByElement = new Map(existing.map((row) => [row.element_id, row]));
    const incomingIds = new Set(snapshot.instances.map((instance) => instance.instanceId));
    let archivedCount = 0;

    for (const instance of snapshot.instances) {
      const sameIdentity = existingById.get(instance.instanceId);
      if (sameIdentity !== undefined && sameIdentity.element_id !== instance.elementId) {
        throw projectionError(
          'WIDGET_INSTANCE_PROJECTION_IDENTITY_CONFLICT',
          'Widget instance identity cannot move between persisted canvas elements.',
        );
      }
      if (
        sameIdentity !== undefined
        && sameIdentity.state_document_id !== null
        && (
          sameIdentity.definition_id !== instance.definitionId
          || sameIdentity.revision_id !== instance.revisionId
        )
      ) {
        throw projectionError(
          'WIDGET_INSTANCE_PROJECTION_STATEFUL_REPIN',
          'A widget instance with collaborative state must be detached explicitly before repinning.',
        );
      }
      const replacedIdentity = existingByElement.get(instance.elementId);
      if (replacedIdentity === undefined || replacedIdentity.id === instance.instanceId) continue;
      if (incomingIds.has(replacedIdentity.id)) {
        throw projectionError(
          'WIDGET_INSTANCE_PROJECTION_IDENTITY_CONFLICT',
          'Widget instance identities cannot swap persisted canvas elements.',
        );
      }
      if (replacedIdentity.state_document_id !== null) {
        throw projectionError(
          'WIDGET_INSTANCE_PROJECTION_STATEFUL_REPLACEMENT',
          'A widget instance with collaborative state must be detached explicitly before replacement.',
        );
      }
      try {
        await (await this.#database.prepare(`
          DELETE FROM widget_instances
          WHERE org_id = ? AND id = ? AND canvas_id = ? AND element_id = ?
        `)).run(
          tenant.orgId,
          replacedIdentity.id,
          snapshot.canvasId,
          replacedIdentity.element_id,
        );
      } catch {
        throw projectionError(
          'WIDGET_INSTANCE_PROJECTION_REFERENCED_REPLACEMENT',
          'A referenced widget instance cannot be replaced until its dependent records are released.',
        );
      }
      if (replacedIdentity.status === 'active') archivedCount += 1;
      existingById.delete(replacedIdentity.id);
      existingByElement.delete(replacedIdentity.element_id);
    }

    for (const row of existingById.values()) {
      if (row.status !== 'active' || incomingIds.has(row.id)) continue;
      const archived = await (await this.#database.prepare(`
        UPDATE widget_instances
        SET status = 'archived', updated_at_ms = ?
        WHERE org_id = ? AND id = ? AND status = 'active'
      `)).run(projectedAtMs, tenant.orgId, row.id);
      archivedCount += archived.changes;
    }

    for (let offset = 0; offset < snapshot.instances.length; offset += INSERT_CHUNK_SIZE) {
      await this.#upsertChunk(
        tenant,
        snapshot,
        projectedAtMs,
        snapshot.instances.slice(offset, offset + INSERT_CHUNK_SIZE),
      );
    }
    await this.#assertCollaborativeStateOwnership(tenant, snapshot);
    return archivedCount;
  }

  async #upsertChunk(
    tenant: TTenantContext,
    snapshot: TWidgetInstanceMetadataProjectionSnapshot,
    projectedAtMs: number,
    instances: readonly TWidgetInstanceMetadataProjectionRecord[],
  ): Promise<void> {
    if (instances.length === 0) return;
    const values = instances.map(() => '(?, ?, ?, ?, ?, ?, \'active\', ?, ?)').join(', ');
    const parameters: Array<string | number> = [];
    for (const instance of instances) {
      parameters.push(
        tenant.orgId,
        instance.instanceId,
        snapshot.canvasId,
        instance.elementId,
        instance.definitionId,
        instance.revisionId,
        projectedAtMs,
        projectedAtMs,
      );
    }
    await (await this.#database.prepare(`
      INSERT INTO widget_instances (
        org_id, id, canvas_id, element_id, definition_id, revision_id,
        status, created_at_ms, updated_at_ms
      ) VALUES ${values}
      ON CONFLICT (org_id, id) DO UPDATE SET
        definition_id = excluded.definition_id,
        revision_id = excluded.revision_id,
        status = 'active',
        updated_at_ms = excluded.updated_at_ms
      WHERE widget_instances.canvas_id = excluded.canvas_id
        AND widget_instances.element_id = excluded.element_id
        AND widget_instances.updated_at_ms <= excluded.updated_at_ms
    `)).run(...parameters);
  }

  async #assertCollaborativeStateOwnership(
    tenant: TTenantContext,
    snapshot: TWidgetInstanceMetadataProjectionSnapshot,
  ): Promise<void> {
    const rows = await (await this.#database.prepare(`
      SELECT instance.id, state_document.automerge_url
      FROM widget_instances AS instance
      LEFT JOIN collaboration_documents AS state_document
        ON state_document.org_id = instance.org_id
        AND state_document.widget_instance_id = instance.id
      WHERE instance.org_id = ? AND instance.canvas_id = ?
    `)).all(tenant.orgId, snapshot.canvasId) as Array<{
      id: string;
      automerge_url: string | null;
    }>;
    const stateDocumentByInstanceId = new Map(
      rows.map((row) => [row.id, row.automerge_url]),
    );
    for (const instance of snapshot.instances) {
      const ownedStateDocumentId = stateDocumentByInstanceId.get(instance.instanceId) ?? null;
      if (ownedStateDocumentId === instance.stateDocumentId) continue;
      if (instance.stateDocumentId === null) {
        throw projectionError(
          'WIDGET_INSTANCE_PROJECTION_STATE_REFERENCE_REQUIRED',
          'A widget instance that owns collaborative state must retain its canvas state-document reference.',
        );
      }
      throw projectionError(
        'WIDGET_INSTANCE_PROJECTION_STATE_OWNERSHIP_CONFLICT',
        'Widget collaborative state must already be registered to the exact tenant widget instance.',
      );
    }
  }

  async #snapshotMatches(
    tenant: TTenantContext,
    snapshot: TWidgetInstanceMetadataProjectionSnapshot,
  ): Promise<boolean> {
    const rows = await (await this.#database.prepare(`
      SELECT instance.*,
        state_document.automerge_url AS state_document_id
      FROM widget_instances AS instance
      LEFT JOIN collaboration_documents AS state_document
        ON state_document.org_id = instance.org_id
        AND state_document.widget_instance_id = instance.id
      WHERE instance.org_id = ? AND instance.canvas_id = ? AND instance.status = 'active'
      ORDER BY instance.element_id ASC, instance.id ASC
    `)).all(tenant.orgId, snapshot.canvasId) as TStoredWidgetInstanceRow[];
    if (rows.length !== snapshot.instances.length) return false;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const expected = snapshot.instances[index];
      if (
        row === undefined
        || expected === undefined
        || row.id !== expected.instanceId
        || row.element_id !== expected.elementId
        || row.definition_id !== expected.definitionId
        || row.revision_id !== expected.revisionId
        || row.state_document_id !== expected.stateDocumentId
      ) return false;
    }
    return true;
  }

  async #activeCount(tenant: TTenantContext, canvasId: string): Promise<number> {
    const row = await (await this.#database.prepare(`
      SELECT count(*) AS count FROM widget_instances
      WHERE org_id = ? AND canvas_id = ? AND status = 'active'
    `)).get(tenant.orgId, canvasId) as { count: unknown };
    return safeInteger(row.count, 'Active widget instance count');
  }

  #snapshotDigest(snapshot: TWidgetInstanceMetadataProjectionSnapshot): string {
    return createHash('sha256').update(JSON.stringify({
      canvasId: snapshot.canvasId,
      sourceSequence: snapshot.sourceSequence,
      instances: snapshot.instances,
    })).digest('hex');
  }

  #projectionHead(row: TStoredProjectionHeadRow): TWidgetInstanceMetadataProjectionHead {
    return Object.freeze({
      canvasId: row.canvas_id,
      sourceSequence: safeInteger(row.source_sequence, 'Widget instance source sequence'),
      snapshotDigestSha256: row.snapshot_digest_sha256,
      projectedAtMs: safeInteger(row.projected_at_ms, 'Widget instance projection time'),
    });
  }

  #descriptor(row: TStoredWidgetInstanceRow): TWidgetInstanceMetadataDescriptor {
    return Object.freeze({
      orgId: row.org_id,
      instanceId: row.id,
      canvasId: row.canvas_id,
      elementId: row.element_id,
      definitionId: row.definition_id,
      revisionId: row.revision_id,
      stateDocumentId: row.state_document_id,
      status: row.status,
      createdAtMs: safeInteger(row.created_at_ms, 'Widget instance creation time'),
      updatedAtMs: safeInteger(row.updated_at_ms, 'Widget instance update time'),
    });
  }

  #runImmediate<T>(operation: () => Promise<T>): Promise<T> {
    return txRunDatabaseTransaction({ database: this.#database }, {
      operation,
    });
  }
}
