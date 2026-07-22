import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { Database } from '@tursodatabase/database';
import type { TResourceRequirement } from '@vibecanvas/resource-runtime';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  ZWidgetManifestV2,
  ZWidgetServerFunctionDescriptors,
  fnCanonicalizeWidgetContractPayload,
  fnCanonicalizeWidgetManifest,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnNormalizeWidgetServerFunctionDescriptor,
  fnValidateWidgetServerFunctionDescriptors,
  fnWidgetRevisionArtifactsMatchManifest,
} from '@vibecanvas/widget-contract';
import type {
  IWidgetControlStore,
  IWidgetArtifactMutationCoordinator,
  TWidgetActiveRevisionCasResult,
  TWidgetArtifactDeletionClaimRequest,
  TWidgetArtifactDeletionCompleteRequest,
  TWidgetArtifactDeletionCompleteResult,
  TWidgetArtifactDescriptor,
  TWidgetArtifactGcCandidateRequest,
  TWidgetArtifactResolutionRequest,
  TWidgetArtifactRetentionReconcileRequest,
  TWidgetArtifactRetentionReconcileResult,
  TWidgetArtifactRetentionRestoreRequest,
  TWidgetDefinitionCreate,
  TWidgetDefinitionArchiveInput,
  TWidgetDefinitionArchiveResult,
  TWidgetDefinitionDescriptor,
  TWidgetDefinitionId,
  TWidgetManifestV2,
  TWidgetPublicationCommitInput,
  TWidgetPublicationCommitResult,
  TWidgetPreviewArtifactActivationRequest,
  TWidgetRevisionDescriptor,
  TWidgetRevisionId,
  TWidgetRevisionSourceDescriptor,
  TWidgetRevisionPruneRequest,
  TWidgetRevisionPruneResult,
  TWidgetRollbackInput,
  TWidgetServerFunctionDescriptor,
} from '@vibecanvas/widget-contract';
import { fnFunctionCanonicalJson } from './FunctionControlStoreTurso/fn.function-json';
import { fnFunctionId } from './FunctionControlStoreTurso/fn.function-id';
import { fnFunctionControlStoreDefinition } from './FunctionControlStoreTurso/fn.function-control-store-row';
import {
  fnWidgetControlStoreArtifact,
  fnWidgetControlStoreDefinition,
  fnWidgetControlStoreResourceCeiling,
  fnWidgetControlStoreRevision,
} from './WidgetControlStoreTurso/fn.widget-control-store-row';
import { txRunDatabaseTransaction } from './tx.run-database-transaction';

type TArtifactMutationScope = {
  active: boolean;
  orgId: string;
};

type TPublicationArtifact = TWidgetPublicationCommitInput['revision']['uiArtifact'];
type TValidatedPublicationFunctions = Readonly<{
  descriptors: readonly TWidgetServerFunctionDescriptor[];
  canonicalJson: string;
  digestSha256: string;
}>;

const CONTROL_STORE_MAX_BATCH = 500;

const DURABLE_ARTIFACT_REFERENCE_SQL = `
  EXISTS (
    SELECT 1
    FROM widget_definition_revisions AS revision
    WHERE revision.org_id = artifact_references.org_id
      AND (
        (revision.ui_artifact_id = artifact_references.id
          AND revision.ui_artifact_kind = artifact_references.kind)
        OR
        (revision.server_artifact_id = artifact_references.id
          AND revision.server_artifact_kind = artifact_references.kind)
      )
  )
  OR EXISTS (
    SELECT 1
    FROM widget_revision_sources AS source
    WHERE source.org_id = artifact_references.org_id
      AND source.source_artifact_id = artifact_references.id
      AND source.source_artifact_kind = artifact_references.kind
  )
  OR EXISTS (
    SELECT 1
    FROM agent_previews AS preview
    WHERE preview.org_id = artifact_references.org_id
      AND preview.artifact_id = artifact_references.id
      AND preview.artifact_kind = artifact_references.kind
      AND preview.status IN ('queued', 'building', 'ready')
  )
`;

