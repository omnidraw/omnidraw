import type { Database } from '@tursodatabase/database';
import type {
  IResourceControlStore,
  TCreateResourceRequest,
  TDbResourceApplyRun,
  TDbResourceBackup,
  TDbResourceDraft,
  TDbResourceDraftChange,
  TDbResourceDraftStatus,
  TReserveResourcePlacementRequest,
  TResourceBindingReference,
  TResourceDescriptor,
  TResourceId,
  TResourceListFilter,
  TResourcePlacement,
  TResourceSlot,
  TSafeResourceError,
  TUpdateResourcePlacementRequest,
  TUpdateResourceStateRequest,
} from '@vibecanvas/resource-runtime';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import { fnNormalizeResourceName, fnResourceNameKey } from './core/fn.resource-name';
import {
  fnResourceControlStoreBinding,
  fnResourceControlStoreDbApply,
  fnResourceControlStoreDbBackup,
  fnResourceControlStoreDbDraft,
  fnResourceControlStoreDbDraftChange,
  fnResourceControlStoreDescriptor,
  fnResourceControlStorePlacement,
  fnResourceControlStoreSerializeJson,
} from './ResourceControlStoreTurso/fn.resource-control-store-row';
import {
  txRunDatabaseTransaction,
  txRunDatabaseWrite,
} from './tx.run-database-transaction';

type TExpectedStatus = string | readonly string[];

const DB_DRAFT_LIST_DEFAULT_LIMIT = 50;
const DB_DRAFT_LIST_MAX_LIMIT = 200;
const DB_APPLY_LIST_DEFAULT_LIMIT = 20;
const DB_APPLY_LIST_MAX_LIMIT = 100;

