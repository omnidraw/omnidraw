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
  fnValidateWidgetResourceBindings,
  fnValidateWidgetServerFunctionDescriptors,
} from '@vibecanvas/widget-contract';
import type {
  IWidgetArtifactMutationCoordinator,
  IWidgetPreviewStore,
  TWidgetArtifactDescriptor,
  TWidgetArtifactKind,
  TWidgetManifestV2,
  TWidgetPreviewArtifactResolutionRequest,
  TWidgetPreviewCommitInput,
  TWidgetPreviewCommitResult,
  TWidgetPreviewGetRequest,
  TWidgetPreviewRevisionDescriptor,
  TWidgetPreviewRevisionGetRequest,
  TWidgetPreviewStopRequest,
  TWidgetResourceBindingInput,
  TWidgetServerFunctionDescriptor,
} from '@vibecanvas/widget-contract';
import { fnWidgetControlStoreArtifact } from './WidgetControlStoreTurso/fn.widget-control-store-row';
import { fnWidgetControlStoreResourceCeiling } from './WidgetControlStoreTurso/fn.widget-control-store-row';
import { txRunDatabaseTransaction } from './tx.run-database-transaction';

export type TAgentAuthoringChatDescriptor = Readonly<{
  orgId: string;
  id: string;
  accountId: string;
  canvasId: string | null;
  externalSessionKey: string;
  name: string;
  status: 'active' | 'archived' | 'error';
  workspaceRelativePath: string;
  historyRelativePath: string;
  createdAtMs: number;
  updatedAtMs: number;
}>;

export type TAgentAuthoringChatCreate = Readonly<{
  id: string;
  canvasId: string | null;
  externalSessionKey: string;
  name: string;
  workspaceRelativePath: string;
  historyRelativePath: string;
  nowMs: number;
}>;

export type TAgentAuthoringDraftStatus =
  | 'editing'
  | 'validating'
  | 'ready'
  | 'published'
  | 'error'
  | 'discarded';

export type TAgentAuthoringDraftDescriptor = Readonly<{
  orgId: string;
  id: string;
  chatId: string;
  definitionId: string;
  publishedRevisionId: string | null;
  name: string;
  status: TAgentAuthoringDraftStatus;
  sourceRelativePath: string;
  sourceDigestSha256: string | null;
  lastError: Readonly<Record<string, unknown>> | null;
  createdAtMs: number;
  updatedAtMs: number;
}>;

export type TAgentAuthoringDraftCreate = Readonly<{
  id: string;
  chatId: string;
  definitionId: string;
  name: string;
  sourceRelativePath: string;
  nowMs: number;
}>;

export type TAgentAuthoringDraftCas = Readonly<{
  draftId: string;
  expectedSourceDigestSha256: string | null;
  nextSourceDigestSha256: string;
  nextStatus: TAgentAuthoringDraftStatus;
  nowMs: number;
  lastError?: Readonly<Record<string, unknown>> | null;
  publishedRevisionId?: string | null;
}>;

export type TAgentAuthoringDraftCasResult =
  | Readonly<{ status: 'updated'; draft: TAgentAuthoringDraftDescriptor }>
  | Readonly<{ status: 'conflict'; current: TAgentAuthoringDraftDescriptor | null }>;

export type TAgentAuthoringDraftRename = Readonly<{
  draftId: string;
  expectedName: string;
  nextName: string;
  nextSourceRelativePath: string;
  expectedSourceDigestSha256: string | null;
  nextSourceDigestSha256: string;
  nowMs: number;
}>;

export type TAgentAuthoringDraftDiscard = Readonly<{
  draftId: string;
  expectedSourceDigestSha256: string | null;
  nowMs: number;
}>;

type TValidatedBinding = Readonly<{
  input: TWidgetResourceBindingInput;
  requirement: TResourceRequirement;
  allowRead: boolean;
  allowWrite: boolean;
}>;

type TPreviewArtifactAliases = 'source' | 'ui' | 'server';

function authoringError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function storedInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw authoringError('AGENT_AUTHORING_INTEGRITY_FAILED', `Stored ${label} is invalid.`);
  }
  return parsed;
}

function parsedObject(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw authoringError('AGENT_AUTHORING_INTEGRITY_FAILED', 'Stored agent error payload is invalid.');
  }
  return parsed as Readonly<Record<string, unknown>>;
}

/** Tenant- and account-qualified durable AI chat, draft, and immutable preview authority. */
export class AgentAuthoringStoreTurso implements IWidgetPreviewStore {
  constructor(
    private readonly database: Database,
    private readonly mutationCoordinator?: IWidgetArtifactMutationCoordinator,
  ) {}

  async createChat(
    tenant: TTenantContext,
    request: TAgentAuthoringChatCreate,
  ): Promise<TAgentAuthoringChatDescriptor> {
    this.#timestamp(request.nowMs, 'chat creation timestamp');
    this.#boundedText(request.externalSessionKey, 300, 'external session key');
    return txRunDatabaseTransaction({ database: this.database }, {
      operation: async () => {
        await (await this.database.prepare(`
          INSERT INTO agent_chats (
            org_id, id, account_id, canvas_id, name, status,
            workspace_relative_path, history_relative_path,
            created_at_ms, updated_at_ms, external_session_key
          ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
        `)).run(
          tenant.orgId,
          request.id,
          tenant.accountId,
          request.canvasId,
          request.name,
          request.workspaceRelativePath,
          request.historyRelativePath,
          request.nowMs,
          request.nowMs,
          request.externalSessionKey,
        );
        const created = await this.getChat(tenant, request.id);
        if (!created) throw new Error(`Failed to create agent chat '${request.id}'.`);
        return created;
      },
    });
  }

