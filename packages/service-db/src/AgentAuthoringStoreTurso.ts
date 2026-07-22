import type { Database } from '@tursodatabase/database';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type { IWidgetArtifactMutationCoordinator } from '@vibecanvas/widget-contract';

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

export type TAgentAuthoringDraftPublicationSeed = Readonly<{
  definitionId: string;
  publishedRevisionId: string;
  sourceDigestSha256: string;
}>;

export type TAgentAuthoringDraftCreate = Readonly<{
  id: string;
  chatId: string;
  name: string;
  sourceRelativePath: string;
  nowMs: number;
}> & (
  | Readonly<{ definitionId: string; publicationSeed?: undefined }>
  | Readonly<{ definitionId?: undefined; publicationSeed: TAgentAuthoringDraftPublicationSeed }>
);

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

/** Tenant- and account-qualified durable AI chat and editable-draft authority. */
export class AgentAuthoringStoreTurso {
  constructor(
    private readonly database: Database,
    private readonly mutationCoordinator: IWidgetArtifactMutationCoordinator,
  ) {}

  async createChat(
    tenant: TTenantContext,
    request: TAgentAuthoringChatCreate,
  ): Promise<TAgentAuthoringChatDescriptor> {
    this.#timestamp(request.nowMs, 'chat creation timestamp');
    this.#boundedText(request.externalSessionKey, 300, 'external session key');
    return this.#runArtifactMutation(tenant, async () => {
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
    const publicationSeed = request.publicationSeed;
    const definitionId = publicationSeed?.definitionId ?? request.definitionId;
    if (publicationSeed) {
      this.#sha256Digest(publicationSeed.sourceDigestSha256, 'publication source digest');
    }
    return this.#runArtifactMutation(tenant, async () => {
        const chat = await this.getChat(tenant, request.chatId);
        if (!chat) throw authoringError('AGENT_CHAT_NOT_FOUND', 'Agent chat is unavailable.');
        if (publicationSeed) {
          const publication = await (await this.database.prepare(`
            SELECT 1
            FROM widget_definition_revisions AS revision
            JOIN widget_definitions AS definition
              ON definition.org_id = revision.org_id
             AND definition.id = revision.definition_id
            JOIN widget_revision_sources AS source
              ON source.org_id = revision.org_id
             AND source.definition_id = revision.definition_id
             AND source.revision_id = revision.id
            WHERE revision.org_id = ?
              AND revision.definition_id = ?
              AND revision.id = ?
              AND definition.status = 'published'
              AND definition.active_revision_id = revision.id
              AND source.source_digest_sha256 = ?
          `)).get(
            tenant.orgId,
            publicationSeed.definitionId,
            publicationSeed.publishedRevisionId,
            publicationSeed.sourceDigestSha256,
          );
          if (!publication) {
            throw authoringError(
              'AGENT_DRAFT_PUBLICATION_NOT_FOUND',
              'Published revision does not belong to the seeded draft definition.',
            );
          }
        }
        const duplicate = await this.getDraftByName(tenant, request.name);
        if (duplicate && duplicate.status !== 'discarded') {
          throw authoringError(
            'AGENT_DRAFT_NAME_CONFLICT',
            `An active draft named '${request.name}' already exists for this account.`,
          );
        }
        const existingPathRow = await (await this.database.prepare(`
          ${this.#draftSelect()}
          WHERE draft.org_id = ? AND chat.account_id = ?
            AND draft.chat_id = ? AND draft.source_relative_path = ?
          LIMIT 1
        `)).get(
          tenant.orgId,
          tenant.accountId,
          request.chatId,
          request.sourceRelativePath,
        );
        const existingPath = existingPathRow ? this.#draft(existingPathRow) : null;
        if (existingPath) {
          if (existingPath.status !== 'discarded') {
            throw authoringError(
              'AGENT_DRAFT_PATH_CONFLICT',
              'An active draft already owns this source path.',
            );
          }
          if (request.nowMs < existingPath.updatedAtMs) {
            throw authoringError(
              'AGENT_DRAFT_TIMESTAMP_REGRESSION',
              'Agent draft recreation time cannot move backwards.',
            );
          }
          const revived = publicationSeed
            ? await (await this.database.prepare(`
                UPDATE agent_drafts
                SET name = ?, status = 'published', source_digest_sha256 = ?,
                  last_error_json = NULL, updated_at_ms = ?, definition_id = ?,
                  published_revision_id = ?
                WHERE org_id = ? AND id = ? AND status = 'discarded'
                  AND chat_id = ? AND source_relative_path = ?
              `)).run(
                request.name,
                publicationSeed.sourceDigestSha256,
                request.nowMs,
                publicationSeed.definitionId,
                publicationSeed.publishedRevisionId,
                tenant.orgId,
                existingPath.id,
                request.chatId,
                request.sourceRelativePath,
              )
            : await (await this.database.prepare(`
                UPDATE agent_drafts
                SET name = ?, status = 'editing', source_digest_sha256 = NULL,
                  last_error_json = NULL, updated_at_ms = ?,
                  definition_id = COALESCE(definition_id, ?)
                WHERE org_id = ? AND id = ? AND status = 'discarded'
                  AND chat_id = ? AND source_relative_path = ?
              `)).run(
                request.name,
                request.nowMs,
                definitionId,
                tenant.orgId,
                existingPath.id,
                request.chatId,
                request.sourceRelativePath,
              );
          if (revived.changes !== 1) {
            throw authoringError(
              'AGENT_DRAFT_CONFLICT',
              'Discarded draft changed before it could be recreated.',
            );
          }
          const recreated = await this.getDraft(tenant, existingPath.id);
          if (!recreated) throw new Error(`Failed to recreate agent draft '${existingPath.id}'.`);
          return recreated;
        }
        await (await this.database.prepare(`
          INSERT INTO agent_drafts (
            org_id, id, chat_id, name, status, source_relative_path,
            source_digest_sha256, last_error_json, created_at_ms, updated_at_ms,
            definition_id, published_revision_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
        `)).run(
          tenant.orgId,
          request.id,
          request.chatId,
          request.name,
          publicationSeed ? 'published' : 'editing',
          request.sourceRelativePath,
          publicationSeed?.sourceDigestSha256 ?? null,
          request.nowMs,
          request.nowMs,
          definitionId,
          publicationSeed?.publishedRevisionId ?? null,
        );
        const created = await this.getDraft(tenant, request.id);
        if (!created) throw new Error(`Failed to create agent draft '${request.id}'.`);
        return created;
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
    return this.#runArtifactMutation(tenant, async () => {
      const current = await this.getDraft(tenant, request.draftId);
        if (!current || current.sourceDigestSha256 !== request.expectedSourceDigestSha256) {
          return { status: 'conflict', current } as const;
        }
        if (current.status === 'discarded') return { status: 'conflict', current } as const;
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
            AND status <> 'discarded'
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
    });
  }

  async renameDraft(
    tenant: TTenantContext,
    request: TAgentAuthoringDraftRename,
  ): Promise<TAgentAuthoringDraftCasResult> {
    this.#timestamp(request.nowMs, 'draft rename timestamp');
    this.#boundedText(request.nextName, 200, 'draft name');
    this.#boundedText(request.nextSourceRelativePath, 1_000, 'draft source path');
    return this.#runArtifactMutation(tenant, async () => {
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
    });
  }

  async discardDraft(
    tenant: TTenantContext,
    request: TAgentAuthoringDraftDiscard,
  ): Promise<TAgentAuthoringDraftCasResult> {
    this.#timestamp(request.nowMs, 'draft discard timestamp');
    return this.#runArtifactMutation(tenant, async () => {
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
      const draft = await this.getDraft(tenant, request.draftId);
      if (!draft) throw new Error('Discarded agent draft could not be read back.');
      return { status: 'updated', draft } as const;
    });
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

  #draftSelect(): string {
    return `
      SELECT draft.*
      FROM agent_drafts AS draft
      JOIN agent_chats AS chat
        ON chat.org_id = draft.org_id AND chat.id = draft.chat_id
    `;
  }

  #runArtifactMutation<T>(
    tenant: TTenantContext,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.mutationCoordinator.runArtifactMutation(tenant, operation);
  }

  #timestamp(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`${label} must be a non-negative safe integer.`);
    }
    return value;
  }

  #sha256Digest(value: string, label: string): string {
    if (!/^[0-9a-f]{64}$/.test(value)) throw new TypeError(`${label} is invalid.`);
    return value;
  }

  #boundedText(value: string, max: number, label: string): string {
    if (value.trim() !== value || value.length < 1 || value.length > max) {
      throw new TypeError(`${label} is invalid.`);
    }
    return value;
  }
}