function widgetStoreError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** Turso-backed tenant-qualified immutable widget metadata and retention repository. */
export class WidgetControlStoreTurso implements
  IWidgetControlStore,
  IWidgetArtifactMutationCoordinator {
  readonly #artifactMutationScope = new AsyncLocalStorage<TArtifactMutationScope>();

  constructor(private readonly database: Database) {}

  runArtifactMutation<T>(
    tenant: TTenantContext,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.#runImmediate(tenant, operation);
  }

  async createDefinition(
    tenant: TTenantContext,
    request: TWidgetDefinitionCreate,
  ): Promise<TWidgetDefinitionDescriptor> {
    return this.#runImmediate(tenant, async () => {
      await (await this.database.prepare(`
        INSERT INTO widget_definitions (
          org_id, id, slug, name, status, active_revision_id, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, 'draft', NULL, ?, ?)
      `)).run(
        tenant.orgId,
        request.id,
        request.slug,
        request.name,
        request.nowMs,
        request.nowMs,
      );
      const definition = await this.getDefinition(tenant, request.id);
      if (!definition) throw new Error(`Failed to create widget definition '${request.id}'.`);
      return definition;
    });
  }

  async getDefinition(
    tenant: TTenantContext,
    definitionId: TWidgetDefinitionId,
  ): Promise<TWidgetDefinitionDescriptor | null> {
    const row = await (await this.database.prepare(`
      SELECT *
      FROM widget_definitions
      WHERE org_id = ? AND id = ?
    `)).get(tenant.orgId, definitionId);
    return row ? fnWidgetControlStoreDefinition(row) : null;
  }

  async getDefinitionBySlug(
    tenant: TTenantContext,
    slug: string,
  ): Promise<TWidgetDefinitionDescriptor | null> {
    const row = await (await this.database.prepare(`
      SELECT *
      FROM widget_definitions
      WHERE org_id = ? AND slug = ?
    `)).get(tenant.orgId, slug);
    return row ? fnWidgetControlStoreDefinition(row) : null;
  }

  async archiveDefinition(
    tenant: TTenantContext,
    request: TWidgetDefinitionArchiveInput,
  ): Promise<TWidgetDefinitionArchiveResult> {
    const transitionAtMs = this.#timestamp(request.nowMs, 'widget archive transition timestamp');
    return this.#runImmediate(tenant, async () => {
      const definition = await this.getDefinition(tenant, request.definitionId);
      if (
        !definition
        || definition.status !== 'published'
        || definition.activeRevisionId !== request.expectedActiveRevisionId
      ) {
        return {
          status: 'conflict',
          currentActiveRevisionId: definition?.activeRevisionId ?? null,
        } as const;
      }
      if (transitionAtMs < definition.updatedAtMs) {
        throw widgetStoreError(
          'WIDGET_TRANSITION_TIMESTAMP_REGRESSION',
          'Widget archive transition time cannot move backwards.',
        );
      }
      const update = await (await this.database.prepare(`
        UPDATE widget_definitions
        SET status = 'archived', active_revision_id = NULL, updated_at_ms = ?
        WHERE org_id = ? AND id = ?
          AND status = 'published' AND active_revision_id = ?
      `)).run(
        transitionAtMs,
        tenant.orgId,
        request.definitionId,
        request.expectedActiveRevisionId,
      );
      if (update.changes !== 1) {
        const current = await this.getDefinition(tenant, request.definitionId);
        return {
          status: 'conflict',
          currentActiveRevisionId: current?.activeRevisionId ?? null,
        } as const;
      }
      const archived = await this.getDefinition(tenant, request.definitionId);
      if (!archived || archived.status !== 'archived' || archived.activeRevisionId !== null) {
        throw new Error('Archived widget definition could not be read back.');
      }
      return {
        status: 'archived',
        definition: archived,
        previousActiveRevisionId: request.expectedActiveRevisionId,
      } as const;
    });
  }

  async listPublishedDefinitions(
    tenant: TTenantContext,
    limit: number,
  ): Promise<readonly TWidgetDefinitionDescriptor[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_001) {
      throw new Error('Widget definition list limit is invalid.');
    }
    const rows = await (await this.database.prepare(`
      SELECT *
      FROM widget_definitions
      WHERE org_id = ?
        AND status = 'published'
        AND active_revision_id IS NOT NULL
      ORDER BY name ASC, id ASC
      LIMIT ?
    `)).all(tenant.orgId, limit);
    return rows.map((row) => fnWidgetControlStoreDefinition(row));
  }

  async getRevision(
    tenant: TTenantContext,
    revisionId: TWidgetRevisionId,
  ): Promise<TWidgetRevisionDescriptor | null> {
    const row = await (await this.database.prepare(`
      ${this.#revisionSelect()}
      WHERE revision.org_id = ? AND revision.id = ?
    `)).get(tenant.orgId, revisionId);
    return row ? this.#validatedStoredRevision(row) : null;
  }

  async getRevisionSource(
    tenant: TTenantContext,
    revisionId: TWidgetRevisionId,
  ): Promise<TWidgetRevisionSourceDescriptor | null> {
    const row = await (await this.database.prepare(`
      SELECT
        source.*,
        artifact.id AS artifact_id,
        artifact.kind AS artifact_kind,
        artifact.digest_sha256 AS artifact_digest_sha256,
        artifact.byte_size AS artifact_byte_size,
        artifact.retention_state AS artifact_retention_state,
        artifact.retain_until_ms AS artifact_retain_until_ms,
        artifact.created_at_ms AS artifact_created_at_ms
      FROM widget_revision_sources AS source
      JOIN artifact_references AS artifact
        ON artifact.org_id = source.org_id
       AND artifact.id = source.source_artifact_id
       AND artifact.kind = source.source_artifact_kind
      WHERE source.org_id = ? AND source.revision_id = ?
    `)).get(tenant.orgId, revisionId);
    if (!row) return null;
    try {
      const value = row as Record<string, unknown>;
      const sourceArtifact = fnWidgetControlStoreArtifact({
        org_id: tenant.orgId,
        id: String(value.artifact_id),
        kind: value.artifact_kind as TWidgetArtifactDescriptor['kind'],
        digest_sha256: String(value.artifact_digest_sha256),
        byte_size: value.artifact_byte_size,
        retention_state: value.artifact_retention_state as TWidgetArtifactDescriptor['retentionState'],
        retain_until_ms: value.artifact_retain_until_ms,
        created_at_ms: value.artifact_created_at_ms,
      });
      if (sourceArtifact.kind !== 'source') throw new Error('source artifact kind differs');
      return {
        orgId: tenant.orgId,
        definitionId: String(value.definition_id),
        revisionId: String(value.revision_id),
        sourceSnapshotId: String(value.source_snapshot_id),
        sourceDigestSha256: String(value.source_digest_sha256),
        sourceArtifact,
        builderIdentity: String(value.builder_identity),
        createdAtMs: this.#timestamp(Number(value.created_at_ms), 'source creation timestamp'),
      };
    } catch {
      throw widgetStoreError(
        'WIDGET_REVISION_SOURCE_INTEGRITY_FAILED',
        'Stored widget revision source failed integrity validation.',
      );
    }
  }

  async getActiveRevision(
    tenant: TTenantContext,
    definitionId: TWidgetDefinitionId,
  ): Promise<TWidgetRevisionDescriptor | null> {
    const row = await (await this.database.prepare(`
      ${this.#revisionSelect()}
      JOIN widget_definitions AS definition
        ON definition.org_id = revision.org_id
       AND definition.id = revision.definition_id
       AND definition.active_revision_id = revision.id
      WHERE revision.org_id = ? AND revision.definition_id = ?
    `)).get(tenant.orgId, definitionId);
    return row ? this.#validatedStoredRevision(row) : null;
  }

  async commitPublication(
    tenant: TTenantContext,
    request: TWidgetPublicationCommitInput,
  ): Promise<TWidgetPublicationCommitResult> {
    const transitionAtMs = this.#timestamp(request.nowMs, 'widget publication transition timestamp');
    return this.#runImmediate(tenant, async () => {
      const publicationManifest = this.#validatedPublicationManifest(request);
      const publicationFunctions = this.#validatedPublicationFunctions(request, publicationManifest);
      this.#assertPublicationContract(request, publicationManifest, publicationFunctions.digestSha256);
      let definition = await this.getDefinition(tenant, request.revision.definitionId);
      if (!definition) {
        if (request.expectedActiveRevisionId !== null) {
          return { status: 'conflict', currentActiveRevisionId: null } as const;
        }
        await (await this.database.prepare(`
          INSERT INTO widget_definitions (
            org_id, id, slug, name, status, active_revision_id, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, 'draft', NULL, ?, ?)
        `)).run(
          tenant.orgId,
          request.revision.definitionId,
          publicationManifest.slug,
          publicationManifest.name,
          transitionAtMs,
          transitionAtMs,
        );
        definition = await this.getDefinition(tenant, request.revision.definitionId);
        if (!definition) throw new Error('New widget definition could not be read back.');
      }
      if (definition.activeRevisionId !== request.expectedActiveRevisionId) {
        return {
          status: 'conflict',
          currentActiveRevisionId: definition.activeRevisionId,
        } as const;
      }
      if (transitionAtMs < definition.updatedAtMs) {
        throw widgetStoreError(
          'WIDGET_TRANSITION_TIMESTAMP_REGRESSION',
          'Widget publication transition time cannot move backwards.',
        );
      }

      this.#assertPublicationInput(tenant, definition, request, publicationManifest);
      const bindings = await this.#validateBindings(tenant, request, publicationManifest);
      const sourceArtifact = await this.#pinPublicationArtifact(
        tenant,
        request.source.sourceArtifact,
        'source',
      );
      const uiArtifact = await this.#pinPublicationArtifact(tenant, request.revision.uiArtifact, 'ui');
      const serverArtifact = request.revision.serverArtifact
        ? await this.#pinPublicationArtifact(tenant, request.revision.serverArtifact, 'server')
        : null;

      const nextRevisionRow = await (await this.database.prepare(`
        UPDATE widget_definitions
        SET next_revision_number = next_revision_number + 1
        WHERE org_id = ? AND id = ?
        RETURNING next_revision_number - 1 AS revision_number
      `)).get(tenant.orgId, definition.id) as { revision_number?: unknown } | null;
      const revisionNumber = Number(nextRevisionRow?.revision_number);
      if (!Number.isSafeInteger(revisionNumber) || revisionNumber < 1) {
        throw new Error('Failed to allocate a widget revision number.');
      }

      await (await this.database.prepare(`
        INSERT INTO widget_definition_revisions (
          org_id, id, definition_id, revision_number,
          ui_artifact_id, ui_artifact_kind, server_artifact_id, server_artifact_kind,
          manifest_json, contract_digest_sha256, created_at_ms,
          function_descriptors_json, function_descriptors_digest_sha256,
          contract_format_version
        ) VALUES (?, ?, ?, ?, ?, 'ui', ?, ?, ?, ?, ?, ?, ?, 2)
      `)).run(
        tenant.orgId,
        request.revision.id,
        definition.id,
        revisionNumber,
        uiArtifact.id,
        serverArtifact?.id ?? null,
        serverArtifact ? 'server' : null,
        request.revision.canonicalManifestJson,
        request.revision.contractDigestSha256,
        request.revision.createdAtMs,
        publicationFunctions.canonicalJson,
        publicationFunctions.digestSha256,
      );

      await (await this.database.prepare(`
        INSERT INTO widget_revision_sources (
          org_id, definition_id, revision_id, source_snapshot_id,
          source_artifact_id, source_artifact_kind, source_digest_sha256,
          builder_identity, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, 'source', ?, ?, ?)
      `)).run(
        tenant.orgId,
        definition.id,
        request.revision.id,
        request.source.sourceSnapshotId,
        sourceArtifact.id,
        request.source.sourceDigestSha256,
        request.source.builderIdentity,
        request.source.createdAtMs,
      );

      for (const descriptor of publicationFunctions.descriptors) {
        await (await this.database.prepare(`
          INSERT INTO function_definitions (
            org_id, id, widget_definition_id, widget_revision_id, export_name, effect,
            definition_revision, server_artifact_id, server_artifact_kind,
            artifact_digest_sha256, contract_digest_sha256, descriptor_digest_sha256,
            runtime_abi, input_schema_json, output_schema_json, resources_json,
            timeout_ms, memory_tier, output_byte_limit, log_byte_limit, retry_mode,
            max_attempts, initial_backoff_ms, max_backoff_ms, created_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'server', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)).run(
          tenant.orgId,
          fnFunctionId(definition.id, descriptor.exportName),
          definition.id,
          request.revision.id,
          descriptor.exportName,
          descriptor.effect,
          revisionNumber,
          serverArtifact?.id ?? null,
          serverArtifact?.digestSha256 ?? null,
          request.revision.contractDigestSha256,
          this.#digest(fnFunctionCanonicalJson(descriptor)),
          publicationManifest.server?.runtimeAbi ?? null,
          fnFunctionCanonicalJson(descriptor.inputSchema),
          fnFunctionCanonicalJson(descriptor.outputSchema),
          fnFunctionCanonicalJson(descriptor.resources),
          descriptor.limits.timeoutMs,
          descriptor.limits.memoryTier,
          descriptor.limits.outputByteLimit,
          descriptor.limits.logByteLimit,
          descriptor.retry.mode,
          descriptor.retry.maxAttempts,
          descriptor.retry.initialBackoffMs,
          descriptor.retry.maxBackoffMs,
          request.revision.createdAtMs,
        );
      }

      for (const item of bindings) {
        await (await this.database.prepare(`
          INSERT INTO resource_bindings (
            org_id, definition_id, revision_id, slot_name, resource_id, resource_kind,
            is_required, manifest_allow_read, manifest_allow_write,
            allow_read, allow_write, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)).run(
          tenant.orgId,
          definition.id,
          request.revision.id,
          item.requirement.slot,
          item.resourceId,
          item.requirement.kind,
          item.requirement.required === true ? 1 : 0,
          item.ceiling.allowRead ? 1 : 0,
          item.ceiling.allowWrite ? 1 : 0,
          item.allowRead ? 1 : 0,
          item.allowWrite ? 1 : 0,
          transitionAtMs,
          transitionAtMs,
        );
      }

      const update = await (await this.database.prepare(`
        UPDATE widget_definitions
        SET status = 'published', active_revision_id = ?, updated_at_ms = ?
        WHERE org_id = ? AND id = ?
          AND active_revision_id IS ?
          AND slug = ? AND name = ?
      `)).run(
        request.revision.id,
        transitionAtMs,
        tenant.orgId,
        definition.id,
        request.expectedActiveRevisionId,
        publicationManifest.slug,
        publicationManifest.name,
      );
      if (update.changes !== 1) {
        throw widgetStoreError('WIDGET_PUBLICATION_CONFLICT', 'Widget active revision changed during publication.');
      }

      const committedDefinition = await this.getDefinition(tenant, definition.id);
      const committedRevision = await this.getRevision(tenant, request.revision.id);
      if (!committedDefinition || !committedRevision) {
        throw new Error('Committed widget publication could not be read back.');
      }
      return {
        status: 'committed',
        definition: committedDefinition,
        revision: committedRevision,
        previousActiveRevisionId: definition.activeRevisionId,
      } as const;
    });
  }

  async rollbackPublication(
    tenant: TTenantContext,
    request: TWidgetRollbackInput,
  ): Promise<TWidgetActiveRevisionCasResult> {
    const transitionAtMs = this.#timestamp(request.nowMs, 'widget rollback transition timestamp');
    return this.#runImmediate(tenant, async () => {
      const definition = await this.getDefinition(tenant, request.definitionId);
      if (!definition || definition.activeRevisionId !== request.expectedActiveRevisionId) {
        return {
          status: 'conflict',
          currentActiveRevisionId: definition?.activeRevisionId ?? null,
        } as const;
      }
      if (request.targetRevisionId === request.expectedActiveRevisionId) {
        return {
          status: 'conflict',
          currentActiveRevisionId: definition.activeRevisionId,
        } as const;
      }
      if (transitionAtMs < definition.updatedAtMs) {
        throw widgetStoreError(
          'WIDGET_TRANSITION_TIMESTAMP_REGRESSION',
          'Widget rollback transition time cannot move backwards.',
        );
      }
      const target = await this.getRevision(tenant, request.targetRevisionId);
      if (!target || target.definitionId !== request.definitionId) {
        return {
          status: 'conflict',
          currentActiveRevisionId: definition.activeRevisionId,
        } as const;
      }

      const update = await (await this.database.prepare(`
        UPDATE widget_definitions
        SET status = 'published', active_revision_id = ?, updated_at_ms = ?
        WHERE org_id = ? AND id = ? AND active_revision_id = ?
          AND EXISTS (
            SELECT 1
            FROM widget_definition_revisions AS target
            WHERE target.org_id = widget_definitions.org_id
              AND target.definition_id = widget_definitions.id
              AND target.id = ?
          )
      `)).run(
        request.targetRevisionId,
        transitionAtMs,
        tenant.orgId,
        request.definitionId,
        request.expectedActiveRevisionId,
        request.targetRevisionId,
      );
      if (update.changes !== 1) {
        const current = await this.getDefinition(tenant, request.definitionId);
        return {
          status: 'conflict',
          currentActiveRevisionId: current?.activeRevisionId ?? null,
        } as const;
      }
      const updated = await this.getDefinition(tenant, request.definitionId);
      if (!updated) throw new Error('Rolled-back widget definition could not be read back.');
      return {
        status: 'updated',
        definition: updated,
        previousActiveRevisionId: request.expectedActiveRevisionId,
        activeRevisionId: request.targetRevisionId,
      } as const;
    });
  }

  async resolveArtifactReference(
    tenant: TTenantContext,
    request: TWidgetArtifactResolutionRequest,
  ): Promise<TWidgetArtifactDescriptor | null> {
    if (request.kind === 'source') {
      const source = await this.getRevisionSource(tenant, request.revisionId);
      const artifact = source?.sourceArtifact;
      return source
        && source.definitionId === request.definitionId
        && artifact
        && artifact.id === request.artifactId
        && artifact.digestSha256 === request.digestSha256
        ? artifact
        : null;
    }
    if (request.kind !== 'ui' && request.kind !== 'server') return null;
    const revision = await this.getRevision(tenant, request.revisionId);
    if (!revision || revision.definitionId !== request.definitionId) return null;
    const artifact = request.kind === 'ui' ? revision.uiArtifact : revision.serverArtifact;
    if (
      !artifact
      || artifact.id !== request.artifactId
      || artifact.kind !== request.kind
      || artifact.digestSha256 !== request.digestSha256
    ) return null;
    return artifact;
  }

  async isArtifactDigestReferenced(
    tenant: TTenantContext,
    request: Readonly<{ digestSha256: string }>,
  ): Promise<boolean> {
    const row = await (await this.database.prepare(`
      SELECT 1
      FROM artifact_references
      WHERE org_id = ? AND digest_sha256 = ?
      LIMIT 1
    `)).get(tenant.orgId, request.digestSha256);
    return Boolean(row);
  }

  async pruneInactiveRevisions(
    tenant: TTenantContext,
    request: TWidgetRevisionPruneRequest,
  ): Promise<TWidgetRevisionPruneResult> {
    const limit = this.#batchLimit(request.limit);
    const nowMs = this.#timestamp(request.nowMs, 'current timestamp');
    const cutoff = Math.min(nowMs,
      this.#timestamp(request.inactiveBeforeMs, 'inactive revision cutoff'));
    return this.#runImmediate(tenant, async () => {
      await this.#expireLivePreviews(tenant, nowMs, limit);
      // An offline Automerge document can still contain a revision placement
      // that has not reached the asynchronous widget_instances projection.
      // Until placements have a durable reservation/ack protocol, the only
      // state that proves no later canvas sync can reveal such a reference is
      // an organization with no durable canvases at all.
      const durableCanvas = await (await this.database.prepare(`
        SELECT 1 FROM canvases WHERE org_id = ? LIMIT 1
      `)).get(tenant.orgId);
      if (durableCanvas) return { prunedRevisionIds: [] };
      const rows = await (await this.database.prepare(`
        SELECT revision.id
        FROM widget_definition_revisions AS revision
        JOIN widget_definitions AS definition
          ON definition.org_id = revision.org_id
         AND definition.id = revision.definition_id
        WHERE revision.org_id = ?
          AND definition.updated_at_ms <= ?
          AND definition.active_revision_id <> revision.id
          AND NOT EXISTS (
            SELECT 1 FROM widget_instances AS instance
            WHERE instance.org_id = revision.org_id
              AND instance.definition_id = revision.definition_id
              AND instance.revision_id = revision.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM function_invocations AS invocation
            WHERE invocation.org_id = revision.org_id
              AND invocation.widget_definition_id = revision.definition_id
              AND invocation.widget_revision_id = revision.id
              AND invocation.retains_revision = 1
          )
          AND NOT EXISTS (
            SELECT 1 FROM idempotency_records AS idempotency
            WHERE idempotency.org_id = revision.org_id
              AND idempotency.widget_definition_id = revision.definition_id
              AND idempotency.widget_revision_id = revision.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM agent_previews AS preview
            WHERE preview.org_id = revision.org_id
              AND preview.artifact_id = revision.ui_artifact_id
              AND preview.artifact_kind = revision.ui_artifact_kind
              AND preview.status IN ('queued', 'building', 'ready')
          )
        ORDER BY definition.updated_at_ms ASC, revision.revision_number ASC, revision.id ASC
        LIMIT ?
      `)).all(tenant.orgId, cutoff, limit) as Array<{ id: string }>;

      const pruned: string[] = [];
      for (const row of rows) {
        const result = await (await this.database.prepare(`
          DELETE FROM widget_definition_revisions AS revision
          WHERE revision.org_id = ? AND revision.id = ?
            AND EXISTS (
              SELECT 1 FROM widget_definitions AS definition
              WHERE definition.org_id = revision.org_id
                AND definition.id = revision.definition_id
                AND definition.updated_at_ms <= ?
                AND definition.active_revision_id <> revision.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM widget_instances AS instance
              WHERE instance.org_id = revision.org_id
                AND instance.definition_id = revision.definition_id
                AND instance.revision_id = revision.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM function_invocations AS invocation
              WHERE invocation.org_id = revision.org_id
                AND invocation.widget_definition_id = revision.definition_id
                AND invocation.widget_revision_id = revision.id
                AND invocation.retains_revision = 1
            )
            AND NOT EXISTS (
              SELECT 1 FROM idempotency_records AS idempotency
              WHERE idempotency.org_id = revision.org_id
                AND idempotency.widget_definition_id = revision.definition_id
                AND idempotency.widget_revision_id = revision.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM agent_previews AS preview
              WHERE preview.org_id = revision.org_id
                AND preview.artifact_id = revision.ui_artifact_id
                AND preview.artifact_kind = revision.ui_artifact_kind
                AND preview.status IN ('queued', 'building', 'ready')
            )
        `)).run(tenant.orgId, row.id, cutoff);
        if (result.changes === 1) pruned.push(row.id);
      }
      return { prunedRevisionIds: pruned };
    });
  }

  async reconcileArtifactRetention(
    tenant: TTenantContext,
    request: TWidgetArtifactRetentionReconcileRequest,
  ): Promise<TWidgetArtifactRetentionReconcileResult> {
    const limit = this.#batchLimit(request.limit);
    const nowMs = this.#timestamp(request.nowMs, 'current timestamp');
    const gracePeriodMs = this.#timestamp(request.gracePeriodMs, 'artifact grace period');
    const retainUntilMs = nowMs + gracePeriodMs;
    if (!Number.isSafeInteger(retainUntilMs)) throw new TypeError('Artifact retention timestamp is invalid.');

    return this.#runImmediate(tenant, async () => {
      await this.#expireLivePreviews(tenant, nowMs, limit);
      await this.#pruneExpiredPreviewRevisions(tenant, nowMs, limit);
      const artifactIsReferenced = this.#artifactIsReferenced(nowMs);

      const referenced = await (await this.database.prepare(`
        SELECT id
        FROM artifact_references
        WHERE org_id = ? AND retention_state <> 'pinned'
          AND (${artifactIsReferenced})
        ORDER BY created_at_ms ASC, id ASC
        LIMIT ?
      `)).all(tenant.orgId, limit) as Array<{ id: string }>;
      const pinnedArtifactIds: string[] = [];
      for (const row of referenced) {
        const result = await (await this.database.prepare(`
          UPDATE artifact_references
          SET retention_state = 'pinned', retain_until_ms = NULL
          WHERE org_id = ? AND id = ? AND (${artifactIsReferenced})
        `)).run(tenant.orgId, row.id);
        if (result.changes === 1) pinnedArtifactIds.push(row.id);
      }

      const unreferenced = await (await this.database.prepare(`
        SELECT id
        FROM artifact_references
        WHERE org_id = ? AND retention_state = 'pinned'
          AND NOT (${artifactIsReferenced})
        ORDER BY created_at_ms ASC, id ASC
        LIMIT ?
      `)).all(tenant.orgId, limit) as Array<{ id: string }>;
      const eligibleArtifactIds: string[] = [];
      for (const row of unreferenced) {
        const result = await (await this.database.prepare(`
          UPDATE artifact_references
          SET retention_state = 'eligible', retain_until_ms = ?
          WHERE org_id = ? AND id = ? AND retention_state = 'pinned'
            AND NOT (${artifactIsReferenced})
        `)).run(retainUntilMs, tenant.orgId, row.id);
        if (result.changes === 1) eligibleArtifactIds.push(row.id);
      }
      return { pinnedArtifactIds, eligibleArtifactIds };
    });
  }

  async listArtifactGcCandidates(
    tenant: TTenantContext,
    request: TWidgetArtifactGcCandidateRequest,
  ): Promise<readonly TWidgetArtifactDescriptor[]> {
    const rows = await (await this.database.prepare(`
      SELECT *
      FROM artifact_references
      WHERE org_id = ?
        AND (
          retention_state = 'deleting'
          OR (retention_state = 'eligible' AND retain_until_ms <= ?)
        )
      ORDER BY
        CASE retention_state WHEN 'deleting' THEN 0 ELSE 1 END,
        retain_until_ms ASC,
        created_at_ms ASC,
        id ASC
      LIMIT ?
    `)).all(
      tenant.orgId,
      this.#timestamp(request.nowMs, 'current timestamp'),
      this.#batchLimit(request.limit),
    );
    return rows.map((row) => fnWidgetControlStoreArtifact(
      row as Parameters<typeof fnWidgetControlStoreArtifact>[0],
    ));
  }

  async claimArtifactDeletion(
    tenant: TTenantContext,
    request: TWidgetArtifactDeletionClaimRequest,
  ): Promise<TWidgetArtifactDescriptor | null> {
    return this.#runImmediate(tenant, async () => {
      const nowMs = this.#timestamp(request.nowMs, 'current timestamp');
      const artifactIsReferenced = this.#artifactIsReferenced(nowMs);
      const result = await (await this.database.prepare(`
        UPDATE artifact_references
        SET retention_state = 'deleting'
        WHERE org_id = ? AND id = ?
          AND digest_sha256 = ?
          AND retain_until_ms = ?
          AND retain_until_ms <= ?
          AND retention_state IN ('eligible', 'deleting')
          AND NOT (${artifactIsReferenced})
      `)).run(
        tenant.orgId,
        request.artifactId,
        request.expectedDigestSha256,
        request.expectedRetainUntilMs,
        nowMs,
      );
      if (result.changes !== 1) return null;
      const row = await (await this.database.prepare(`
        SELECT * FROM artifact_references WHERE org_id = ? AND id = ?
      `)).get(tenant.orgId, request.artifactId);
      return row
        ? fnWidgetControlStoreArtifact(row as Parameters<typeof fnWidgetControlStoreArtifact>[0])
        : null;
    });
  }

  async completeArtifactDeletion(
    tenant: TTenantContext,
    request: TWidgetArtifactDeletionCompleteRequest,
  ): Promise<TWidgetArtifactDeletionCompleteResult> {
    return this.#runImmediate(tenant, async () => {
      const artifactIsReferenced = this.#artifactIsReferenced();
      const row = await (await this.database.prepare(`
        SELECT id
        FROM artifact_references
        WHERE org_id = ? AND id = ? AND digest_sha256 = ? AND retention_state = 'deleting'
      `)).get(tenant.orgId, request.artifactId, request.expectedDigestSha256);
      if (!row) return { completed: false, deleteBlob: false };

      await (await this.database.prepare(`
        UPDATE agent_previews
        SET artifact_id = NULL, artifact_kind = NULL
        WHERE org_id = ? AND artifact_id = ?
          AND status IN ('failed', 'stopped')
      `)).run(tenant.orgId, request.artifactId);

      const result = await (await this.database.prepare(`
        DELETE FROM artifact_references
        WHERE org_id = ? AND id = ? AND digest_sha256 = ? AND retention_state = 'deleting'
          AND NOT (${artifactIsReferenced})
      `)).run(tenant.orgId, request.artifactId, request.expectedDigestSha256);
      if (result.changes !== 1) {
        await (await this.database.prepare(`
          UPDATE artifact_references
          SET retention_state = 'pinned', retain_until_ms = NULL
          WHERE org_id = ? AND id = ? AND digest_sha256 = ?
            AND (${artifactIsReferenced})
        `)).run(tenant.orgId, request.artifactId, request.expectedDigestSha256);
        return { completed: false, deleteBlob: false };
      }

      const remaining = await (await this.database.prepare(`
        SELECT 1
        FROM artifact_references
        WHERE org_id = ? AND digest_sha256 = ?
        LIMIT 1
      `)).get(tenant.orgId, request.expectedDigestSha256);
      return { completed: true, deleteBlob: !remaining };
    });
  }

  async restoreArtifactRetention(
    tenant: TTenantContext,
    request: TWidgetArtifactRetentionRestoreRequest,
  ): Promise<boolean> {
    const result = await (await this.database.prepare(`
      UPDATE artifact_references
      SET retention_state = 'pinned', retain_until_ms = NULL
      WHERE org_id = ? AND id = ? AND digest_sha256 = ?
        AND retention_state IN ('eligible', 'deleting')
    `)).run(tenant.orgId, request.artifactId, request.expectedDigestSha256);
    return result.changes === 1;
  }

  async activatePreviewArtifact(
    tenant: TTenantContext,
    request: TWidgetPreviewArtifactActivationRequest,
  ): Promise<boolean> {
    const activatedAtMs = this.#timestamp(request.nowMs, 'preview activation timestamp');
    return this.#runImmediate(tenant, async () => {
      const preview = await (await this.database.prepare(`
        UPDATE agent_previews
        SET artifact_id = ?, artifact_kind = 'ui', status = 'ready',
          last_error_json = NULL, updated_at_ms = ?
        WHERE org_id = ? AND id = ?
          AND status IN ('queued', 'building', 'failed', 'stopped')
          AND updated_at_ms <= ?
          AND expires_at_ms > ?
          AND (
            artifact_id IS NULL
            OR (artifact_id = ? AND artifact_kind = 'ui')
          )
          AND EXISTS (
            SELECT 1
            FROM artifact_references AS artifact
            WHERE artifact.org_id = agent_previews.org_id
              AND artifact.id = ?
              AND artifact.kind = 'ui'
              AND artifact.digest_sha256 = ?
              AND artifact.retention_state IN ('pinned', 'eligible')
          )
      `)).run(
        request.artifactId,
        activatedAtMs,
        tenant.orgId,
        request.previewId,
        activatedAtMs,
        activatedAtMs,
        request.artifactId,
        request.artifactId,
        request.expectedDigestSha256,
      );
      if (preview.changes !== 1) return false;

      const artifact = await (await this.database.prepare(`
        UPDATE artifact_references
        SET retention_state = 'pinned', retain_until_ms = NULL
        WHERE org_id = ? AND id = ? AND kind = 'ui'
          AND digest_sha256 = ?
          AND retention_state IN ('pinned', 'eligible')
      `)).run(tenant.orgId, request.artifactId, request.expectedDigestSha256);
      if (artifact.changes !== 1) {
        throw new Error('Preview artifact changed during activation.');
      }
      return true;
    });
  }

  async #expireLivePreviews(
    tenant: TTenantContext,
    nowMs: number,
    limit: number,
  ): Promise<void> {
    const expiredPreviews = await (await this.database.prepare(`
      SELECT id
      FROM agent_previews
      WHERE org_id = ?
        AND status IN ('queued', 'building', 'ready')
        AND expires_at_ms <= ?
      ORDER BY expires_at_ms ASC, id ASC
      LIMIT ?
    `)).all(tenant.orgId, nowMs, limit) as Array<{ id: string }>;
    for (const row of expiredPreviews) {
      await (await this.database.prepare(`
        UPDATE agent_previews
        SET status = 'stopped', active_revision_id = NULL,
          updated_at_ms = CASE WHEN updated_at_ms < ? THEN ? ELSE updated_at_ms END
        WHERE org_id = ? AND id = ?
          AND status IN ('queued', 'building', 'ready')
          AND expires_at_ms <= ?
      `)).run(nowMs, nowMs, tenant.orgId, row.id, nowMs);
    }
  }

  async #pruneExpiredPreviewRevisions(
    tenant: TTenantContext,
    nowMs: number,
    limit: number,
  ): Promise<void> {
    const rows = await (await this.database.prepare(`
      SELECT revision.preview_id, revision.id
      FROM agent_preview_revisions AS revision
      WHERE revision.org_id = ? AND revision.retain_until_ms <= ?
        AND NOT EXISTS (
          SELECT 1 FROM agent_previews AS preview
          WHERE preview.org_id = revision.org_id
            AND preview.id = revision.preview_id
            AND preview.active_revision_id = revision.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM function_invocations AS invocation
          WHERE invocation.org_id = revision.org_id
            AND invocation.subject_kind = 'agent_preview'
            AND invocation.preview_id = revision.preview_id
            AND invocation.preview_revision_id = revision.id
            AND invocation.retains_revision = 1
        )
        AND NOT EXISTS (
          SELECT 1 FROM idempotency_records AS idempotency
          WHERE idempotency.org_id = revision.org_id
            AND idempotency.scope_kind = 'agent_preview'
            AND idempotency.preview_id = revision.preview_id
            AND idempotency.preview_revision_id = revision.id
        )
      ORDER BY revision.retain_until_ms ASC, revision.id ASC
      LIMIT ?
    `)).all(tenant.orgId, nowMs, limit) as Array<{ preview_id: string; id: string }>;
    for (const row of rows) {
      await (await this.database.prepare(`
        DELETE FROM agent_preview_revisions AS revision
        WHERE revision.org_id = ? AND revision.preview_id = ? AND revision.id = ?
          AND revision.retain_until_ms <= ?
          AND NOT EXISTS (
            SELECT 1 FROM agent_previews AS preview
            WHERE preview.org_id = revision.org_id
              AND preview.id = revision.preview_id
              AND preview.active_revision_id = revision.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM function_invocations AS invocation
            WHERE invocation.org_id = revision.org_id
              AND invocation.subject_kind = 'agent_preview'
              AND invocation.preview_id = revision.preview_id
              AND invocation.preview_revision_id = revision.id
              AND invocation.retains_revision = 1
          )
          AND NOT EXISTS (
            SELECT 1 FROM idempotency_records AS idempotency
            WHERE idempotency.org_id = revision.org_id
              AND idempotency.scope_kind = 'agent_preview'
              AND idempotency.preview_id = revision.preview_id
              AND idempotency.preview_revision_id = revision.id
          )
      `)).run(tenant.orgId, row.preview_id, row.id, nowMs);
    }
  }

  #artifactIsReferenced(nowMs?: number): string {
    const retentionReference = nowMs === undefined
      ? ''
      : `OR revision.retain_until_ms > ${this.#timestamp(nowMs, 'current timestamp')}`;
    return `
      ${DURABLE_ARTIFACT_REFERENCE_SQL}
      OR EXISTS (
        SELECT 1
        FROM agent_preview_revisions AS revision
        JOIN agent_previews AS preview
          ON preview.org_id = revision.org_id AND preview.id = revision.preview_id
        WHERE revision.org_id = artifact_references.org_id
          AND (
            (revision.source_artifact_id = artifact_references.id
              AND revision.source_artifact_kind = artifact_references.kind)
            OR (revision.ui_artifact_id = artifact_references.id
              AND revision.ui_artifact_kind = artifact_references.kind)
            OR (revision.server_artifact_id = artifact_references.id
              AND revision.server_artifact_kind = artifact_references.kind)
          )
          AND (
            (preview.status = 'ready' AND preview.active_revision_id = revision.id)
            ${retentionReference}
            OR EXISTS (
              SELECT 1 FROM function_invocations AS invocation
              WHERE invocation.org_id = revision.org_id
                AND invocation.subject_kind = 'agent_preview'
                AND invocation.preview_id = revision.preview_id
                AND invocation.preview_revision_id = revision.id
                AND invocation.retains_revision = 1
            )
            OR EXISTS (
              SELECT 1 FROM idempotency_records AS idempotency
              WHERE idempotency.org_id = revision.org_id
                AND idempotency.scope_kind = 'agent_preview'
                AND idempotency.preview_id = revision.preview_id
                AND idempotency.preview_revision_id = revision.id
            )
          )
      )
    `;
  }

  #revisionSelect(): string {
    return `
      SELECT
        revision.*,
        ui.id AS ui_id,
        ui.kind AS ui_kind,
        ui.digest_sha256 AS ui_digest_sha256,
        ui.byte_size AS ui_byte_size,
        ui.retention_state AS ui_retention_state,
        ui.retain_until_ms AS ui_retain_until_ms,
        ui.created_at_ms AS ui_created_at_ms,
        server.id AS server_id,
        server.kind AS server_kind,
        server.digest_sha256 AS server_digest_sha256,
        server.byte_size AS server_byte_size,
        server.retention_state AS server_retention_state,
        server.retain_until_ms AS server_retain_until_ms,
        server.created_at_ms AS server_created_at_ms
      FROM widget_definition_revisions AS revision
      JOIN artifact_references AS ui
        ON ui.org_id = revision.org_id
       AND ui.id = revision.ui_artifact_id
       AND ui.kind = revision.ui_artifact_kind
      LEFT JOIN artifact_references AS server
        ON server.org_id = revision.org_id
       AND server.id = revision.server_artifact_id
       AND server.kind = revision.server_artifact_kind
    `;
  }

  async #validatedStoredRevision(row: unknown): Promise<TWidgetRevisionDescriptor> {
    try {
      const revision = fnWidgetControlStoreRevision(row);
      const storedRow = row as Record<string, unknown>;
      const contractFormatVersion = Number(storedRow.contract_format_version);
      const parsedManifest = ZWidgetManifestV2.safeParse(revision.manifest);
      if (!parsedManifest.success) throw new Error('Stored widget manifest is invalid.');

      const canonicalManifestJson = fnCanonicalizeWidgetManifest(parsedManifest.data);
      if (canonicalManifestJson !== revision.canonicalManifestJson) {
        throw new Error('Stored widget manifest is not canonical.');
      }

      const validatedRevision: TWidgetRevisionDescriptor = {
        ...revision,
        manifest: parsedManifest.data,
      };
      if (!fnWidgetRevisionArtifactsMatchManifest(validatedRevision)) {
        throw new Error('Stored widget artifacts do not match the manifest.');
      }

      const parsedDescriptors = ZWidgetServerFunctionDescriptors.safeParse(
        validatedRevision.functionDescriptors,
      );
      if (!parsedDescriptors.success) throw new Error('Stored function descriptors are invalid.');
      const canonicalDescriptors = fnCanonicalizeWidgetServerFunctionDescriptors(
        parsedDescriptors.data,
      );
      if (canonicalDescriptors !== String(storedRow.function_descriptors_json)) {
        throw new Error('Stored function descriptors are not canonical.');
      }
      const descriptorsDigest = this.#digest(canonicalDescriptors);
      if (descriptorsDigest !== validatedRevision.functionDescriptorsDigestSha256) {
        throw new Error('Stored function descriptor digest is invalid.');
      }

      let expectedContractDigest: string;
      if (contractFormatVersion === 1) {
        if (parsedDescriptors.data.length !== 0) {
          throw new Error('Legacy widget contracts cannot contain function descriptors.');
        }
        expectedContractDigest = this.#legacyContractDigest({
          canonicalManifestJson,
          uiDigestSha256: validatedRevision.uiArtifact.digestSha256,
          serverDigestSha256: validatedRevision.serverArtifact?.digestSha256 ?? null,
          runtimeAbi: parsedManifest.data.server?.runtimeAbi ?? null,
        });
      } else if (contractFormatVersion === 2) {
        const descriptorValidation = fnValidateWidgetServerFunctionDescriptors(
          parsedManifest.data,
          parsedDescriptors.data,
        );
        if (!descriptorValidation.valid) {
          throw new Error('Stored function descriptors exceed their manifest ceiling.');
        }
        expectedContractDigest = this.#contractDigest({
          canonicalManifestJson,
          uiDigestSha256: validatedRevision.uiArtifact.digestSha256,
          serverDigestSha256: validatedRevision.serverArtifact?.digestSha256 ?? null,
          runtimeAbi: parsedManifest.data.server?.runtimeAbi ?? null,
          functionDescriptorsDigestSha256: descriptorsDigest,
        });
        await this.#assertStoredFunctionDefinitions(
          validatedRevision,
          parsedDescriptors.data,
          parsedManifest.data.server?.runtimeAbi ?? null,
        );
      } else {
        throw new Error('Stored widget contract format is invalid.');
      }
      if (validatedRevision.contractDigestSha256 !== expectedContractDigest) {
        throw new Error('Stored widget contract digest is invalid.');
      }
      return validatedRevision;
    } catch {
      throw widgetStoreError(
        'WIDGET_REVISION_INTEGRITY_FAILED',
        'Stored widget revision failed integrity validation.',
      );
    }
  }

  #validatedPublicationManifest(request: TWidgetPublicationCommitInput): TWidgetManifestV2 {
    const result = ZWidgetManifestV2.safeParse(request.revision.manifest);
    if (!result.success) {
      throw widgetStoreError(
        'WIDGET_MANIFEST_INVALID',
        'Widget publication requires a strict manifest v2 payload.',
      );
    }
    const canonicalManifestJson = fnCanonicalizeWidgetManifest(result.data);
    if (canonicalManifestJson !== request.revision.canonicalManifestJson) {
      throw widgetStoreError(
        'WIDGET_MANIFEST_MISMATCH',
        'Canonical widget manifest does not match the validated manifest.',
      );
    }
    return result.data;
  }

  #validatedPublicationFunctions(
    request: TWidgetPublicationCommitInput,
    manifest: TWidgetManifestV2,
  ): TValidatedPublicationFunctions {
    const parsed = ZWidgetServerFunctionDescriptors.safeParse(
      request.revision.functionDescriptors,
    );
    if (!parsed.success) {
      throw widgetStoreError(
        'WIDGET_FUNCTION_DESCRIPTORS_INVALID',
        'Widget publication requires strict server-function descriptors.',
      );
    }
    const validation = fnValidateWidgetServerFunctionDescriptors(manifest, parsed.data);
    if (!validation.valid) {
      throw widgetStoreError(
        'WIDGET_FUNCTION_DESCRIPTORS_EXCEED_MANIFEST',
        `Widget function descriptors violate their manifest ceiling: ${validation.reason}.`,
      );
    }
    const canonicalJson = fnCanonicalizeWidgetServerFunctionDescriptors(parsed.data);
    const digestSha256 = this.#digest(canonicalJson);
    if (digestSha256 !== request.revision.functionDescriptorsDigestSha256) {
      throw widgetStoreError(
        'WIDGET_REVISION_INTEGRITY_FAILED',
        'Widget function descriptor digest does not match its canonical descriptors.',
      );
    }
    return { descriptors: parsed.data, canonicalJson, digestSha256 };
  }

  async #assertStoredFunctionDefinitions(
    revision: TWidgetRevisionDescriptor,
    descriptors: readonly TWidgetServerFunctionDescriptor[],
    runtimeAbi: string | null,
  ): Promise<void> {
    const rows = await (await this.database.prepare(`
      SELECT * FROM function_definitions
      WHERE org_id = ? AND widget_definition_id = ? AND widget_revision_id = ?
      ORDER BY export_name ASC
    `)).all(revision.orgId, revision.definitionId, revision.id);
    const definitions = rows.map(fnFunctionControlStoreDefinition);
    const normalized = [...descriptors]
      .map(fnNormalizeWidgetServerFunctionDescriptor)
      .sort((left, right) => left.exportName.localeCompare(right.exportName));
    if (definitions.length !== normalized.length || (normalized.length > 0 && runtimeAbi === null)) {
      throw new Error('Stored function definitions do not match the descriptor set.');
    }
    for (let index = 0; index < normalized.length; index += 1) {
      const descriptor = normalized[index]!;
      const definition = definitions[index]!;
      if (
        definition.id !== fnFunctionId(revision.definitionId, descriptor.exportName)
        || definition.widgetDefinitionId !== revision.definitionId
        || definition.widgetRevisionId !== revision.id
        || definition.name !== descriptor.exportName
        || definition.effect !== descriptor.effect
        || definition.definitionRevision !== revision.revisionNumber
        || definition.serverArtifactId !== revision.serverArtifact?.id
        || definition.artifactDigestSha256 !== revision.serverArtifact?.digestSha256
        || definition.contractDigestSha256 !== revision.contractDigestSha256
        || definition.descriptorDigestSha256 !== this.#digest(fnFunctionCanonicalJson(descriptor))
        || definition.runtimeAbi !== runtimeAbi
        || fnFunctionCanonicalJson(definition.inputSchema) !== fnFunctionCanonicalJson(descriptor.inputSchema)
        || fnFunctionCanonicalJson(definition.outputSchema) !== fnFunctionCanonicalJson(descriptor.outputSchema)
        || fnFunctionCanonicalJson(definition.resources) !== fnFunctionCanonicalJson(descriptor.resources)
        || fnFunctionCanonicalJson(definition.limits) !== fnFunctionCanonicalJson(descriptor.limits)
        || fnFunctionCanonicalJson(definition.retry) !== fnFunctionCanonicalJson(descriptor.retry)
      ) {
        throw new Error(`Stored function definition '${descriptor.exportName}' is invalid.`);
      }
    }
  }

  #assertPublicationContract(
    request: TWidgetPublicationCommitInput,
    manifest: TWidgetManifestV2,
    functionDescriptorsDigestSha256: string,
  ): void {
    const expectedContractDigest = this.#contractDigest({
      canonicalManifestJson: request.revision.canonicalManifestJson,
      uiDigestSha256: request.revision.uiArtifact.digestSha256,
      serverDigestSha256: request.revision.serverArtifact?.digestSha256 ?? null,
      runtimeAbi: manifest.server?.runtimeAbi ?? null,
      functionDescriptorsDigestSha256,
    });
    if (request.revision.contractDigestSha256 !== expectedContractDigest) {
      throw widgetStoreError(
        'WIDGET_REVISION_INTEGRITY_FAILED',
        'Widget publication contract digest does not match its immutable inputs.',
      );
    }
  }

  #contractDigest(args: Parameters<typeof fnCanonicalizeWidgetContractPayload>[0]): string {
    return this.#digest(fnCanonicalizeWidgetContractPayload(args));
  }

  #legacyContractDigest(args: Readonly<{
    canonicalManifestJson: string;
    uiDigestSha256: string;
    serverDigestSha256: string | null;
    runtimeAbi: string | null;
  }>): string {
    return this.#digest(JSON.stringify({
      format: 'vibecanvas.widget-contract.v1',
      canonicalManifestJson: args.canonicalManifestJson,
      uiDigestSha256: args.uiDigestSha256,
      serverDigestSha256: args.serverDigestSha256,
      runtimeAbi: args.runtimeAbi,
    }));
  }

  #digest(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  #assertPublicationInput(
    tenant: TTenantContext,
    definition: TWidgetDefinitionDescriptor,
    request: TWidgetPublicationCommitInput,
    manifest: TWidgetManifestV2,
  ): void {
    const revision = request.revision;
    if (revision.definitionId !== definition.id
      || manifest.slug !== definition.slug
      || manifest.name !== definition.name) {
      throw widgetStoreError(
        'WIDGET_DEFINITION_IDENTITY_MISMATCH',
        'Widget publication cannot change definition identity, slug, or name.',
      );
    }
    if (revision.uiArtifact.orgId !== tenant.orgId || revision.uiArtifact.kind !== 'ui') {
      throw widgetStoreError('WIDGET_ARTIFACT_SCOPE_INVALID', 'UI artifact scope or kind is invalid.');
    }
    if (
      request.source.sourceArtifact.orgId !== tenant.orgId
      || request.source.sourceArtifact.kind !== 'source'
    ) {
      throw widgetStoreError(
        'WIDGET_ARTIFACT_SCOPE_INVALID',
        'Source artifact scope or kind is invalid.',
      );
    }
    if (
      request.source.createdAtMs !== revision.createdAtMs
      || request.source.sourceArtifact.createdAtMs !== request.source.createdAtMs
    ) {
      throw widgetStoreError(
        'WIDGET_REVISION_SOURCE_MISMATCH',
        'Widget source provenance and revision timestamps must match.',
      );
    }
    const expectsServer = manifest.server !== undefined;
    if (expectsServer !== (revision.serverArtifact !== null)) {
      throw widgetStoreError(
        'WIDGET_ARTIFACT_MANIFEST_MISMATCH',
        'Server artifact presence must match the widget manifest.',
      );
    }
    if (revision.serverArtifact
      && (revision.serverArtifact.orgId !== tenant.orgId || revision.serverArtifact.kind !== 'server')) {
      throw widgetStoreError('WIDGET_ARTIFACT_SCOPE_INVALID', 'Server artifact scope or kind is invalid.');
    }
    if (
      revision.serverArtifact?.id === revision.uiArtifact.id
      || request.source.sourceArtifact.id === revision.uiArtifact.id
      || request.source.sourceArtifact.id === revision.serverArtifact?.id
    ) {
      throw widgetStoreError(
        'WIDGET_ARTIFACT_IDENTITY_CONFLICT',
        'Source, UI, and server artifacts must be distinct.',
      );
    }
  }

  async #validateBindings(
    tenant: TTenantContext,
    request: TWidgetPublicationCommitInput,
    manifest: TWidgetManifestV2,
  ): Promise<readonly Readonly<{
    requirement: TResourceRequirement;
    resourceId: string;
    allowRead: boolean;
    allowWrite: boolean;
    ceiling: Readonly<{ allowRead: boolean; allowWrite: boolean }>;
  }>[]> {
    const requirements = new Map(
      (manifest.resources ?? []).map((requirement) => [requirement.slot, requirement]),
    );
    if (requirements.size !== (manifest.resources?.length ?? 0)) {
      throw widgetStoreError('WIDGET_RESOURCE_REQUIREMENT_DUPLICATE', 'Widget resource slots must be unique.');
    }
    const seen = new Set<string>();
    const validated = [];
    for (const binding of request.bindings) {
      if (seen.has(binding.slot)) {
        throw widgetStoreError('WIDGET_RESOURCE_BINDING_DUPLICATE', `Resource slot '${binding.slot}' is duplicated.`);
      }
      seen.add(binding.slot);
      const requirement = requirements.get(binding.slot);
      if (!requirement || requirement.kind !== binding.kind) {
        throw widgetStoreError(
          'WIDGET_RESOURCE_BINDING_MISMATCH',
          `Resource slot '${binding.slot}' does not match the widget manifest.`,
        );
      }
      const ceiling = fnWidgetControlStoreResourceCeiling(requirement);
      if ((!binding.allowRead && !binding.allowWrite)
        || (binding.allowRead && !ceiling.allowRead)
        || (binding.allowWrite && !ceiling.allowWrite)) {
        throw widgetStoreError(
          'WIDGET_RESOURCE_BINDING_EXCEEDS_MANIFEST',
          `Resource slot '${binding.slot}' exceeds its manifest-declared access.`,
        );
      }
      const resource = await (await this.database.prepare(`
        SELECT id
        FROM resource_catalog
        WHERE org_id = ? AND id = ? AND kind = ? AND status = 'ready'
      `)).get(tenant.orgId, binding.resourceId, binding.kind);
      if (!resource) {
        throw widgetStoreError(
          'WIDGET_RESOURCE_NOT_FOUND',
          `Resource for slot '${binding.slot}' is unavailable.`,
        );
      }
      validated.push({
        requirement,
        resourceId: binding.resourceId,
        allowRead: binding.allowRead,
        allowWrite: binding.allowWrite,
        ceiling,
      });
    }
    for (const requirement of requirements.values()) {
      if (requirement.required === true && !seen.has(requirement.slot)) {
        throw widgetStoreError(
          'WIDGET_RESOURCE_BINDING_REQUIRED',
          `Required resource slot '${requirement.slot}' is not bound.`,
        );
      }
    }
    return validated;
  }

  async #pinPublicationArtifact(
    tenant: TTenantContext,
    artifact: TPublicationArtifact,
    kind: 'source' | 'ui' | 'server',
  ): Promise<TWidgetArtifactDescriptor> {
    if (artifact.orgId !== tenant.orgId || artifact.kind !== kind) {
      throw widgetStoreError('WIDGET_ARTIFACT_SCOPE_INVALID', `${kind} artifact scope or kind is invalid.`);
    }
    await (await this.database.prepare(`
      INSERT INTO artifact_references (
        org_id, id, kind, digest_sha256, byte_size,
        retention_state, retain_until_ms, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, 'pinned', NULL, ?)
      ON CONFLICT (org_id, kind, digest_sha256) DO NOTHING
    `)).run(
      tenant.orgId,
      artifact.id,
      kind,
      artifact.digestSha256,
      artifact.byteSize,
      artifact.createdAtMs,
    );
    const stored = await (await this.database.prepare(`
      SELECT *
      FROM artifact_references
      WHERE org_id = ? AND kind = ? AND digest_sha256 = ?
    `)).get(tenant.orgId, kind, artifact.digestSha256);
    if (!stored) throw new Error(`Failed to retain ${kind} widget artifact.`);
    const descriptor = fnWidgetControlStoreArtifact(
      stored as Parameters<typeof fnWidgetControlStoreArtifact>[0],
    );
    if (descriptor.byteSize !== artifact.byteSize) {
      throw widgetStoreError(
        'WIDGET_ARTIFACT_INTEGRITY_CONFLICT',
        `Stored ${kind} artifact byte size does not match its digest reference.`,
      );
    }
    if (descriptor.retentionState === 'deleting') {
      throw widgetStoreError(
        'WIDGET_ARTIFACT_DELETION_IN_PROGRESS',
        `Stored ${kind} artifact deletion is in progress; retry publication.`,
      );
    }
    if (descriptor.retentionState !== 'pinned' || descriptor.retainUntilMs !== null) {
      await (await this.database.prepare(`
        UPDATE artifact_references
        SET retention_state = 'pinned', retain_until_ms = NULL
        WHERE org_id = ? AND id = ? AND kind = ? AND digest_sha256 = ?
      `)).run(tenant.orgId, descriptor.id, kind, descriptor.digestSha256);
      return {
        ...descriptor,
        retentionState: 'pinned',
        retainUntilMs: null,
      };
    }
    return descriptor;
  }

  #runImmediate<T>(
    tenant: TTenantContext,
    operation: () => Promise<T>,
  ): Promise<T> {
    const currentScope = this.#artifactMutationScope.getStore();
    if (currentScope?.active) {
      if (currentScope.orgId !== tenant.orgId) {
        return Promise.reject(widgetStoreError(
          'WIDGET_ARTIFACT_MUTATION_SCOPE_MISMATCH',
          'A widget artifact mutation cannot cross organization scope.',
        ));
      }
      return operation();
    }

    return txRunDatabaseTransaction({ database: this.database }, {
      operation: async () => {
        const scope: TArtifactMutationScope = { active: true, orgId: tenant.orgId };
        return this.#artifactMutationScope.run(scope, async () => {
          try {
            return await operation();
          } finally {
            scope.active = false;
          }
        });
      },
    });
  }

  #batchLimit(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1 || value > CONTROL_STORE_MAX_BATCH) {
      throw new TypeError(`Batch limit must be an integer between 1 and ${CONTROL_STORE_MAX_BATCH}.`);
    }
    return value;
  }

  #timestamp(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} is invalid.`);
    return value;
  }
}