  async getChat(
    tenant: TTenantContext,
    chatId: string,
  ): Promise<TAgentAuthoringChatDescriptor | null> {
    const row = await (await this.database.prepare(`
      SELECT * FROM agent_chats
      WHERE org_id = ? AND account_id = ? AND id = ?
    `)).get(tenant.orgId, tenant.accountId, chatId);
    return row ? this.#chat(row) : null;
  }

  async getChatByExternalSessionKey(
    tenant: TTenantContext,
    externalSessionKey: string,
  ): Promise<TAgentAuthoringChatDescriptor | null> {
    this.#boundedText(externalSessionKey, 300, 'external session key');
    const row = await (await this.database.prepare(`
      SELECT * FROM agent_chats
      WHERE org_id = ? AND account_id = ? AND external_session_key = ?
    `)).get(tenant.orgId, tenant.accountId, externalSessionKey);
    return row ? this.#chat(row) : null;
  }

  async createDraft(
    tenant: TTenantContext,
    request: TAgentAuthoringDraftCreate,
  ): Promise<TAgentAuthoringDraftDescriptor> {
    this.#timestamp(request.nowMs, 'draft creation timestamp');
    return txRunDatabaseTransaction({ database: this.database }, {
      operation: async () => {
        const chat = await this.getChat(tenant, request.chatId);
        if (!chat) throw authoringError('AGENT_CHAT_NOT_FOUND', 'Agent chat is unavailable.');
        const duplicate = await this.getDraftByName(tenant, request.name);
        if (duplicate && duplicate.status !== 'discarded') {
          throw authoringError(
            'AGENT_DRAFT_NAME_CONFLICT',
            `An active draft named '${request.name}' already exists for this account.`,
          );
        }
        await (await this.database.prepare(`
          INSERT INTO agent_drafts (
            org_id, id, chat_id, name, status, source_relative_path,
            source_digest_sha256, last_error_json, created_at_ms, updated_at_ms,
            definition_id, published_revision_id
          ) VALUES (?, ?, ?, ?, 'editing', ?, NULL, NULL, ?, ?, ?, NULL)
        `)).run(
          tenant.orgId,
          request.id,
          request.chatId,
          request.name,
          request.sourceRelativePath,
          request.nowMs,
          request.nowMs,
          request.definitionId,
        );
        const created = await this.getDraft(tenant, request.id);
        if (!created) throw new Error(`Failed to create agent draft '${request.id}'.`);
        return created;
      },
    });
  }

  async getDraft(
    tenant: TTenantContext,
    draftId: string,
  ): Promise<TAgentAuthoringDraftDescriptor | null> {
    const row = await (await this.database.prepare(`
      ${this.#draftSelect()}
      WHERE draft.org_id = ? AND chat.account_id = ? AND draft.id = ?
    `)).get(tenant.orgId, tenant.accountId, draftId);
    return row ? this.#draft(row) : null;
  }

  async getDraftByName(
    tenant: TTenantContext,
    name: string,
  ): Promise<TAgentAuthoringDraftDescriptor | null> {
    const row = await (await this.database.prepare(`
      ${this.#draftSelect()}
      WHERE draft.org_id = ? AND chat.account_id = ? AND draft.name = ?
        AND draft.status <> 'discarded'
      ORDER BY draft.updated_at_ms DESC, draft.id ASC
      LIMIT 1
    `)).get(tenant.orgId, tenant.accountId, name);
    return row ? this.#draft(row) : null;
  }