function resourceNameError(code: 'RESOURCE_NAME_INVALID' | 'RESOURCE_NAME_CONFLICT', message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** Turso-backed implementation of the resource control-plane SPI. */
export class ResourceControlStoreTurso implements IResourceControlStore {
  constructor(private readonly database: Database) {}

  async listResources(
    tenant: TTenantContext,
    filter: TResourceListFilter = {},
  ): Promise<readonly TResourceDescriptor[]> {
    const predicates = ['org_id = ?'];
    const parameters: (string | number)[] = [tenant.orgId];
    if (filter.kind !== undefined) {
      predicates.push('kind = ?');
      parameters.push(filter.kind);
    }
    if (filter.status !== undefined) {
      predicates.push('status = ?');
      parameters.push(filter.status);
    }
    const rows = await (await this.database.prepare(`
      SELECT *
      FROM resource_catalog
      WHERE ${predicates.join(' AND ')}
      ORDER BY created_at_ms ASC, id ASC
    `)).all(...parameters);
    return rows.map(fnResourceControlStoreDescriptor);
  }

  async getResource(
    tenant: TTenantContext,
    resourceId: TResourceId,
  ): Promise<TResourceDescriptor | null> {
    const row = await (await this.database.prepare(`
      SELECT *
      FROM resource_catalog
      WHERE org_id = ? AND id = ?
    `)).get(tenant.orgId, resourceId);
    return row ? fnResourceControlStoreDescriptor(row) : null;
  }

  async createResource(
    tenant: TTenantContext,
    request: TCreateResourceRequest,
  ): Promise<TResourceDescriptor> {
    try {
      return await txRunDatabaseTransaction({ database: this.database }, {
        operation: async () => {
          const name = await this.#availableResourceName(tenant, request.name);
          await (await this.database.prepare(`
            INSERT INTO resource_catalog (
              org_id, id, kind, name, status, last_error_json, created_at_ms, updated_at_ms
            ) VALUES (?, ?, ?, ?, 'created', NULL, ?, ?)
          `)).run(
            tenant.orgId,
            request.id,
            request.kind,
            name,
            request.nowMs,
            request.nowMs,
          );
          await (await this.database.prepare(`
            INSERT INTO resource_placements (
              org_id, resource_id, cell_id, placement_epoch, relative_path,
              status, created_at_ms, updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, 'reserved', ?, ?)
          `)).run(
            tenant.orgId,
            request.id,
            request.cellId,
            request.placementEpoch,
            request.storageKey,
            request.nowMs,
            request.nowMs,
          );
          const created = await this.getResource(tenant, request.id);
          if (!created) throw new Error(`Failed to create resource '${request.id}'.`);
          return created;
        },
      });
    } catch (error) {
      this.#rethrowResourceNameConflict(error, request.name);
    }
  }

  async renameResource(
    tenant: TTenantContext,
    request: Readonly<{ resourceId: TResourceId; name: string; nowMs: number }>,
  ): Promise<TResourceDescriptor | null> {
    try {
      return await txRunDatabaseTransaction({ database: this.database }, {
        operation: async () => {
          const current = await this.getResource(tenant, request.resourceId);
          if (!current) return null;
          const name = await this.#availableResourceName(tenant, request.name, request.resourceId);
          const result = await (await this.database.prepare(`
              UPDATE resource_catalog
              SET name = ?, updated_at_ms = ?
              WHERE org_id = ? AND id = ?
            `)).run(name, request.nowMs, tenant.orgId, request.resourceId);
          if (result.changes === 0) return null;
          return this.getResource(tenant, request.resourceId);
        },
      });
    } catch (error) {
      this.#rethrowResourceNameConflict(error, request.name);
    }
  }

  async updateResourceState(
    tenant: TTenantContext,
    request: TUpdateResourceStateRequest,
  ): Promise<TResourceDescriptor | null> {
    const expected = this.#expectedStatuses(request.expectedStatus);
    if (expected.length === 0) return null;
    const result = await this.#runWrite(async () => (
      (await this.database.prepare(`
        UPDATE resource_catalog
        SET status = ?, last_error_json = ?, updated_at_ms = ?
        WHERE org_id = ? AND id = ?
          AND status IN (${expected.map(() => '?').join(', ')})
      `)).run(
        request.status,
        fnResourceControlStoreSerializeJson(request.lastError),
        request.nowMs,
        tenant.orgId,
        request.resourceId,
        ...expected,
      )
    ));
    if (result.changes === 0) return null;
    return this.getResource(tenant, request.resourceId);
  }

  async deleteResource(tenant: TTenantContext, resourceId: TResourceId): Promise<boolean> {
    return txRunDatabaseTransaction({ database: this.database }, {
      operation: async () => {
        const eligible = await (await this.database.prepare(`
          SELECT id
          FROM resource_catalog
          WHERE org_id = ? AND id = ? AND status = 'deleting'
            AND NOT EXISTS (
              SELECT 1 FROM resource_bindings
              WHERE org_id = resource_catalog.org_id AND resource_id = resource_catalog.id
            )
        `)).get(tenant.orgId, resourceId);
        if (!eligible) return false;

        await (await this.database.prepare(`
          UPDATE db_resource_apply_runs
          SET source_apply_id = NULL
          WHERE org_id = ? AND resource_id = ? AND source_apply_id IS NOT NULL
        `)).run(tenant.orgId, resourceId);
        await (await this.database.prepare(`
          DELETE FROM db_resource_apply_runs
          WHERE org_id = ? AND resource_id = ?
        `)).run(tenant.orgId, resourceId);
        const result = await (await this.database.prepare(`
          DELETE FROM resource_catalog
          WHERE org_id = ? AND id = ? AND status = 'deleting'
        `)).run(tenant.orgId, resourceId);
        return result.changes > 0;
      },
    });
  }

  async getPlacement(
    tenant: TTenantContext,
    resourceId: TResourceId,
  ): Promise<TResourcePlacement | null> {
    const row = await (await this.database.prepare(`
      SELECT *
      FROM resource_placements
      WHERE org_id = ? AND resource_id = ?
    `)).get(tenant.orgId, resourceId);
    return row ? fnResourceControlStorePlacement(row) : null;
  }

  async reservePlacement(
    tenant: TTenantContext,
    request: TReserveResourcePlacementRequest,
  ): Promise<TResourcePlacement> {
    await this.#runWrite(async () => (
      (await this.database.prepare(`
        INSERT INTO resource_placements (
          org_id, resource_id, cell_id, placement_epoch, relative_path,
          status, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, 'reserved', ?, ?)
      `)).run(
        tenant.orgId,
        request.resourceId,
        request.cellId,
        request.placementEpoch,
        request.storageKey,
        request.nowMs,
        request.nowMs,
      )
    ));
    const placement = await this.getPlacement(tenant, request.resourceId);
    if (!placement) throw new Error(`Failed to reserve placement for resource '${request.resourceId}'.`);
    return placement;
  }

  async updatePlacement(
    tenant: TTenantContext,
    request: TUpdateResourcePlacementRequest,
  ): Promise<TResourcePlacement | null> {
    const result = await this.#runWrite(async () => (
      (await this.database.prepare(`
        UPDATE resource_placements
        SET cell_id = ?, placement_epoch = ?, relative_path = ?, status = ?, updated_at_ms = ?
        WHERE org_id = ? AND resource_id = ? AND placement_epoch = ?
      `)).run(
        request.cellId,
        request.placementEpoch,
        request.storageKey,
        request.status,
        request.nowMs,
        tenant.orgId,
        request.resourceId,
        request.expectedEpoch,
      )
    ));
    if (result.changes === 0) return null;
    return this.getPlacement(tenant, request.resourceId);
  }

  async deletePlacement(tenant: TTenantContext, resourceId: TResourceId): Promise<boolean> {
    const result = await this.#runWrite(async () => (
      (await this.database.prepare(`
        DELETE FROM resource_placements
        WHERE org_id = ? AND resource_id = ?
      `)).run(tenant.orgId, resourceId)
    ));
    return result.changes > 0;
  }

  async resolveBinding(
    tenant: TTenantContext,
    request: Readonly<{ definitionId: string; revisionId: string; slot: TResourceSlot }>,
  ): Promise<TResourceBindingReference | null> {
    const row = await (await this.database.prepare(`
      SELECT *
      FROM resource_bindings
      WHERE org_id = ? AND definition_id = ? AND revision_id = ? AND slot_name = ?
    `)).get(tenant.orgId, request.definitionId, request.revisionId, request.slot);
    return row ? fnResourceControlStoreBinding(row) : null;
  }

  async listBindingsForResource(
    tenant: TTenantContext,
    resourceId: TResourceId,
  ): Promise<readonly TResourceBindingReference[]> {
    const rows = await (await this.database.prepare(`
      SELECT *
      FROM resource_bindings
      WHERE org_id = ? AND resource_id = ?
      ORDER BY definition_id ASC, revision_id ASC, slot_name ASC
    `)).all(tenant.orgId, resourceId);
    return rows.map(fnResourceControlStoreBinding);
  }

  async putBinding(
    tenant: TTenantContext,
    binding: TResourceBindingReference,
  ): Promise<TResourceBindingReference> {
    await this.#runWrite(async () => (
      (await this.database.prepare(`
        INSERT INTO resource_bindings (
          org_id, definition_id, revision_id, slot_name, resource_id, resource_kind,
          is_required, manifest_allow_read, manifest_allow_write, allow_read, allow_write,
          created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (org_id, definition_id, revision_id, slot_name) DO UPDATE SET
          resource_id = excluded.resource_id,
          resource_kind = excluded.resource_kind,
          is_required = excluded.is_required,
          manifest_allow_read = excluded.manifest_allow_read,
          manifest_allow_write = excluded.manifest_allow_write,
          allow_read = excluded.allow_read,
          allow_write = excluded.allow_write,
          updated_at_ms = excluded.updated_at_ms
      `)).run(
        tenant.orgId,
        binding.definitionId,
        binding.revisionId,
        binding.slot,
        binding.resourceId,
        binding.kind,
        Number(binding.required),
        Number(binding.manifestAllowRead),
        Number(binding.manifestAllowWrite),
        Number(binding.allowRead),
        Number(binding.allowWrite),
        binding.createdAtMs,
        binding.updatedAtMs,
      )
    ));
    const stored = await this.resolveBinding(tenant, binding);
    if (!stored) throw new Error(`Failed to store resource binding '${binding.slot}'.`);
    return stored;
  }

  async deleteBinding(
    tenant: TTenantContext,
    request: Readonly<{ definitionId: string; revisionId: string; slot: TResourceSlot }>,
  ): Promise<boolean> {
    const result = await this.#runWrite(async () => (
      (await this.database.prepare(`
        DELETE FROM resource_bindings
        WHERE org_id = ? AND definition_id = ? AND revision_id = ? AND slot_name = ?
      `)).run(tenant.orgId, request.definitionId, request.revisionId, request.slot)
    ));
    return result.changes > 0;
  }

  async createDbDraft(
    tenant: TTenantContext,
    draft: TDbResourceDraft,
  ): Promise<TDbResourceDraft> {
    this.#assertTenantOrg(tenant, draft.orgId);
    await this.#runWrite(async () => (
      (await this.database.prepare(`
        INSERT INTO db_resource_drafts (
          org_id, id, resource_id, resource_kind, name, status, last_error_json,
          created_at_ms, updated_at_ms, applied_at_ms
        ) VALUES (?, ?, ?, 'db', ?, ?, ?, ?, ?, ?)
      `)).run(
        tenant.orgId,
        draft.id,
        draft.resourceId,
        draft.name,
        draft.status,
        fnResourceControlStoreSerializeJson(draft.lastError),
        draft.createdAtMs,
        draft.updatedAtMs,
        draft.appliedAtMs,
      )
    ));
    const stored = await this.getDbDraft(tenant, draft.id);
    if (!stored) throw new Error(`Failed to create DB resource draft '${draft.id}'.`);
    return stored;
  }

  async getDbDraft(tenant: TTenantContext, draftId: string): Promise<TDbResourceDraft | null> {
    const row = await (await this.database.prepare(`
      SELECT *
      FROM db_resource_drafts
      WHERE org_id = ? AND id = ?
    `)).get(tenant.orgId, draftId);
    return row ? fnResourceControlStoreDbDraft(row) : null;
  }

  async listDbDrafts(
    tenant: TTenantContext,
    request: Readonly<{ resourceId: TResourceId; status?: TDbResourceDraftStatus; limit?: number }>,
  ): Promise<readonly TDbResourceDraft[]> {
    const limit = this.#listLimit(
      request.limit,
      DB_DRAFT_LIST_DEFAULT_LIMIT,
      DB_DRAFT_LIST_MAX_LIMIT,
      'DB resource draft',
    );
    const rows = request.status === undefined
      ? await (await this.database.prepare(`
          SELECT * FROM db_resource_drafts
          WHERE org_id = ? AND resource_id = ?
          ORDER BY created_at_ms DESC, id DESC
          LIMIT ?
        `)).all(tenant.orgId, request.resourceId, limit)
      : await (await this.database.prepare(`
          SELECT * FROM db_resource_drafts
          WHERE org_id = ? AND resource_id = ? AND status = ?
          ORDER BY created_at_ms DESC, id DESC
          LIMIT ?
        `)).all(tenant.orgId, request.resourceId, request.status, limit);
    return rows.map(fnResourceControlStoreDbDraft);
  }

  async updateDbDraft(
    tenant: TTenantContext,
    request: Readonly<{
      draftId: string;
      expectedStatus: TDbResourceDraftStatus | readonly TDbResourceDraftStatus[];
      status: TDbResourceDraftStatus;
      lastError: TSafeResourceError | null;
      appliedAtMs: number | null;
      nowMs: number;
    }>,
  ): Promise<TDbResourceDraft | null> {
    const expected = this.#expectedStatuses(request.expectedStatus);
    if (expected.length === 0) return null;
    const result = await this.#runWrite(async () => (
      (await this.database.prepare(`
        UPDATE db_resource_drafts
        SET status = ?, last_error_json = ?, applied_at_ms = ?, updated_at_ms = ?
        WHERE org_id = ? AND id = ?
          AND status IN (${expected.map(() => '?').join(', ')})
      `)).run(
        request.status,
        fnResourceControlStoreSerializeJson(request.lastError),
        request.appliedAtMs,
        request.nowMs,
        tenant.orgId,
        request.draftId,
        ...expected,
      )
    ));
    if (result.changes === 0) return null;
    return this.getDbDraft(tenant, request.draftId);
  }

  async appendDbDraftChange(
    tenant: TTenantContext,
    change: TDbResourceDraftChange,
  ): Promise<TDbResourceDraftChange> {
    this.#assertTenantOrg(tenant, change.orgId);
    await this.#runWrite(async () => (
      (await this.database.prepare(`
        INSERT INTO db_resource_draft_changes (
          org_id, draft_id, sequence, kind, operation_json, sql_text, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)).run(
        tenant.orgId,
        change.draftId,
        change.sequence,
        change.kind,
        fnResourceControlStoreSerializeJson(change.operation),
        change.sql,
        change.createdAtMs,
      )
    ));
    const row = await (await this.database.prepare(`
      SELECT * FROM db_resource_draft_changes
      WHERE org_id = ? AND draft_id = ? AND sequence = ?
    `)).get(tenant.orgId, change.draftId, change.sequence);
    if (!row) throw new Error(`Failed to append DB resource draft change '${change.sequence}'.`);
    return fnResourceControlStoreDbDraftChange(row);
  }

  async listDbDraftChanges(
    tenant: TTenantContext,
    draftId: string,
  ): Promise<readonly TDbResourceDraftChange[]> {
    const rows = await (await this.database.prepare(`
      SELECT * FROM db_resource_draft_changes
      WHERE org_id = ? AND draft_id = ?
      ORDER BY sequence ASC
    `)).all(tenant.orgId, draftId);
    return rows.map(fnResourceControlStoreDbDraftChange);
  }

  async createDbApply(
    tenant: TTenantContext,
    apply: TDbResourceApplyRun,
  ): Promise<TDbResourceApplyRun> {
    this.#assertTenantOrg(tenant, apply.orgId);
    await this.#runWrite(async () => (
      (await this.database.prepare(`
        INSERT INTO db_resource_apply_runs (
          org_id, id, resource_id, draft_id, source_apply_id, status, last_error_json,
          backup_retained, created_at_ms, completed_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)).run(
        tenant.orgId,
        apply.id,
        apply.resourceId,
        apply.draftId,
        apply.sourceApplyId,
        apply.status,
        fnResourceControlStoreSerializeJson(apply.lastError),
        Number(apply.backupRetained),
        apply.createdAtMs,
        apply.completedAtMs,
      )
    ));
    const stored = await this.getDbApply(tenant, apply.id);
    if (!stored) throw new Error(`Failed to create DB resource apply run '${apply.id}'.`);
    return stored;
  }

  async getDbApply(tenant: TTenantContext, applyId: string): Promise<TDbResourceApplyRun | null> {
    const row = await (await this.database.prepare(`
      SELECT * FROM db_resource_apply_runs
      WHERE org_id = ? AND id = ?
    `)).get(tenant.orgId, applyId);
    return row ? fnResourceControlStoreDbApply(row) : null;
  }

  async listDbApplies(
    tenant: TTenantContext,
    request: Readonly<{ resourceId: TResourceId; limit?: number }>,
  ): Promise<readonly TDbResourceApplyRun[]> {
    const limit = this.#listLimit(
      request.limit,
      DB_APPLY_LIST_DEFAULT_LIMIT,
      DB_APPLY_LIST_MAX_LIMIT,
      'DB resource apply',
    );
    const rows = await (await this.database.prepare(`
      SELECT * FROM db_resource_apply_runs
      WHERE org_id = ? AND resource_id = ?
      ORDER BY created_at_ms DESC, id DESC
      LIMIT ?
    `)).all(tenant.orgId, request.resourceId, limit);
    return rows.map(fnResourceControlStoreDbApply);
  }

  async updateDbApply(
    tenant: TTenantContext,
    request: Readonly<{
      applyId: string;
      expectedStatus: TDbResourceApplyRun['status'] | readonly TDbResourceApplyRun['status'][];
      status: TDbResourceApplyRun['status'];
      lastError: TSafeResourceError | null;
      backupRetained: boolean;
      completedAtMs: number | null;
    }>,
  ): Promise<TDbResourceApplyRun | null> {
    const expected = this.#expectedStatuses(request.expectedStatus);
    if (expected.length === 0) return null;
    const result = await this.#runWrite(async () => (
      (await this.database.prepare(`
        UPDATE db_resource_apply_runs
        SET status = ?, last_error_json = ?, backup_retained = ?, completed_at_ms = ?
        WHERE org_id = ? AND id = ?
          AND status IN (${expected.map(() => '?').join(', ')})
      `)).run(
        request.status,
        fnResourceControlStoreSerializeJson(request.lastError),
        Number(request.backupRetained),
        request.completedAtMs,
        tenant.orgId,
        request.applyId,
        ...expected,
      )
    ));
    if (result.changes === 0) return null;
    return this.getDbApply(tenant, request.applyId);
  }

  async createDbBackup(
    tenant: TTenantContext,
    backup: TDbResourceBackup,
  ): Promise<TDbResourceBackup> {
    this.#assertTenantOrg(tenant, backup.orgId);
    await this.#runWrite(async () => (
      (await this.database.prepare(`
        INSERT INTO db_resource_backups (
          org_id, id, resource_id, apply_run_id, relative_path, digest_sha256,
          byte_size, state, created_at_ms, verified_at_ms, delete_after_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)).run(
        tenant.orgId,
        backup.id,
        backup.resourceId,
        backup.applyRunId,
        backup.storageKey,
        backup.digestSha256,
        backup.byteSize,
        backup.state,
        backup.createdAtMs,
        backup.verifiedAtMs,
        backup.deleteAfterMs,
      )
    ));
    const stored = await this.getDbBackup(tenant, {
      resourceId: backup.resourceId,
      applyRunId: backup.applyRunId,
    });
    if (!stored) throw new Error(`Failed to create DB resource backup '${backup.id}'.`);
    return stored;
  }

  async getDbBackup(
    tenant: TTenantContext,
    request: Readonly<{ resourceId: TResourceId; applyRunId: string }>,
  ): Promise<TDbResourceBackup | null> {
    const row = await (await this.database.prepare(`
      SELECT * FROM db_resource_backups
      WHERE org_id = ? AND resource_id = ? AND apply_run_id = ?
    `)).get(tenant.orgId, request.resourceId, request.applyRunId);
    return row ? fnResourceControlStoreDbBackup(row) : null;
  }

  async listDbBackups(
    tenant: TTenantContext,
    resourceId: TResourceId,
  ): Promise<readonly TDbResourceBackup[]> {
    const rows = await (await this.database.prepare(`
      SELECT * FROM db_resource_backups
      WHERE org_id = ? AND resource_id = ?
      ORDER BY created_at_ms DESC, id DESC
    `)).all(tenant.orgId, resourceId);
    return rows.map(fnResourceControlStoreDbBackup);
  }

  async updateDbBackup(
    tenant: TTenantContext,
    backup: TDbResourceBackup,
  ): Promise<TDbResourceBackup | null> {
    this.#assertTenantOrg(tenant, backup.orgId);
    const result = await this.#runWrite(async () => (
      (await this.database.prepare(`
        UPDATE db_resource_backups
        SET resource_id = ?, apply_run_id = ?, relative_path = ?, digest_sha256 = ?,
          byte_size = ?, state = ?, created_at_ms = ?, verified_at_ms = ?, delete_after_ms = ?
        WHERE org_id = ? AND id = ?
      `)).run(
        backup.resourceId,
        backup.applyRunId,
        backup.storageKey,
        backup.digestSha256,
        backup.byteSize,
        backup.state,
        backup.createdAtMs,
        backup.verifiedAtMs,
        backup.deleteAfterMs,
        tenant.orgId,
        backup.id,
      )
    ));
    if (result.changes === 0) return null;
    return this.getDbBackup(tenant, {
      resourceId: backup.resourceId,
      applyRunId: backup.applyRunId,
    });
  }

  async #availableResourceName(
    tenant: TTenantContext,
    candidate: string,
    excludingResourceId?: string,
  ): Promise<string> {
    const normalized = fnNormalizeResourceName(candidate);
    if (!normalized.ok) throw resourceNameError(normalized.code, normalized.message);
    const rows = await (await this.database.prepare(`
      SELECT id, name FROM resource_catalog
      WHERE org_id = ?
      ORDER BY id ASC
    `)).all(tenant.orgId) as { id: string; name: string }[];
    if (rows.some((row) => (
      row.id !== excludingResourceId
      && fnResourceNameKey(row.name) === normalized.value.key
    ))) {
      throw resourceNameError(
        'RESOURCE_NAME_CONFLICT',
        `Resource name '${normalized.value.name}' is already in use.`,
      );
    }
    return normalized.value.name;
  }

  #runWrite<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    return txRunDatabaseWrite({ database: this.database }, { operation });
  }

  #rethrowResourceNameConflict(error: unknown, name: string): never {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('UNIQUE constraint failed: resource_catalog.org_id, resource_catalog.name')) {
      throw resourceNameError('RESOURCE_NAME_CONFLICT', `Resource name '${name}' is already in use.`);
    }
    throw error;
  }

  #assertTenantOrg(tenant: TTenantContext, orgId: string): void {
    if (tenant.orgId !== orgId) {
      throw new Error('Resource control-plane DTO belongs to a different organization.');
    }
  }

  #expectedStatuses(status: TExpectedStatus): readonly string[] {
    return typeof status === 'string' ? [status] : status;
  }

  #listLimit(limit: number | undefined, fallback: number, maximum: number, label: string): number {
    const resolved = limit ?? fallback;
    if (!Number.isInteger(resolved) || resolved < 1 || resolved > maximum) {
      throw new RangeError(`${label} list limit must be between 1 and ${maximum}.`);
    }
    return resolved;
  }
}