  async listDrafts(
    tenant: TTenantContext,
  ): Promise<readonly TAgentAuthoringDraftDescriptor[]> {
    const rows = await (await this.database.prepare(`
      ${this.#draftSelect()}
      WHERE draft.org_id = ? AND chat.account_id = ?
      ORDER BY draft.updated_at_ms DESC, draft.id ASC
    `)).all(tenant.orgId, tenant.accountId);
    return rows.map((row) => this.#draft(row));
  }

  async compareAndSetDraft(
    tenant: TTenantContext,
    request: TAgentAuthoringDraftCas,
  ): Promise<TAgentAuthoringDraftCasResult> {
    this.#timestamp(request.nowMs, 'draft transition timestamp');
    return txRunDatabaseTransaction({ database: this.database }, {
      operation: async () => {
        const current = await this.getDraft(tenant, request.draftId);
        if (!current || current.sourceDigestSha256 !== request.expectedSourceDigestSha256) {
          return { status: 'conflict', current } as const;
        }
        if (request.nowMs < current.updatedAtMs) {
          throw authoringError(
            'AGENT_DRAFT_TIMESTAMP_REGRESSION',
            'Agent draft transition time cannot move backwards.',
          );
        }
        if (request.publishedRevisionId !== undefined && request.publishedRevisionId !== null) {
          const publication = await (await this.database.prepare(`
            SELECT 1 FROM widget_definition_revisions
            WHERE org_id = ? AND definition_id = ? AND id = ?
          `)).get(tenant.orgId, current.definitionId, request.publishedRevisionId);
          if (!publication) {
            throw authoringError(
              'AGENT_DRAFT_PUBLICATION_NOT_FOUND',
              'Published revision does not belong to the draft definition.',
            );
          }
        }
        const result = await (await this.database.prepare(`
          UPDATE agent_drafts
          SET source_digest_sha256 = ?, status = ?,
            last_error_json = CASE WHEN ? = 1 THEN ? ELSE last_error_json END,
            published_revision_id = CASE WHEN ? = 1 THEN ? ELSE published_revision_id END,
            updated_at_ms = ?
          WHERE org_id = ? AND id = ? AND source_digest_sha256 IS ?
            AND EXISTS (
              SELECT 1 FROM agent_chats AS chat
              WHERE chat.org_id = agent_drafts.org_id
                AND chat.id = agent_drafts.chat_id
                AND chat.account_id = ?
            )
        `)).run(
          request.nextSourceDigestSha256,
          request.nextStatus,
          request.lastError === undefined ? 0 : 1,
          request.lastError === undefined || request.lastError === null
            ? null
            : JSON.stringify(request.lastError),
          request.publishedRevisionId === undefined ? 0 : 1,
          request.publishedRevisionId ?? null,
          request.nowMs,
          tenant.orgId,
          request.draftId,
          request.expectedSourceDigestSha256,
          tenant.accountId,
        );
        if (result.changes !== 1) {
          return { status: 'conflict', current: await this.getDraft(tenant, request.draftId) } as const;
        }
        const draft = await this.getDraft(tenant, request.draftId);
        if (!draft) throw new Error('Updated agent draft could not be read back.');
        return { status: 'updated', draft } as const;
      },
    });
  }

  async renameDraft(
    tenant: TTenantContext,
    request: TAgentAuthoringDraftRename,
  ): Promise<TAgentAuthoringDraftCasResult> {
    this.#timestamp(request.nowMs, 'draft rename timestamp');
    this.#boundedText(request.nextName, 200, 'draft name');
    this.#boundedText(request.nextSourceRelativePath, 1_000, 'draft source path');
    return txRunDatabaseTransaction({ database: this.database }, {
      operation: async () => {
        const current = await this.getDraft(tenant, request.draftId);
        if (
          !current
          || current.name !== request.expectedName
          || current.sourceDigestSha256 !== request.expectedSourceDigestSha256
        ) return { status: 'conflict', current } as const;
        if (current.status === 'discarded') return { status: 'conflict', current } as const;
        if (request.nowMs < current.updatedAtMs) {
          throw authoringError(
            'AGENT_DRAFT_TIMESTAMP_REGRESSION',
            'Agent draft rename time cannot move backwards.',
          );
        }
        const duplicate = await this.getDraftByName(tenant, request.nextName);
        if (duplicate && duplicate.id !== current.id) {
          throw authoringError(
            'AGENT_DRAFT_NAME_CONFLICT',
            `An active draft named '${request.nextName}' already exists for this account.`,
          );
        }
        const result = await (await this.database.prepare(`
          UPDATE agent_drafts
          SET name = ?, source_relative_path = ?, source_digest_sha256 = ?,
            status = 'editing', last_error_json = NULL, updated_at_ms = ?
          WHERE org_id = ? AND id = ? AND name = ? AND source_digest_sha256 IS ?
            AND status <> 'discarded'
            AND EXISTS (
              SELECT 1 FROM agent_chats AS chat
              WHERE chat.org_id = agent_drafts.org_id
                AND chat.id = agent_drafts.chat_id
                AND chat.account_id = ?
            )
        `)).run(
          request.nextName,
          request.nextSourceRelativePath,
          request.nextSourceDigestSha256,
          request.nowMs,
          tenant.orgId,
          request.draftId,
          request.expectedName,
          request.expectedSourceDigestSha256,
          tenant.accountId,
        );
        if (result.changes !== 1) {
          return { status: 'conflict', current: await this.getDraft(tenant, request.draftId) } as const;
        }
        const draft = await this.getDraft(tenant, request.draftId);
        if (!draft) throw new Error('Renamed agent draft could not be read back.');
        return { status: 'updated', draft } as const;
      },
    });
  }

  async discardDraft(
    tenant: TTenantContext,
    request: TAgentAuthoringDraftDiscard,
  ): Promise<TAgentAuthoringDraftCasResult> {
    this.#timestamp(request.nowMs, 'draft discard timestamp');
    return txRunDatabaseTransaction({ database: this.database }, {
      operation: async () => {
        const current = await this.getDraft(tenant, request.draftId);
        if (!current || current.sourceDigestSha256 !== request.expectedSourceDigestSha256) {
          return { status: 'conflict', current } as const;
        }
        if (current.status === 'discarded') return { status: 'conflict', current } as const;
        if (request.nowMs < current.updatedAtMs) {
          throw authoringError(
            'AGENT_DRAFT_TIMESTAMP_REGRESSION',
            'Agent draft discard time cannot move backwards.',
          );
        }
        const result = await (await this.database.prepare(`
          UPDATE agent_drafts
          SET status = 'discarded', last_error_json = NULL, updated_at_ms = ?
          WHERE org_id = ? AND id = ? AND source_digest_sha256 IS ?
            AND status <> 'discarded'
            AND EXISTS (
              SELECT 1 FROM agent_chats AS chat
              WHERE chat.org_id = agent_drafts.org_id
                AND chat.id = agent_drafts.chat_id
                AND chat.account_id = ?
            )
        `)).run(
          request.nowMs,
          tenant.orgId,
          request.draftId,
          request.expectedSourceDigestSha256,
          tenant.accountId,
        );
        if (result.changes !== 1) {
          return { status: 'conflict', current: await this.getDraft(tenant, request.draftId) } as const;
        }
        await (await this.database.prepare(`
          UPDATE agent_previews
          SET active_revision_id = NULL, status = 'stopped',
            updated_at_ms = CASE WHEN updated_at_ms < ? THEN ? ELSE updated_at_ms END
          WHERE org_id = ? AND draft_id = ?
            AND status IN ('queued', 'building', 'ready', 'failed')
        `)).run(request.nowMs, request.nowMs, tenant.orgId, request.draftId);
        const draft = await this.getDraft(tenant, request.draftId);
        if (!draft) throw new Error('Discarded agent draft could not be read back.');
        return { status: 'updated', draft } as const;
      },
    });
  }

  async commitPreview(
    tenant: TTenantContext,
    request: TWidgetPreviewCommitInput,
  ): Promise<TWidgetPreviewCommitResult> {
    return this.#runArtifactMutation(tenant, async () => {
      const revision = request.revision;
      this.#validatePreviewWindow(request);
      if (revision.draftRevisionSha256 !== revision.sourceDigestSha256) {
        throw authoringError(
          'WIDGET_PREVIEW_DRAFT_STALE',
          'Widget preview source snapshot does not match its draft revision.',
        );
      }
      const manifest = this.#validatedManifest(revision.manifest, revision.canonicalManifestJson);
      const descriptors = this.#validatedFunctions(
        manifest,
        revision.functionDescriptors,
        revision.functionDescriptorsDigestSha256,
      );
      this.#assertContractDigest(revision, manifest);
      const bindings = await this.#validatedBindings(tenant, manifest, request.bindings);

      const draft = await this.getDraft(tenant, revision.draftId);
      if (
        !draft
        || draft.definitionId !== revision.definitionId
        || draft.sourceDigestSha256 !== revision.draftRevisionSha256
      ) {
        throw authoringError(
          'WIDGET_PREVIEW_DRAFT_STALE',
          'Widget preview does not match the current account-owned draft revision.',
        );
      }

      const existing = await this.#previewOwnerRow(tenant, revision.previewId);
      if (existing) {
        const currentActiveRevisionId = existing.active_revision_id === null
          ? null
          : String(existing.active_revision_id);
        if (
          String(existing.draft_id) !== revision.draftId
          || currentActiveRevisionId !== request.expectedActiveRevisionId
        ) return { status: 'conflict', currentActiveRevisionId } as const;
      } else if (request.expectedActiveRevisionId !== null) {
        return { status: 'conflict', currentActiveRevisionId: null } as const;
      }

      const sourceArtifact = await this.#pinArtifact(tenant, revision.sourceArtifact, 'source');
      const uiArtifact = await this.#pinArtifact(tenant, revision.uiArtifact, 'ui');
      const serverArtifact = revision.serverArtifact
        ? await this.#pinArtifact(tenant, revision.serverArtifact, 'server')
        : null;
      if (
        sourceArtifact.id === uiArtifact.id
        || serverArtifact?.id === sourceArtifact.id
        || serverArtifact?.id === uiArtifact.id
      ) {
        throw authoringError('WIDGET_PREVIEW_ARTIFACT_CONFLICT', 'Preview artifacts must be distinct.');
      }

      if (!existing) {
        await (await this.database.prepare(`
          INSERT INTO agent_previews (
            org_id, id, draft_id, artifact_id, artifact_kind, relative_path,
            status, last_error_json, created_at_ms, updated_at_ms, expires_at_ms,
            active_revision_id
          ) VALUES (?, ?, ?, NULL, NULL, ?, 'building', NULL, ?, ?, ?, NULL)
        `)).run(
          tenant.orgId,
          revision.previewId,
          revision.draftId,
          `previews/${revision.previewId}`,
          request.nowMs,
          request.nowMs,
          revision.expiresAtMs,
        );
      }

      await (await this.database.prepare(`
        INSERT INTO agent_preview_revisions (
          org_id, id, preview_id, draft_id, definition_id, draft_revision_sha256,
          source_snapshot_id, source_artifact_id, source_artifact_kind, source_digest_sha256,
          manifest_json, runtime_abi, function_descriptors_json,
          function_descriptors_digest_sha256, contract_digest_sha256, builder_identity,
          ui_artifact_id, ui_artifact_kind, ui_artifact_digest_sha256,
          server_artifact_id, server_artifact_kind, server_artifact_digest_sha256,
          created_at_ms, retain_until_ms, expires_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'source', ?, ?, ?, ?, ?, ?, ?, ?, 'ui', ?, ?, ?, ?, ?, ?, ?)
      `)).run(
        tenant.orgId,
        revision.id,
        revision.previewId,
        revision.draftId,
        revision.definitionId,
        revision.draftRevisionSha256,
        revision.sourceSnapshotId,
        sourceArtifact.id,
        revision.sourceDigestSha256,
        revision.canonicalManifestJson,
        manifest.server?.runtimeAbi ?? null,
        fnCanonicalizeWidgetServerFunctionDescriptors(descriptors),
        revision.functionDescriptorsDigestSha256,
        revision.contractDigestSha256,
        revision.builderIdentity,
        uiArtifact.id,
        uiArtifact.digestSha256,
        serverArtifact?.id ?? null,
        serverArtifact ? 'server' : null,
        serverArtifact?.digestSha256 ?? null,
        revision.createdAtMs,
        revision.retainUntilMs,
        revision.expiresAtMs,
      );

      for (const binding of bindings) {
        const ceiling = fnWidgetControlStoreResourceCeiling(binding.requirement);
        await (await this.database.prepare(`
          INSERT INTO agent_preview_resource_bindings (
            org_id, preview_id, revision_id, slot_name, resource_id, resource_kind,
            is_required, manifest_allow_read, manifest_allow_write,
            allow_read, allow_write, created_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)).run(
          tenant.orgId,
          revision.previewId,
          revision.id,
          binding.requirement.slot,
          binding.input.resourceId,
          binding.requirement.kind,
          binding.requirement.required === true ? 1 : 0,
          ceiling.allowRead ? 1 : 0,
          ceiling.allowWrite ? 1 : 0,
          binding.allowRead ? 1 : 0,
          binding.allowWrite ? 1 : 0,
          request.nowMs,
        );
      }

      const activation = await (await this.database.prepare(`
        UPDATE agent_previews
        SET active_revision_id = ?, artifact_id = ?, artifact_kind = 'ui',
          status = 'ready', last_error_json = NULL, updated_at_ms = ?, expires_at_ms = ?
        WHERE org_id = ? AND id = ? AND draft_id = ?
          AND active_revision_id IS ?
          AND updated_at_ms <= ?
      `)).run(
        revision.id,
        uiArtifact.id,
        request.nowMs,
        revision.expiresAtMs,
        tenant.orgId,
        revision.previewId,
        revision.draftId,
        request.expectedActiveRevisionId,
        request.nowMs,
      );
      if (activation.changes !== 1) {
        throw authoringError('WIDGET_PREVIEW_CONFLICT', 'Widget preview active revision changed during commit.');
      }
      const committed = await this.getPreviewRevision(tenant, {
        previewId: revision.previewId,
        revisionId: revision.id,
        nowMs: request.nowMs,
      });
      if (!committed) throw new Error('Committed widget preview could not be read back.');
      return {
        status: 'committed',
        revision: committed,
        previousActiveRevisionId: request.expectedActiveRevisionId,
      } as const;
    });
  }

  async getPreview(
    tenant: TTenantContext,
    request: TWidgetPreviewGetRequest,
  ): Promise<TWidgetPreviewRevisionDescriptor | null> {
    this.#timestamp(request.nowMs, 'preview read timestamp');
    const row = await (await this.database.prepare(`
      ${this.#previewRevisionSelect()}
      WHERE revision.org_id = ? AND preview.id = ?
        AND chat.account_id = ?
        AND preview.status = 'ready'
        AND preview.active_revision_id = revision.id
        AND preview.expires_at_ms > ?
        AND revision.expires_at_ms > ?
    `)).get(
      tenant.orgId,
      request.previewId,
      tenant.accountId,
      request.nowMs,
      request.nowMs,
    );
    return row ? this.#previewRevision(row) : null;
  }

  async getPreviewRevision(
    tenant: TTenantContext,
    request: TWidgetPreviewRevisionGetRequest,
  ): Promise<TWidgetPreviewRevisionDescriptor | null> {
    this.#timestamp(request.nowMs, 'preview revision read timestamp');
    const row = await (await this.database.prepare(`
      ${this.#previewRevisionSelect()}
      WHERE revision.org_id = ? AND revision.preview_id = ? AND revision.id = ?
        AND chat.account_id = ?
        AND revision.retain_until_ms > ?
    `)).get(
      tenant.orgId,
      request.previewId,
      request.revisionId,
      tenant.accountId,
      request.nowMs,
    );
    return row ? this.#previewRevision(row) : null;
  }

  async stopPreview(
    tenant: TTenantContext,
    request: TWidgetPreviewStopRequest,
  ): Promise<boolean> {
    this.#timestamp(request.nowMs, 'preview stop timestamp');
    return this.#runArtifactMutation(tenant, async () => {
      const result = await (await this.database.prepare(`
        UPDATE agent_previews
        SET active_revision_id = NULL, status = 'stopped', updated_at_ms = ?
        WHERE org_id = ? AND id = ? AND active_revision_id = ?
          AND updated_at_ms <= ?
          AND EXISTS (
            SELECT 1
            FROM agent_drafts AS draft
            JOIN agent_chats AS chat
              ON chat.org_id = draft.org_id AND chat.id = draft.chat_id
            WHERE draft.org_id = agent_previews.org_id
              AND draft.id = agent_previews.draft_id
              AND chat.account_id = ?
          )
      `)).run(
        request.nowMs,
        tenant.orgId,
        request.previewId,
        request.expectedActiveRevisionId,
        request.nowMs,
        tenant.accountId,
      );
      return result.changes === 1;
    });
  }

  async resolvePreviewArtifact(
    tenant: TTenantContext,
    request: TWidgetPreviewArtifactResolutionRequest,
  ): Promise<TWidgetArtifactDescriptor | null> {
    const revision = await this.getPreviewRevision(tenant, {
      previewId: request.previewId,
      revisionId: request.revisionId,
      nowMs: request.nowMs,
    });
    if (!revision) return null;
    const artifact = request.kind === 'ui' ? revision.uiArtifact : revision.serverArtifact;
    return artifact
      && artifact.id === request.artifactId
      && artifact.kind === request.kind
      && artifact.digestSha256 === request.digestSha256
      ? artifact
      : null;
  }

  #chat(row: unknown): TAgentAuthoringChatDescriptor {
    const value = row as Record<string, unknown>;
    if (typeof value.external_session_key !== 'string') {
      throw authoringError('AGENT_AUTHORING_INTEGRITY_FAILED', 'Stored agent chat has no external session key.');
    }
    return {
      orgId: String(value.org_id),
      id: String(value.id),
      accountId: String(value.account_id),
      canvasId: value.canvas_id === null ? null : String(value.canvas_id),
      externalSessionKey: value.external_session_key,
      name: String(value.name),
      status: value.status as TAgentAuthoringChatDescriptor['status'],
      workspaceRelativePath: String(value.workspace_relative_path),
      historyRelativePath: String(value.history_relative_path),
      createdAtMs: storedInteger(value.created_at_ms, 'chat creation timestamp'),
      updatedAtMs: storedInteger(value.updated_at_ms, 'chat update timestamp'),
    };
  }

  #draft(row: unknown): TAgentAuthoringDraftDescriptor {
    const value = row as Record<string, unknown>;
    if (typeof value.definition_id !== 'string') {
      throw authoringError('AGENT_AUTHORING_INTEGRITY_FAILED', 'Stored agent draft has no definition identity.');
    }
    return {
      orgId: String(value.org_id),
      id: String(value.id),
      chatId: String(value.chat_id),
      definitionId: value.definition_id,
      publishedRevisionId: value.published_revision_id === null
        ? null
        : String(value.published_revision_id),
      name: String(value.name),
      status: value.status as TAgentAuthoringDraftStatus,
      sourceRelativePath: String(value.source_relative_path),
      sourceDigestSha256: value.source_digest_sha256 === null
        ? null
        : String(value.source_digest_sha256),
      lastError: parsedObject(value.last_error_json),
      createdAtMs: storedInteger(value.created_at_ms, 'draft creation timestamp'),
      updatedAtMs: storedInteger(value.updated_at_ms, 'draft update timestamp'),
    };
  }

  #previewRevision(row: unknown): TWidgetPreviewRevisionDescriptor {
    try {
      const value = row as Record<string, unknown>;
      const manifest = ZWidgetManifestV2.parse(
        typeof value.manifest_json === 'string' ? JSON.parse(value.manifest_json) : value.manifest_json,
      );
      const canonicalManifestJson = fnCanonicalizeWidgetManifest(manifest);
      if (canonicalManifestJson !== value.manifest_json) throw new Error('manifest is not canonical');
      const payload = typeof value.function_descriptors_json === 'string'
        ? JSON.parse(value.function_descriptors_json)
        : value.function_descriptors_json;
      const functions = ZWidgetServerFunctionDescriptors.parse(
        (payload as { functions?: unknown })?.functions,
      );
      const canonicalFunctions = fnCanonicalizeWidgetServerFunctionDescriptors(functions);
      if (canonicalFunctions !== value.function_descriptors_json) {
        throw new Error('function descriptors are not canonical');
      }
      const functionDigest = this.#digest(canonicalFunctions);
      if (functionDigest !== value.function_descriptors_digest_sha256) {
        throw new Error('function descriptor digest differs');
      }
      const validation = fnValidateWidgetServerFunctionDescriptors(manifest, functions);
      if (!validation.valid) throw new Error('function descriptors exceed manifest');
      const uiArtifact = this.#artifactFromAliases(value, 'ui');
      const serverArtifact = value.server_id === null || value.server_id === undefined
        ? null
        : this.#artifactFromAliases(value, 'server');
      const sourceArtifact = this.#artifactFromAliases(value, 'source');
      if (
        sourceArtifact.kind !== 'source'
        || uiArtifact.kind !== 'ui'
        || (manifest.server === undefined) !== (serverArtifact === null)
        || (serverArtifact !== null && serverArtifact.kind !== 'server')
        || String(value.ui_artifact_digest_sha256) !== uiArtifact.digestSha256
        || (serverArtifact !== null
          && String(value.server_artifact_digest_sha256) !== serverArtifact.digestSha256)
      ) throw new Error('artifact metadata differs');
      const contractDigest = this.#digest(fnCanonicalizeWidgetContractPayload({
        canonicalManifestJson,
        uiDigestSha256: uiArtifact.digestSha256,
        serverDigestSha256: serverArtifact?.digestSha256 ?? null,
        runtimeAbi: manifest.server?.runtimeAbi ?? null,
        functionDescriptorsDigestSha256: functionDigest,
      }));
      if (contractDigest !== value.contract_digest_sha256) throw new Error('contract digest differs');
      return {
        orgId: String(value.org_id),
        id: String(value.id),
        previewId: String(value.preview_id),
        draftId: String(value.draft_id),
        definitionId: String(value.definition_id),
        draftRevisionSha256: String(value.draft_revision_sha256),
        sourceSnapshotId: String(value.source_snapshot_id),
        sourceDigestSha256: String(value.source_digest_sha256),
        sourceArtifact,
        manifest,
        canonicalManifestJson,
        functionDescriptors: functions,
        functionDescriptorsDigestSha256: functionDigest,
        contractDigestSha256: contractDigest,
        builderIdentity: String(value.builder_identity),
        uiArtifact,
        serverArtifact,
        createdAtMs: storedInteger(value.created_at_ms, 'preview creation timestamp'),
        retainUntilMs: storedInteger(value.retain_until_ms, 'preview retention timestamp'),
        expiresAtMs: storedInteger(value.expires_at_ms, 'preview expiry timestamp'),
      };
    } catch {
      throw authoringError(
        'WIDGET_PREVIEW_INTEGRITY_FAILED',
        'Stored widget preview revision failed integrity validation.',
      );
    }
  }

  #artifactFromAliases(
    row: Record<string, unknown>,
    prefix: TPreviewArtifactAliases,
  ): TWidgetArtifactDescriptor {
    const digestColumn = prefix === 'source'
      ? 'source_digest_sha256_artifact'
      : `${prefix}_digest_sha256`;
    return fnWidgetControlStoreArtifact({
      org_id: String(row.org_id),
      id: String(row[`${prefix}_id`]),
      kind: row[`${prefix}_kind`] as TWidgetArtifactKind,
      digest_sha256: String(row[digestColumn]),
      byte_size: row[`${prefix}_byte_size`],
      retention_state: row[`${prefix}_retention_state`] as TWidgetArtifactDescriptor['retentionState'],
      retain_until_ms: row[`${prefix}_retain_until_ms`],
      created_at_ms: row[`${prefix}_created_at_ms`],
    });
  }

  #validatedManifest(manifest: TWidgetManifestV2, canonical: string): TWidgetManifestV2 {
    const parsed = ZWidgetManifestV2.safeParse(manifest);
    if (!parsed.success || fnCanonicalizeWidgetManifest(parsed.data) !== canonical) {
      throw authoringError('WIDGET_PREVIEW_MANIFEST_INVALID', 'Widget preview manifest is invalid.');
    }
    return parsed.data;
  }

  #validatedFunctions(
    manifest: TWidgetManifestV2,
    descriptors: readonly TWidgetServerFunctionDescriptor[],
    expectedDigest: string,
  ): readonly TWidgetServerFunctionDescriptor[] {
    const parsed = ZWidgetServerFunctionDescriptors.safeParse(descriptors);
    if (!parsed.success) {
      throw authoringError('WIDGET_PREVIEW_FUNCTIONS_INVALID', 'Widget preview functions are invalid.');
    }
    const validation = fnValidateWidgetServerFunctionDescriptors(manifest, parsed.data);
    const digest = this.#digest(fnCanonicalizeWidgetServerFunctionDescriptors(parsed.data));
    if (!validation.valid || digest !== expectedDigest) {
      throw authoringError('WIDGET_PREVIEW_FUNCTIONS_INVALID', 'Widget preview functions exceed their manifest.');
    }
    return parsed.data;
  }

  #assertContractDigest(
    revision: TWidgetPreviewCommitInput['revision'],
    manifest: TWidgetManifestV2,
  ): void {
    const digest = this.#digest(fnCanonicalizeWidgetContractPayload({
      canonicalManifestJson: revision.canonicalManifestJson,
      uiDigestSha256: revision.uiArtifact.digestSha256,
      serverDigestSha256: revision.serverArtifact?.digestSha256 ?? null,
      runtimeAbi: manifest.server?.runtimeAbi ?? null,
      functionDescriptorsDigestSha256: revision.functionDescriptorsDigestSha256,
    }));
    if (digest !== revision.contractDigestSha256) {
      throw authoringError('WIDGET_PREVIEW_INTEGRITY_FAILED', 'Widget preview contract digest is invalid.');
    }
  }

  async #validatedBindings(
    tenant: TTenantContext,
    manifest: TWidgetManifestV2,
    inputs: readonly TWidgetResourceBindingInput[],
  ): Promise<readonly TValidatedBinding[]> {
    const validation = fnValidateWidgetResourceBindings(manifest, inputs);
    if (!validation.valid) {
      throw authoringError(
        'WIDGET_PREVIEW_BINDINGS_INVALID',
        `Widget preview resource bindings are invalid: ${validation.reason}.`,
      );
    }
    const requirements = new Map((manifest.resources ?? []).map((item) => [item.slot, item]));
    const result: TValidatedBinding[] = [];
    for (const input of inputs) {
      const requirement = requirements.get(input.slot);
      if (!requirement) throw new Error('Validated widget binding has no requirement.');
      const resource = await (await this.database.prepare(`
        SELECT 1 FROM resource_catalog
        WHERE org_id = ? AND id = ? AND kind = ? AND status = 'ready'
      `)).get(tenant.orgId, input.resourceId, input.kind);
      if (!resource) {
        throw authoringError(
          'WIDGET_PREVIEW_RESOURCE_NOT_FOUND',
          `Widget preview resource '${input.slot}' is unavailable.`,
        );
      }
      result.push({ input, requirement, allowRead: input.allowRead, allowWrite: input.allowWrite });
    }
    return result;
  }

  async #pinArtifact(
    tenant: TTenantContext,
    artifact: TWidgetArtifactDescriptor,
    kind: TWidgetArtifactKind,
  ): Promise<TWidgetArtifactDescriptor> {
    if (artifact.orgId !== tenant.orgId || artifact.kind !== kind) {
      throw authoringError('WIDGET_PREVIEW_ARTIFACT_INVALID', `Preview ${kind} artifact is invalid.`);
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
    const row = await (await this.database.prepare(`
      SELECT * FROM artifact_references
      WHERE org_id = ? AND kind = ? AND digest_sha256 = ?
    `)).get(tenant.orgId, kind, artifact.digestSha256);
    if (!row) throw new Error(`Failed to pin preview ${kind} artifact.`);
    const stored = fnWidgetControlStoreArtifact(
      row as Parameters<typeof fnWidgetControlStoreArtifact>[0],
    );
    if (stored.byteSize !== artifact.byteSize || stored.retentionState === 'deleting') {
      throw authoringError(
        'WIDGET_PREVIEW_ARTIFACT_CONFLICT',
        `Preview ${kind} artifact conflicts with retained metadata.`,
      );
    }
    if (stored.retentionState !== 'pinned' || stored.retainUntilMs !== null) {
      await (await this.database.prepare(`
        UPDATE artifact_references
        SET retention_state = 'pinned', retain_until_ms = NULL
        WHERE org_id = ? AND id = ? AND kind = ? AND digest_sha256 = ?
          AND retention_state <> 'deleting'
      `)).run(tenant.orgId, stored.id, kind, stored.digestSha256);
      return { ...stored, retentionState: 'pinned', retainUntilMs: null };
    }
    return stored;
  }

  #validatePreviewWindow(request: TWidgetPreviewCommitInput): void {
    const revision = request.revision;
    this.#timestamp(request.nowMs, 'preview commit timestamp');
    this.#timestamp(revision.createdAtMs, 'preview creation timestamp');
    this.#timestamp(revision.retainUntilMs, 'preview retention timestamp');
    this.#timestamp(revision.expiresAtMs, 'preview expiry timestamp');
    if (
      revision.createdAtMs !== request.nowMs
      || revision.expiresAtMs <= request.nowMs
      || revision.retainUntilMs < revision.expiresAtMs
    ) {
      throw authoringError('WIDGET_PREVIEW_WINDOW_INVALID', 'Widget preview retention window is invalid.');
    }
  }

  async #previewOwnerRow(
    tenant: TTenantContext,
    previewId: string,
  ): Promise<Record<string, unknown> | null> {
    const row = await (await this.database.prepare(`
      SELECT preview.*
      FROM agent_previews AS preview
      JOIN agent_drafts AS draft
        ON draft.org_id = preview.org_id AND draft.id = preview.draft_id
      JOIN agent_chats AS chat
        ON chat.org_id = draft.org_id AND chat.id = draft.chat_id
      WHERE preview.org_id = ? AND preview.id = ? AND chat.account_id = ?
    `)).get(tenant.orgId, previewId, tenant.accountId);
    return row ? row as Record<string, unknown> : null;
  }

  #draftSelect(): string {
    return `
      SELECT draft.*
      FROM agent_drafts AS draft
      JOIN agent_chats AS chat
        ON chat.org_id = draft.org_id AND chat.id = draft.chat_id
    `;
  }

  #previewRevisionSelect(): string {
    return `
      SELECT
        revision.*,
        source.id AS source_id,
        source.kind AS source_kind,
        source.digest_sha256 AS source_digest_sha256_artifact,
        source.byte_size AS source_byte_size,
        source.retention_state AS source_retention_state,
        source.retain_until_ms AS source_retain_until_ms,
        source.created_at_ms AS source_created_at_ms,
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
      FROM agent_preview_revisions AS revision
      JOIN agent_previews AS preview
        ON preview.org_id = revision.org_id AND preview.id = revision.preview_id
      JOIN agent_drafts AS draft
        ON draft.org_id = revision.org_id AND draft.id = revision.draft_id
      JOIN agent_chats AS chat
        ON chat.org_id = draft.org_id AND chat.id = draft.chat_id
      JOIN artifact_references AS source
        ON source.org_id = revision.org_id
       AND source.id = revision.source_artifact_id
       AND source.kind = revision.source_artifact_kind
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

  #runArtifactMutation<T>(
    tenant: TTenantContext,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.mutationCoordinator) {
      return this.mutationCoordinator.runArtifactMutation(tenant, operation);
    }
    return txRunDatabaseTransaction({ database: this.database }, { operation });
  }

  #digest(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  #timestamp(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`${label} must be a non-negative safe integer.`);
    }
    return value;
  }

  #boundedText(value: string, max: number, label: string): string {
    if (value.trim() !== value || value.length < 1 || value.length > max) {
      throw new TypeError(`${label} is invalid.`);
    }
    return value;
  }
}
