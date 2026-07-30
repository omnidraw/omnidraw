import type { Database } from '@tursodatabase/database';
import { createHash } from 'node:crypto';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  ZWidgetCapsuleRuntimeDescriptor,
  ZWidgetDiagnostic,
  ZWidgetManifestV3,
  ZWidgetServerFunctionDescriptors,
  fnCanonicalizeWidgetCapsuleCapabilityRequests,
  fnCanonicalizeWidgetCapsuleChannelContract,
  fnCanonicalizeWidgetCapsuleRuntimeDescriptor,
  fnCanonicalizeWidgetConstructionContractPayload,
  fnCanonicalizeWidgetContractPayload,
  fnCanonicalizeWidgetManifest,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnValidateWidgetResourceBindings,
  fnValidateWidgetServerFunctionDescriptors,
  fnWidgetPreviewBindingPlanDigest,
} from '@vibecanvas/widget-contract';
import type {
  IWidgetArtifactMutationCoordinator,
  IWidgetPreviewStore,
  TWidgetArtifactDescriptor,
  TWidgetArtifactKind,
  TWidgetCapsuleBuildIdentity,
  TWidgetDistributionBuildProvenance,
  TWidgetDiagnostic,
  TWidgetPreviewArtifactResolutionRequest,
  TWidgetPreviewCommitInput,
  TWidgetPreviewCommitResult,
  TWidgetPreviewGetRequest,
  TWidgetPreviewMountLeaseAcquireRequest,
  TWidgetPreviewMountLeaseDescriptor,
  TWidgetPreviewMountLeaseReleaseRequest,
  TWidgetPreviewMountLeaseRenewRequest,
  TWidgetPreviewRevisionDescriptor,
  TWidgetPreviewRevisionGetRequest,
  TWidgetResourceBindingInput,
} from '@vibecanvas/widget-contract';
import {
  fnWidgetControlStoreArtifact,
  fnWidgetControlStoreResourceCeiling,
} from './WidgetControlStoreTurso/fn.widget-control-store-row';

const WIDGET_PREVIEW_MOUNT_LEASE_MIN_TTL_MS = 1_000;
const WIDGET_PREVIEW_MOUNT_LEASE_MAX_TTL_MS = 300_000;

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
  committedMutationId: string | null;
  buildSequence: number;
  lastError: Readonly<Record<string, unknown>> | null;
  createdAtMs: number;
  updatedAtMs: number;
}>;

export type TAgentAuthoringDraftPublicationSeed = Readonly<{
  definitionId: string;
  publishedRevisionId: string;
  sourceDigestSha256: string;
  committedMutationId: string;
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
  expectedCommittedMutationId: string | null;
  nextCommittedMutationId: string;
  expectedBuildSequence: number;
  nextBuildSequence: number;
  nextStatus: TAgentAuthoringDraftStatus;
  nowMs: number;
  lastError?: Readonly<Record<string, unknown>> | null;
  publishedRevisionId?: string | null;
}>;

export type TAgentAuthoringDraftCasResult =
  | Readonly<{ status: 'updated'; draft: TAgentAuthoringDraftDescriptor }>
  | Readonly<{ status: 'conflict'; current: TAgentAuthoringDraftDescriptor | null }>;

export type TWidgetPreviewOwnerDescriptor = Readonly<{
  orgId: string;
  id: string;
  accountId: string;
  canvasId: string;
  frameNodeId: string;
  draftId: string;
  originChatId: string;
  role: 'companion' | 'placed';
  status: 'queued' | 'building' | 'ready' | 'failed' | 'closed';
  activeRevisionId: string | null;
  pendingBuildId: string | null;
  buildSequence: number;
  bindingRevision: number;
  bindingPlanDigestSha256: string | null;
  sourceDigestSha256: string | null;
  committedMutationId: string | null;
  runtimeDiagnostics: readonly TWidgetPreviewRuntimeDiagnosticRecord[];
  publishedPreviewRevisionId: string | null;
  publishedBindingRevision: number | null;
  publishedBindingPlanDigestSha256: string | null;
  publishedWidgetRevisionId: string | null;
  publishedIdempotencyKey: string | null;
  lastError: Readonly<Record<string, unknown>> | null;
  createdAtMs: number;
  updatedAtMs: number;
  closedAtMs: number | null;
}>;

export type TWidgetPreviewRuntimeDiagnosticRecord = Readonly<{
  diagnostic: TWidgetDiagnostic;
  status: 'awaiting-retest';
  reportedAtMs: number;
}>;

export type TAgentAuthoringDraftRename = Readonly<{
  draftId: string;
  expectedName: string;
  nextName: string;
  nextSourceRelativePath: string;
  expectedSourceDigestSha256: string | null;
  nextSourceDigestSha256: string;
  expectedCommittedMutationId: string | null;
  nextCommittedMutationId: string;
  expectedBuildSequence: number;
  nextBuildSequence: number;
  nowMs: number;
}>;

export type TAgentAuthoringDraftDiscard = Readonly<{
  draftId: string;
  expectedSourceDigestSha256: string | null;
  nowMs: number;
}>;

type TPreviewArtifactAlias = 'source' | 'unsigned_ui' | 'ui' | 'server';

type TValidatedPreviewBinding = Readonly<{
  input: TWidgetResourceBindingInput;
  requirement: NonNullable<
    TWidgetPreviewCommitInput['revision']['manifest']['resources']
  >[number];
}>;

function authoringError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function assertCommittedMutationTransition(args: Readonly<{
  expectedSourceDigestSha256: string | null;
  nextSourceDigestSha256: string | null;
  expectedCommittedMutationId: string | null;
  nextCommittedMutationId: string | null;
  expectedBuildSequence: number;
  nextBuildSequence: number;
  allowSequenceJump: boolean;
}>): void {
  const expectedFenced = (
    args.expectedSourceDigestSha256 !== null
    && args.expectedCommittedMutationId !== null
    && args.expectedBuildSequence >= 1
  );
  const expectedEmpty = (
    args.expectedSourceDigestSha256 === null
    && args.expectedCommittedMutationId === null
    && args.expectedBuildSequence === 0
  );
  const nextFenced = (
    args.nextSourceDigestSha256 !== null
    && args.nextCommittedMutationId !== null
    && args.nextBuildSequence >= 1
  );
  const nextEmpty = (
    args.nextSourceDigestSha256 === null
    && args.nextCommittedMutationId === null
    && args.nextBuildSequence === 0
  );
  if (
    expectedFenced
    && args.nextSourceDigestSha256 === null
    && args.nextCommittedMutationId === null
  ) {
    throw new TypeError('Committed mutation fence cannot be cleared.');
  }
  if ((!expectedFenced && !expectedEmpty) || (!nextFenced && !nextEmpty)) {
    throw new TypeError('Committed mutation fence is incomplete.');
  }
  if (args.nextCommittedMutationId === args.expectedCommittedMutationId) {
    if (
      args.nextSourceDigestSha256 !== args.expectedSourceDigestSha256
      || args.nextBuildSequence !== args.expectedBuildSequence
    ) {
      throw new TypeError(
        'One committed mutation ID cannot identify multiple source digests or build sequences.',
      );
    }
    return;
  }
  if (args.nextCommittedMutationId === null) {
    throw new TypeError('Committed mutation identity is required.');
  }
  const minimumNextSequence = args.expectedBuildSequence + 1;
  if (
    args.nextBuildSequence < minimumNextSequence
    || (!args.allowSequenceJump && args.nextBuildSequence !== minimumNextSequence)
  ) {
    throw new TypeError('A new committed mutation ID requires the next build sequence.');
  }
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

function parsedRuntimeDiagnostics(
  value: unknown,
): readonly TWidgetPreviewRuntimeDiagnosticRecord[] {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) {
    throw authoringError(
      'AGENT_AUTHORING_INTEGRITY_FAILED',
      'Stored Preview runtime diagnostics are invalid.',
    );
  }
  return Object.freeze(parsed.map((record) => {
    if (
      typeof record !== 'object'
      || record === null
      || Array.isArray(record)
      || (record as { status?: unknown }).status !== 'awaiting-retest'
    ) {
      throw authoringError(
        'AGENT_AUTHORING_INTEGRITY_FAILED',
        'Stored Preview runtime diagnostic state is invalid.',
      );
    }
    const reportedAtMs = storedInteger(
      (record as { reportedAtMs?: unknown }).reportedAtMs,
      'Preview runtime diagnostic timestamp',
    );
    return Object.freeze({
      diagnostic: ZWidgetDiagnostic.parse(
        (record as { diagnostic?: unknown }).diagnostic,
      ),
      status: 'awaiting-retest' as const,
      reportedAtMs,
    });
  }));
}

/** Tenant- and account-qualified durable AI chat and editable-draft authority. */
export class AgentAuthoringStoreTurso implements IWidgetPreviewStore {
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
      this.#boundedText(
        publicationSeed.committedMutationId,
        1_024,
        'publication committed mutation ID',
      );
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
                  committed_mutation_id = ?, build_sequence = 1,
                  last_error_json = NULL, updated_at_ms = ?, definition_id = ?,
                  published_revision_id = ?
                WHERE org_id = ? AND id = ? AND status = 'discarded'
                  AND chat_id = ? AND source_relative_path = ?
              `)).run(
                request.name,
                publicationSeed.sourceDigestSha256,
                publicationSeed.committedMutationId,
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
                  committed_mutation_id = NULL, build_sequence = 0,
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
            source_digest_sha256, committed_mutation_id, build_sequence,
            last_error_json, created_at_ms, updated_at_ms, definition_id,
            published_revision_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
        `)).run(
          tenant.orgId,
          request.id,
          request.chatId,
          request.name,
          publicationSeed ? 'published' : 'editing',
          request.sourceRelativePath,
          publicationSeed?.sourceDigestSha256 ?? null,
          publicationSeed?.committedMutationId ?? null,
          publicationSeed ? 1 : 0,
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
    this.#boundedText(
      request.nextCommittedMutationId,
      1_024,
      'next committed mutation ID',
    );
    this.#sha256Digest(request.nextSourceDigestSha256, 'next draft source digest');
    if (request.expectedSourceDigestSha256 !== null) {
      this.#sha256Digest(request.expectedSourceDigestSha256, 'expected draft source digest');
    }
    if (
      !Number.isSafeInteger(request.expectedBuildSequence)
      || request.expectedBuildSequence < 0
      || !Number.isSafeInteger(request.nextBuildSequence)
      || request.nextBuildSequence < request.expectedBuildSequence
    ) throw new TypeError('Draft build sequence is invalid.');
    assertCommittedMutationTransition({
      expectedSourceDigestSha256: request.expectedSourceDigestSha256,
      nextSourceDigestSha256: request.nextSourceDigestSha256,
      expectedCommittedMutationId: request.expectedCommittedMutationId,
      nextCommittedMutationId: request.nextCommittedMutationId,
      expectedBuildSequence: request.expectedBuildSequence,
      nextBuildSequence: request.nextBuildSequence,
      allowSequenceJump: false,
    });
    return this.#runArtifactMutation(tenant, async () => {
      const current = await this.getDraft(tenant, request.draftId);
        if (
          !current
          || current.sourceDigestSha256 !== request.expectedSourceDigestSha256
          || current.committedMutationId !== request.expectedCommittedMutationId
          || current.buildSequence !== request.expectedBuildSequence
        ) {
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
          SET source_digest_sha256 = ?, committed_mutation_id = ?,
            build_sequence = ?, status = ?,
            last_error_json = CASE WHEN ? = 1 THEN ? ELSE last_error_json END,
            published_revision_id = CASE WHEN ? = 1 THEN ? ELSE published_revision_id END,
            updated_at_ms = ?
          WHERE org_id = ? AND id = ? AND source_digest_sha256 IS ?
            AND committed_mutation_id IS ? AND build_sequence = ?
            AND status <> 'discarded'
            AND EXISTS (
              SELECT 1 FROM agent_chats AS chat
              WHERE chat.org_id = agent_drafts.org_id
                AND chat.id = agent_drafts.chat_id
                AND chat.account_id = ?
            )
        `)).run(
          request.nextSourceDigestSha256,
          request.nextCommittedMutationId,
          request.nextBuildSequence,
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
          request.expectedCommittedMutationId,
          request.expectedBuildSequence,
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
    this.#boundedText(
      request.nextCommittedMutationId,
      1_024,
      'next committed mutation ID',
    );
    this.#sha256Digest(request.nextSourceDigestSha256, 'next draft source digest');
    if (request.expectedSourceDigestSha256 !== null) {
      this.#sha256Digest(request.expectedSourceDigestSha256, 'expected draft source digest');
    }
    if (
      !Number.isSafeInteger(request.expectedBuildSequence)
      || request.expectedBuildSequence < 0
      || !Number.isSafeInteger(request.nextBuildSequence)
      || request.nextBuildSequence < request.expectedBuildSequence
    ) throw new TypeError('Draft build sequence is invalid.');
    assertCommittedMutationTransition({
      expectedSourceDigestSha256: request.expectedSourceDigestSha256,
      nextSourceDigestSha256: request.nextSourceDigestSha256,
      expectedCommittedMutationId: request.expectedCommittedMutationId,
      nextCommittedMutationId: request.nextCommittedMutationId,
      expectedBuildSequence: request.expectedBuildSequence,
      nextBuildSequence: request.nextBuildSequence,
      allowSequenceJump: false,
    });
    return this.#runArtifactMutation(tenant, async () => {
      const current = await this.getDraft(tenant, request.draftId);
        if (
          !current
          || current.name !== request.expectedName
          || current.sourceDigestSha256 !== request.expectedSourceDigestSha256
          || current.committedMutationId !== request.expectedCommittedMutationId
          || current.buildSequence !== request.expectedBuildSequence
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
            committed_mutation_id = ?, build_sequence = ?,
            status = 'editing', last_error_json = NULL, updated_at_ms = ?
          WHERE org_id = ? AND id = ? AND name = ? AND source_digest_sha256 IS ?
            AND committed_mutation_id IS ? AND build_sequence = ?
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
          request.nextCommittedMutationId,
          request.nextBuildSequence,
          request.nowMs,
          tenant.orgId,
          request.draftId,
          request.expectedName,
          request.expectedSourceDigestSha256,
          request.expectedCommittedMutationId,
          request.expectedBuildSequence,
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
      await (await this.database.prepare(`
        UPDATE agent_previews
        SET status = 'closed',
          active_revision_id = NULL,
          pending_build_id = NULL,
          runtime_diagnostics_json = '[]',
          updated_at_ms = MAX(updated_at_ms, ?),
          closed_at_ms = MAX(updated_at_ms, ?)
        WHERE org_id = ? AND account_id = ? AND draft_id = ?
          AND status <> 'closed'
      `)).run(
        request.nowMs,
        request.nowMs,
        tenant.orgId,
        tenant.accountId,
        request.draftId,
      );
      await (await this.database.prepare(`
        DELETE FROM widget_preview_publication_idempotency
        WHERE org_id = ? AND account_id = ?
          AND json_extract(publication_identity_json, '$.draftId') = ?
      `)).run(tenant.orgId, tenant.accountId, request.draftId);
      await this.#deleteExpiredPreviewMountLeases(tenant.orgId, request.nowMs);
      await this.#prunePreviewRevisions(tenant.orgId, request.nowMs);
      const draft = await this.getDraft(tenant, request.draftId);
      if (!draft) throw new Error('Discarded agent draft could not be read back.');
      return { status: 'updated', draft } as const;
    });
  }

  async ensurePreviewOwner(
    tenant: TTenantContext,
    request: Readonly<{
      id: string;
      canvasId: string;
      frameNodeId: string;
      draftId: string;
      originChatId: string;
      role: 'companion' | 'placed';
      nowMs: number;
    }>,
  ): Promise<TWidgetPreviewOwnerDescriptor> {
    // Owner creation is a provisional reservation: the browser needs the
    // preview ID before it can commit the Cangine frame. Durable build and
    // publication paths separately require the exact persisted frame payload,
    // while startup reconciliation closes reservations whose frame never lands.
    this.#timestamp(request.nowMs, 'Preview owner creation timestamp');
    this.#boundedText(request.id, 300, 'Preview owner ID');
    this.#boundedText(request.canvasId, 300, 'Preview canvas ID');
    this.#boundedText(request.frameNodeId, 300, 'Preview frame node ID');
    this.#boundedText(request.draftId, 300, 'Preview draft ID');
    this.#boundedText(request.originChatId, 300, 'Preview origin chat ID');
    if (request.role !== 'companion' && request.role !== 'placed') {
      throw new TypeError('Preview owner role is invalid.');
    }
    return this.#runArtifactMutation(tenant, async () => {
      const reservable = await (await this.database.prepare(`
        SELECT chat.canvas_id
        FROM agent_drafts AS draft
        JOIN agent_chats AS chat
          ON chat.org_id = draft.org_id
         AND chat.id = draft.chat_id
        JOIN canvases AS canvas
          ON canvas.org_id = draft.org_id
         AND canvas.id = ?
        JOIN canvas_members AS member
          ON member.org_id = canvas.org_id
         AND member.canvas_id = canvas.id
         AND member.account_id = chat.account_id
         AND member.role IN ('owner', 'editor')
        WHERE draft.org_id = ?
          AND draft.id = ?
          AND draft.chat_id = ?
          AND draft.status <> 'discarded'
          AND chat.account_id = ?
          AND (chat.canvas_id IS NULL OR chat.canvas_id = canvas.id)
          AND (
            ? <> 'companion'
            OR EXISTS (
              SELECT 1
              FROM canvas_items AS origin
              WHERE origin.org_id = draft.org_id
                AND origin.canvas_id = canvas.id
                AND origin.kind = 'widget-frame'
                AND json_extract(
                  origin.item_json,
                  '$.extensions."vibecanvas:widget".schemaVersion'
                ) = 1
                AND json_extract(
                  origin.item_json,
                  '$.extensions."vibecanvas:widget".type'
                ) = 'ui-widget'
                AND json_extract(
                  origin.item_json,
                  '$.extensions."vibecanvas:widget".kind'
                ) = 'ai'
                AND json_type(
                  origin.item_json,
                  '$.extensions."vibecanvas:widget".payload'
                ) = 'object'
                AND json_type(
                  origin.item_json,
                  '$.extensions."vibecanvas:widget".payload.sessionId'
                ) = 'text'
                AND json_extract(
                  origin.item_json,
                  '$.extensions."vibecanvas:widget".payload.sessionId'
                ) = chat.external_session_key
            )
          )
      `)).get(
        request.canvasId,
        tenant.orgId,
        request.draftId,
        request.originChatId,
        tenant.accountId,
        request.role,
      ) as { canvas_id?: unknown } | undefined;
      if (reservable === undefined) {
        throw authoringError(
          'WIDGET_PREVIEW_OWNER_UNAUTHORIZED',
          'Preview frame does not match an editable canvas, active draft, chat, and account.',
        );
      }
      if (reservable.canvas_id === null) {
        const bound = await (await this.database.prepare(`
          UPDATE agent_chats
          SET canvas_id = ?, updated_at_ms = MAX(updated_at_ms, ?)
          WHERE org_id = ? AND account_id = ? AND id = ?
            AND canvas_id IS NULL
            AND EXISTS (
              SELECT 1
              FROM canvas_members AS member
              WHERE member.org_id = agent_chats.org_id
                AND member.canvas_id = ?
                AND member.account_id = agent_chats.account_id
                AND member.role IN ('owner', 'editor')
            )
        `)).run(
          request.canvasId,
          request.nowMs,
          tenant.orgId,
          tenant.accountId,
          request.originChatId,
          request.canvasId,
        );
        if (bound.changes !== 1) {
          throw authoringError(
            'WIDGET_PREVIEW_OWNER_CONFLICT',
            'Preview chat canvas ownership changed during reservation.',
          );
        }
      }
      const existing = await this.getPreviewOwner(tenant, request.id);
      if (existing) {
        if (
          existing.status === 'closed'
          || existing.canvasId !== request.canvasId
          || existing.frameNodeId !== request.frameNodeId
          || existing.draftId !== request.draftId
          || existing.originChatId !== request.originChatId
          || existing.role !== request.role
        ) {
          throw authoringError(
            'WIDGET_PREVIEW_OWNER_CONFLICT',
            'Preview identity is already bound to a different frame owner.',
          );
        }
        return existing;
      }
      const authority = await (await this.database.prepare(`
        SELECT 1
        FROM agent_drafts AS draft
        JOIN agent_chats AS chat
          ON chat.org_id = draft.org_id
         AND chat.id = draft.chat_id
        JOIN canvases AS canvas
          ON canvas.org_id = draft.org_id
         AND canvas.id = ?
        JOIN canvas_members AS member
          ON member.org_id = canvas.org_id
         AND member.canvas_id = canvas.id
         AND member.account_id = chat.account_id
         AND member.role IN ('owner', 'editor')
        WHERE draft.org_id = ?
          AND draft.id = ?
          AND draft.chat_id = ?
          AND draft.status <> 'discarded'
          AND chat.account_id = ?
          AND chat.canvas_id = canvas.id
      `)).get(
        request.canvasId,
        tenant.orgId,
        request.draftId,
        request.originChatId,
        tenant.accountId,
      );
      if (!authority) {
        throw authoringError(
          'WIDGET_PREVIEW_OWNER_UNAUTHORIZED',
          'Preview frame does not match an active draft, chat, canvas, and account.',
        );
      }
      if (request.role === 'companion') {
        const companion = await this.#getPreviewCompanion(
          tenant,
          request.draftId,
          request.originChatId,
        );
        if (companion) return companion;
      }
      try {
        await (await this.database.prepare(`
          INSERT INTO agent_previews (
            org_id, id, account_id, canvas_id, frame_node_id, draft_id,
            origin_chat_id, role, status, active_revision_id, pending_build_id,
            build_sequence, binding_revision, binding_plan_digest_sha256,
            source_digest_sha256, committed_mutation_id,
            runtime_diagnostics_json,
            published_preview_revision_id, published_binding_revision,
            published_binding_plan_digest_sha256, published_widget_revision_id,
            published_idempotency_key,
            last_error_json, created_at_ms, updated_at_ms, closed_at_ms
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, 'queued', NULL, NULL, 0, 0, NULL,
            NULL, NULL, '[]', NULL, NULL, NULL, NULL, NULL,
            NULL, ?, ?, NULL
          )
        `)).run(
          tenant.orgId,
          request.id,
          tenant.accountId,
          request.canvasId,
          request.frameNodeId,
          request.draftId,
          request.originChatId,
          request.role,
          request.nowMs,
          request.nowMs,
        );
      } catch (error) {
        const raced = request.role === 'companion'
          ? await this.#getPreviewCompanion(tenant, request.draftId, request.originChatId)
          : await this.getPreviewOwner(tenant, request.id);
        if (raced) return raced;
        throw error;
      }
      const created = await this.getPreviewOwner(tenant, request.id);
      if (!created) {
        throw authoringError(
          'WIDGET_PREVIEW_OWNER_CREATE_FAILED',
          'Preview owner could not be read after creation.',
        );
      }
      return created;
    });
  }

  async getPreviewOwner(
    tenant: TTenantContext,
    previewId: string,
  ): Promise<TWidgetPreviewOwnerDescriptor | null> {
    this.#boundedText(previewId, 300, 'Preview owner ID');
    const row = await (await this.database.prepare(`
      SELECT *
      FROM agent_previews
      WHERE org_id = ? AND account_id = ? AND id = ?
    `)).get(tenant.orgId, tenant.accountId, previewId);
    return row ? this.#previewOwner(row) : null;
  }

  async hasPreviewFrameOwnership(
    tenant: TTenantContext,
    request: Readonly<{
      previewId: string;
      canvasId: string;
      frameNodeId: string;
      draftId: string;
      originChatId: string;
      role: 'companion' | 'placed';
    }>,
  ): Promise<boolean> {
    this.#boundedText(request.previewId, 300, 'Preview owner ID');
    this.#boundedText(request.canvasId, 300, 'Preview canvas ID');
    this.#boundedText(request.frameNodeId, 300, 'Preview frame node ID');
    this.#boundedText(request.draftId, 300, 'Preview draft ID');
    this.#boundedText(request.originChatId, 300, 'Preview origin chat ID');
    const row = await (await this.database.prepare(`
      SELECT 1
      FROM canvas_items AS item
      WHERE item.org_id = ?
        AND item.canvas_id = ?
        AND item.id = ?
        AND item.kind = 'widget-frame'
        AND json_extract(
          item.item_json,
          '$.extensions."vibecanvas:widget".schemaVersion'
        ) = 1
        AND json_extract(
          item.item_json,
          '$.extensions."vibecanvas:widget".type'
        ) = 'ui-widget'
        AND json_extract(
          item.item_json,
          '$.extensions."vibecanvas:widget".kind'
        ) = 'preview'
        AND json_type(
          item.item_json,
          '$.extensions."vibecanvas:widget".payload'
        ) = 'object'
        AND (
          SELECT count(*)
          FROM json_each(
            item.item_json,
            '$.extensions."vibecanvas:widget".payload'
          )
        ) = 4
        AND json_extract(
          item.item_json,
          '$.extensions."vibecanvas:widget".payload.previewId'
        ) = ?
        AND json_extract(
          item.item_json,
          '$.extensions."vibecanvas:widget".payload.draftId'
        ) = ?
        AND json_extract(
          item.item_json,
          '$.extensions."vibecanvas:widget".payload.originChatId'
        ) = ?
        AND json_extract(
          item.item_json,
          '$.extensions."vibecanvas:widget".payload.role'
        ) = ?
      LIMIT 1
    `)).get(
      tenant.orgId,
      request.canvasId,
      request.frameNodeId,
      request.previewId,
      request.draftId,
      request.originChatId,
      request.role,
    );
    return row !== undefined;
  }

  async listPreviewOwners(
    tenant: TTenantContext,
    request: Readonly<{ draftId?: string; includeClosed?: boolean }> = {},
  ): Promise<readonly TWidgetPreviewOwnerDescriptor[]> {
    const rows = await (await this.database.prepare(`
      SELECT *
      FROM agent_previews
      WHERE org_id = ? AND account_id = ?
        AND (? IS NULL OR draft_id = ?)
        AND (? = TRUE OR status <> 'closed')
      ORDER BY created_at_ms ASC, id ASC
    `)).all(
      tenant.orgId,
      tenant.accountId,
      request.draftId ?? null,
      request.draftId ?? null,
      request.includeClosed === true,
    );
    return rows.map((row) => this.#previewOwner(row));
  }

  async compareAndSetPreviewOwner(
    tenant: TTenantContext,
    request: Readonly<{
      previewId: string;
      expectedBuildSequence: number;
      expectedStatus?: 'queued' | 'building' | 'ready' | 'failed';
      expectedPendingBuildId?: string | null;
      nextBuildSequence: number;
      status: 'queued' | 'building' | 'ready' | 'failed';
      activeRevisionId?: string | null;
      pendingBuildId?: string | null;
      lastError?: Readonly<Record<string, unknown>> | null;
      expectedBindingRevision?: number;
      nextBindingRevision?: number;
      expectedBindingPlanDigestSha256?: string | null;
      nextBindingPlanDigestSha256?: string | null;
      expectedSourceDigestSha256?: string | null;
      nextSourceDigestSha256?: string | null;
      expectedCommittedMutationId?: string | null;
      nextCommittedMutationId?: string | null;
      runtimeDiagnostics?: readonly TWidgetPreviewRuntimeDiagnosticRecord[];
      nowMs: number;
    }>,
  ): Promise<TWidgetPreviewOwnerDescriptor | null> {
    this.#timestamp(request.nowMs, 'Preview owner update timestamp');
    this.#boundedText(request.previewId, 300, 'Preview owner ID');
    if (!['queued', 'building', 'ready', 'failed'].includes(request.status)) {
      throw new TypeError('Preview owner status is invalid.');
    }
    if (request.activeRevisionId !== undefined && request.activeRevisionId !== null) {
      this.#boundedText(request.activeRevisionId, 300, 'Preview active revision ID');
    }
    if (request.pendingBuildId !== undefined && request.pendingBuildId !== null) {
      this.#boundedText(request.pendingBuildId, 300, 'Preview pending build ID');
    }
    if (
      request.expectedPendingBuildId !== undefined
      && request.expectedPendingBuildId !== null
    ) {
      this.#boundedText(
        request.expectedPendingBuildId,
        300,
        'Expected Preview pending build ID',
      );
    }
    if (
      request.expectedStatus !== undefined
      && !['queued', 'building', 'ready', 'failed'].includes(request.expectedStatus)
    ) {
      throw new TypeError('Expected Preview owner status is invalid.');
    }
    if (
      !Number.isSafeInteger(request.expectedBuildSequence)
      || request.expectedBuildSequence < 0
      || !Number.isSafeInteger(request.nextBuildSequence)
      || request.nextBuildSequence < request.expectedBuildSequence
    ) throw new TypeError('Preview build sequence is invalid.');
    const bindingCasConfigured = (
      request.expectedBindingRevision !== undefined
      || request.nextBindingRevision !== undefined
      || request.expectedBindingPlanDigestSha256 !== undefined
      || request.nextBindingPlanDigestSha256 !== undefined
    );
    if (
      bindingCasConfigured
      && (
        request.expectedBindingRevision === undefined
        || request.nextBindingRevision === undefined
        || request.expectedBindingPlanDigestSha256 === undefined
        || request.nextBindingPlanDigestSha256 === undefined
      )
    ) throw new TypeError('Preview binding CAS identity is incomplete.');
    if (
      bindingCasConfigured
      && (
        !Number.isSafeInteger(request.expectedBindingRevision)
        || (request.expectedBindingRevision as number) < 0
        || !Number.isSafeInteger(request.nextBindingRevision)
        || (request.nextBindingRevision as number)
          < (request.expectedBindingRevision as number)
      )
    ) throw new TypeError('Preview binding revision is invalid.');
    for (const bindingDigest of [
      request.expectedBindingPlanDigestSha256,
      request.nextBindingPlanDigestSha256,
    ]) {
      if (
        bindingDigest !== undefined
        && bindingDigest !== null
        && !/^[0-9a-f]{64}$/.test(bindingDigest)
      ) throw new TypeError('Preview binding plan digest is invalid.');
    }
    const sourceCasConfigured = (
      request.expectedSourceDigestSha256 !== undefined
      || request.nextSourceDigestSha256 !== undefined
      || request.expectedCommittedMutationId !== undefined
      || request.nextCommittedMutationId !== undefined
    );
    if (
      sourceCasConfigured
      && (
        request.expectedSourceDigestSha256 === undefined
        || request.nextSourceDigestSha256 === undefined
        || request.expectedCommittedMutationId === undefined
        || request.nextCommittedMutationId === undefined
      )
    ) throw new TypeError('Preview source CAS identity is incomplete.');
    for (const sourceDigest of [
      request.expectedSourceDigestSha256,
      request.nextSourceDigestSha256,
    ]) {
      if (sourceDigest !== undefined && sourceDigest !== null) {
        this.#sha256Digest(sourceDigest, 'Preview source digest');
      }
    }
    for (const mutationId of [
      request.expectedCommittedMutationId,
      request.nextCommittedMutationId,
    ]) {
      if (mutationId !== undefined && mutationId !== null) {
        this.#boundedText(mutationId, 1_024, 'Preview committed mutation ID');
      }
    }
    if (!sourceCasConfigured && request.nextBuildSequence !== request.expectedBuildSequence) {
      throw new TypeError(
        'Preview build sequence can change only with an exact committed source fence.',
      );
    }
    if (sourceCasConfigured) {
      assertCommittedMutationTransition({
        expectedSourceDigestSha256: request.expectedSourceDigestSha256!,
        nextSourceDigestSha256: request.nextSourceDigestSha256!,
        expectedCommittedMutationId: request.expectedCommittedMutationId!,
        nextCommittedMutationId: request.nextCommittedMutationId!,
        expectedBuildSequence: request.expectedBuildSequence,
        nextBuildSequence: request.nextBuildSequence,
        allowSequenceJump: true,
      });
    }
    const nextRuntimeDiagnostics = request.runtimeDiagnostics === undefined
      ? undefined
      : parsedRuntimeDiagnostics(request.runtimeDiagnostics);
    return this.#runArtifactMutation(tenant, async () => {
      const current = await this.getPreviewOwner(tenant, request.previewId);
      if (
        !current
        || current.status === 'closed'
        || current.buildSequence !== request.expectedBuildSequence
        || (
          request.expectedStatus !== undefined
          && current.status !== request.expectedStatus
        )
        || (
          request.expectedPendingBuildId !== undefined
          && current.pendingBuildId !== request.expectedPendingBuildId
        )
        || (
          bindingCasConfigured
          && (
            current.bindingRevision !== request.expectedBindingRevision
            || current.bindingPlanDigestSha256
              !== request.expectedBindingPlanDigestSha256
          )
        )
        || (
          sourceCasConfigured
          && (
            current.sourceDigestSha256 !== request.expectedSourceDigestSha256
            || current.committedMutationId !== request.expectedCommittedMutationId
          )
        )
        || request.nowMs < current.updatedAtMs
      ) return null;
      if (sourceCasConfigured) {
        const draft = await this.getDraft(tenant, current.draftId);
        if (
          draft === null
          || draft.status === 'discarded'
          || draft.sourceDigestSha256 !== request.nextSourceDigestSha256
          || draft.committedMutationId !== request.nextCommittedMutationId
          || draft.buildSequence !== request.nextBuildSequence
        ) return null;
      }
      const result = await (await this.database.prepare(`
        UPDATE agent_previews
        SET status = ?,
          active_revision_id = ?,
          pending_build_id = ?,
          build_sequence = ?,
          binding_revision = ?,
          binding_plan_digest_sha256 = ?,
          source_digest_sha256 = ?,
          committed_mutation_id = ?,
          runtime_diagnostics_json = ?,
          last_error_json = ?,
          updated_at_ms = ?
        WHERE org_id = ? AND account_id = ? AND id = ?
          AND status <> 'closed' AND build_sequence = ?
          AND (? IS NULL OR status = ?)
          AND (? = 0 OR pending_build_id IS ?)
          AND (? = 0 OR (
            binding_revision = ? AND binding_plan_digest_sha256 IS ?
          ))
          AND source_digest_sha256 IS ?
          AND committed_mutation_id IS ?
      `)).run(
        request.status,
        request.activeRevisionId === undefined
          ? current.activeRevisionId
          : request.activeRevisionId,
        request.pendingBuildId === undefined
          ? current.pendingBuildId
          : request.pendingBuildId,
        request.nextBuildSequence,
        bindingCasConfigured
          ? request.nextBindingRevision
          : current.bindingRevision,
        bindingCasConfigured
          ? request.nextBindingPlanDigestSha256
          : current.bindingPlanDigestSha256,
        sourceCasConfigured
          ? request.nextSourceDigestSha256
          : current.sourceDigestSha256,
        sourceCasConfigured
          ? request.nextCommittedMutationId
          : current.committedMutationId,
        JSON.stringify(nextRuntimeDiagnostics ?? current.runtimeDiagnostics),
        request.lastError === undefined
          ? current.lastError === null ? null : JSON.stringify(current.lastError)
          : request.lastError === null ? null : JSON.stringify(request.lastError),
        request.nowMs,
        tenant.orgId,
        tenant.accountId,
        request.previewId,
        request.expectedBuildSequence,
        request.expectedStatus ?? null,
        request.expectedStatus ?? null,
        request.expectedPendingBuildId === undefined ? 0 : 1,
        request.expectedPendingBuildId ?? null,
        bindingCasConfigured ? 1 : 0,
        bindingCasConfigured
          ? request.expectedBindingRevision
          : current.bindingRevision,
        bindingCasConfigured
          ? request.expectedBindingPlanDigestSha256
          : current.bindingPlanDigestSha256,
        current.sourceDigestSha256,
        current.committedMutationId,
      );
      return result.changes === 1
        ? this.getPreviewOwner(tenant, request.previewId)
        : null;
    });
  }

  async closePreviewOwner(
    tenant: TTenantContext,
    request: Readonly<{
      previewId: string;
      frameNodeId: string;
      nowMs: number;
    }>,
  ): Promise<boolean> {
    this.#timestamp(request.nowMs, 'Preview owner close timestamp');
    this.#boundedText(request.previewId, 300, 'Preview owner ID');
    this.#boundedText(request.frameNodeId, 300, 'Preview frame node ID');
    return this.#runArtifactMutation(tenant, async () => {
      const current = await this.getPreviewOwner(tenant, request.previewId);
      if (!current || current.frameNodeId !== request.frameNodeId) return false;
      if (current.status === 'closed') {
        await (await this.database.prepare(`
          UPDATE agent_previews
          SET active_revision_id = NULL, pending_build_id = NULL
          WHERE org_id = ? AND account_id = ? AND id = ?
            AND frame_node_id = ? AND status = 'closed'
        `)).run(
          tenant.orgId,
          tenant.accountId,
          request.previewId,
          request.frameNodeId,
        );
        await (await this.database.prepare(`
          DELETE FROM widget_preview_publication_idempotency
          WHERE org_id = ? AND account_id = ?
            AND json_extract(publication_identity_json, '$.previewId') = ?
        `)).run(tenant.orgId, tenant.accountId, request.previewId);
        await this.#deleteExpiredPreviewMountLeases(tenant.orgId, request.nowMs);
        await this.#prunePreviewRevisions(
          tenant.orgId,
          request.nowMs,
          request.previewId,
        );
        return true;
      }
      if (request.nowMs < current.updatedAtMs) {
        throw authoringError(
          'WIDGET_PREVIEW_TIMESTAMP_REGRESSION',
          'Preview close timestamp cannot move backwards.',
        );
      }
      const result = await (await this.database.prepare(`
        UPDATE agent_previews
        SET status = 'closed', active_revision_id = NULL, pending_build_id = NULL,
          runtime_diagnostics_json = '[]',
          updated_at_ms = ?, closed_at_ms = ?
        WHERE org_id = ? AND account_id = ? AND id = ?
          AND frame_node_id = ? AND status <> 'closed'
      `)).run(
        request.nowMs,
        request.nowMs,
        tenant.orgId,
        tenant.accountId,
        request.previewId,
        request.frameNodeId,
      );
      if (result.changes === 1) {
        await (await this.database.prepare(`
          DELETE FROM widget_preview_publication_idempotency
          WHERE org_id = ? AND account_id = ?
            AND json_extract(publication_identity_json, '$.previewId') = ?
        `)).run(tenant.orgId, tenant.accountId, request.previewId);
        await this.#deleteExpiredPreviewMountLeases(tenant.orgId, request.nowMs);
        await this.#prunePreviewRevisions(
          tenant.orgId,
          request.nowMs,
          request.previewId,
        );
      }
      return result.changes === 1;
    });
  }

  async commitPreview(
    tenant: TTenantContext,
    request: TWidgetPreviewCommitInput,
  ): Promise<TWidgetPreviewCommitResult> {
    this.#timestamp(request.nowMs, 'Preview revision creation timestamp');
    const revision = request.revision;
    if (
      revision.createdAtMs !== request.nowMs
      || revision.buildSequence !== request.expectedBuildSequence
      || revision.draftRevisionSha256 !== revision.sourceDigestSha256
    ) {
      throw authoringError(
        'WIDGET_PREVIEW_REVISION_INVALID',
        'Preview revision sequence, timestamp, or source identity is invalid.',
      );
    }
    const validated = this.#validatedPreviewRevision(revision);
    return this.#runArtifactMutation(tenant, async () => {
      const owner = await this.getPreviewOwner(tenant, revision.previewId);
      if (
        owner === null
        || owner.status === 'closed'
        || owner.status !== 'building'
        || owner.draftId !== revision.draftId
        || owner.activeRevisionId !== request.expectedActiveRevisionId
        || owner.buildSequence !== request.expectedBuildSequence
        || owner.bindingRevision !== revision.bindingRevision
        || owner.bindingPlanDigestSha256 !== revision.bindingPlanDigestSha256
        || owner.sourceDigestSha256 !== revision.sourceDigestSha256
        || owner.committedMutationId !== revision.committedMutationId
      ) {
        return {
          status: 'conflict',
          currentActiveRevisionId: owner?.activeRevisionId ?? null,
          currentBuildSequence: owner?.buildSequence ?? 0,
        };
      }
      const draft = await this.getDraft(tenant, revision.draftId);
      if (
        draft === null
        || draft.status === 'discarded'
        || draft.definitionId !== revision.definitionId
        || draft.sourceDigestSha256 !== revision.draftRevisionSha256
        || draft.committedMutationId !== revision.committedMutationId
      ) {
        throw authoringError(
          'WIDGET_PREVIEW_DRAFT_STALE',
          'Preview revision no longer matches its active draft.',
        );
      }
      const bindings = await this.#validatedPreviewBindings(
        tenant,
        validated.manifest,
        request.bindings,
      );
      const bindingPlanDigestSha256 = fnWidgetPreviewBindingPlanDigest({
        bindings: request.bindings,
        digestSha256: (value) => this.#digest(value),
      });
      if (bindingPlanDigestSha256 !== revision.bindingPlanDigestSha256) {
        throw authoringError(
          'WIDGET_PREVIEW_BINDING_PLAN_STALE',
          'Preview revision no longer matches the selected resource bindings.',
        );
      }
      const sourceArtifact = await this.#pinPreviewArtifact(
        tenant,
        revision.sourceArtifact,
        'source',
      );
      const unsignedUiArtifact = await this.#pinPreviewArtifact(
        tenant,
        revision.unsignedUiArtifact,
        'unsigned_ui',
      );
      const uiArtifact = await this.#pinPreviewArtifact(
        tenant,
        revision.uiArtifact,
        'ui',
      );
      const serverArtifact = revision.serverArtifact === null
        ? null
        : await this.#pinPreviewArtifact(tenant, revision.serverArtifact, 'server');
      const artifactIds = [
        sourceArtifact.id,
        unsignedUiArtifact.id,
        uiArtifact.id,
        ...(serverArtifact === null ? [] : [serverArtifact.id]),
      ];
      if (new Set(artifactIds).size !== artifactIds.length) {
        throw authoringError(
          'WIDGET_PREVIEW_ARTIFACT_CONFLICT',
          'Preview construction artifacts must have distinct metadata identities.',
        );
      }

      await (await this.database.prepare(`
        INSERT INTO agent_preview_revisions (
          org_id, id, preview_id, draft_id, definition_id,
          draft_revision_sha256, committed_mutation_id,
          source_snapshot_id, source_digest_sha256,
          source_artifact_id, source_artifact_kind, source_artifact_digest_sha256,
          manifest_json, function_descriptors_json,
          function_descriptors_digest_sha256, capability_contract_digest_sha256,
          channel_contract_digest_sha256, construction_contract_digest_sha256,
          preview_contract_digest_sha256, builder_identity,
          capsule_build_identity_json, build_policy_id,
          distribution_provenance_json,
          unsigned_ui_artifact_id, unsigned_ui_artifact_kind,
          unsigned_ui_artifact_digest_sha256,
          ui_artifact_id, ui_artifact_kind, ui_artifact_digest_sha256,
          ui_runtime_json, capsule_artifact_hash,
          server_artifact_id, server_artifact_kind,
          server_artifact_digest_sha256, server_runtime_abi,
          binding_revision, binding_plan_digest_sha256,
          build_sequence, diagnostics_json, created_at_ms
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'source', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, 'unsigned_ui', ?, ?, 'ui', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `)).run(
        tenant.orgId,
        revision.id,
        revision.previewId,
        revision.draftId,
        revision.definitionId,
        revision.draftRevisionSha256,
        revision.committedMutationId,
        revision.sourceSnapshotId,
        revision.sourceDigestSha256,
        sourceArtifact.id,
        sourceArtifact.digestSha256,
        validated.canonicalManifestJson,
        validated.functionDescriptorsJson,
        revision.functionDescriptorsDigestSha256,
        revision.capabilityContractDigestSha256,
        revision.channelContractDigestSha256,
        revision.constructionContractDigestSha256,
        revision.previewContractDigestSha256,
        revision.builderIdentity,
        validated.capsuleBuildIdentityJson,
        revision.buildPolicyId,
        validated.distributionProvenanceJson,
        unsignedUiArtifact.id,
        unsignedUiArtifact.digestSha256,
        uiArtifact.id,
        uiArtifact.digestSha256,
        validated.uiRuntimeJson,
        revision.uiRuntime.capsuleArtifactHash,
        serverArtifact?.id ?? null,
        serverArtifact === null ? null : 'server',
        serverArtifact?.digestSha256 ?? null,
        revision.serverRuntimeAbi,
        revision.bindingRevision,
        revision.bindingPlanDigestSha256,
        revision.buildSequence,
        validated.diagnosticsJson,
        revision.createdAtMs,
      );

      for (const binding of bindings) {
        const ceiling = fnWidgetControlStoreResourceCeiling(binding.requirement);
        await (await this.database.prepare(`
          INSERT INTO agent_preview_resource_bindings (
            org_id, preview_id, revision_id, slot_name, resource_id,
            resource_kind, is_required, manifest_allow_read,
            manifest_allow_write, allow_read, allow_write, created_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)).run(
          tenant.orgId,
          revision.previewId,
          revision.id,
          binding.input.slot,
          binding.input.resourceId,
          binding.input.kind,
          binding.requirement.required === true,
          ceiling.allowRead,
          ceiling.allowWrite,
          binding.input.allowRead,
          binding.input.allowWrite,
          request.nowMs,
        );
      }

      const activated = await (await this.database.prepare(`
        UPDATE agent_previews
        SET status = 'ready', active_revision_id = ?, pending_build_id = NULL,
          last_error_json = NULL, updated_at_ms = ?
        WHERE org_id = ? AND account_id = ? AND id = ?
          AND status = 'building' AND build_sequence = ?
          AND binding_revision = ? AND binding_plan_digest_sha256 = ?
          AND source_digest_sha256 = ? AND committed_mutation_id = ?
          AND active_revision_id IS ?
      `)).run(
        revision.id,
        request.nowMs,
        tenant.orgId,
        tenant.accountId,
        revision.previewId,
        request.expectedBuildSequence,
        revision.bindingRevision,
        revision.bindingPlanDigestSha256,
        revision.sourceDigestSha256,
        revision.committedMutationId,
        request.expectedActiveRevisionId,
      );
      if (activated.changes !== 1) {
        throw authoringError(
          'WIDGET_PREVIEW_CONFLICT',
          'Preview owner changed before revision activation.',
        );
      }
      await this.#deleteExpiredPreviewMountLeases(tenant.orgId, request.nowMs);
      await this.#prunePreviewRevisions(
        tenant.orgId,
        request.nowMs,
        revision.previewId,
      );
      const committed = await this.getPreviewRevision(tenant, {
        previewId: revision.previewId,
        revisionId: revision.id,
      });
      if (committed === null) {
        throw authoringError(
          'WIDGET_PREVIEW_COMMIT_FAILED',
          'Committed Preview revision could not be read back.',
        );
      }
      return {
        status: 'committed',
        revision: committed,
        previousActiveRevisionId: request.expectedActiveRevisionId,
      };
    });
  }

  async getPreview(
    tenant: TTenantContext,
    request: TWidgetPreviewGetRequest,
  ): Promise<TWidgetPreviewRevisionDescriptor | null> {
    const row = await (await this.database.prepare(`
      ${this.#previewRevisionSelect()}
      WHERE revision.org_id = ? AND preview.account_id = ?
        AND preview.id = ? AND preview.active_revision_id = revision.id
        AND preview.status <> 'closed'
    `)).get(tenant.orgId, tenant.accountId, request.previewId);
    return row ? this.#previewRevision(row) : null;
  }

  async getPreviewRevision(
    tenant: TTenantContext,
    request: TWidgetPreviewRevisionGetRequest,
  ): Promise<TWidgetPreviewRevisionDescriptor | null> {
    const row = await (await this.database.prepare(`
      ${this.#previewRevisionSelect()}
      WHERE revision.org_id = ? AND preview.account_id = ?
        AND revision.preview_id = ? AND revision.id = ?
    `)).get(
      tenant.orgId,
      tenant.accountId,
      request.previewId,
      request.revisionId,
    );
    return row ? this.#previewRevision(row) : null;
  }

  async hasRetainedPreviewInvocation(
    tenant: TTenantContext,
    request: Readonly<{
      invocationId: string;
      previewId: string;
      previewRevisionId: string;
      canvasId: string;
      definitionId: string;
    }>,
  ): Promise<boolean> {
    this.#boundedText(request.invocationId, 300, 'function invocation ID');
    const row = await (await this.database.prepare(`
      SELECT 1
      FROM function_invocations
      WHERE org_id = ? AND account_id = ? AND id = ?
        AND subject_kind = 'widget_preview'
        AND canvas_id = ?
        AND widget_instance_id = ?
        AND widget_revision_id = ?
        AND widget_definition_id = ?
        AND retains_revision = 1
      LIMIT 1
    `)).get(
      tenant.orgId,
      tenant.accountId,
      request.invocationId,
      request.canvasId,
      request.previewId,
      request.previewRevisionId,
      request.definitionId,
    );
    return row !== undefined;
  }

  async acquirePreviewMountLease(
    tenant: TTenantContext,
    request: TWidgetPreviewMountLeaseAcquireRequest,
  ): Promise<TWidgetPreviewMountLeaseDescriptor | null> {
    const expiresAtMs = this.#previewMountLeaseExpiry(request.nowMs, request.ttlMs);
    this.#validatedPreviewMountLeaseIdentity(request);
    return this.#runArtifactMutation(tenant, async () => {
      await this.#deleteExpiredPreviewMountLeases(tenant.orgId, request.nowMs);
      const owner = await (await this.database.prepare(`
        SELECT 1
        FROM agent_previews AS preview
        JOIN agent_preview_revisions AS revision
          ON revision.org_id = preview.org_id
         AND revision.preview_id = preview.id
         AND revision.id = ?
        WHERE preview.org_id = ? AND preview.account_id = ?
          AND preview.id = ? AND preview.canvas_id = ?
          AND preview.frame_node_id = ? AND preview.status <> 'closed'
          AND preview.active_revision_id = revision.id
        LIMIT 1
      `)).get(
        request.previewRevisionId,
        tenant.orgId,
        tenant.accountId,
        request.previewId,
        request.canvasId,
        request.frameNodeId,
      );
      if (!owner) return null;

      await (await this.database.prepare(`
        INSERT INTO agent_preview_mount_leases (
          org_id, id, account_id, preview_id, preview_revision_id,
          canvas_id, frame_node_id, acquired_at_ms, renewed_at_ms, expires_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (org_id, id) DO NOTHING
      `)).run(
        tenant.orgId,
        request.leaseId,
        tenant.accountId,
        request.previewId,
        request.previewRevisionId,
        request.canvasId,
        request.frameNodeId,
        request.nowMs,
        request.nowMs,
        expiresAtMs,
      );
      const row = await this.#getPreviewMountLeaseRow(
        tenant.orgId,
        tenant.accountId,
        request.leaseId,
      );
      return row && this.#previewMountLeaseIdentityMatches(row, request)
        ? this.#previewMountLease(row)
        : null;
    });
  }

  async renewPreviewMountLease(
    tenant: TTenantContext,
    request: TWidgetPreviewMountLeaseRenewRequest,
  ): Promise<TWidgetPreviewMountLeaseDescriptor | null> {
    const expiresAtMs = this.#previewMountLeaseExpiry(request.nowMs, request.ttlMs);
    this.#validatedPreviewMountLeaseIdentity(request);
    return this.#runArtifactMutation(tenant, async () => {
      await this.#deleteExpiredPreviewMountLeases(tenant.orgId, request.nowMs);
      const updated = await (await this.database.prepare(`
        UPDATE agent_preview_mount_leases AS lease
        SET renewed_at_ms = ?, expires_at_ms = ?
        WHERE lease.org_id = ? AND lease.account_id = ? AND lease.id = ?
          AND lease.preview_id = ? AND lease.preview_revision_id = ?
          AND lease.canvas_id = ? AND lease.frame_node_id = ?
          AND lease.expires_at_ms > ? AND lease.renewed_at_ms <= ?
          AND EXISTS (
            SELECT 1 FROM agent_previews AS preview
            WHERE preview.org_id = lease.org_id
              AND preview.id = lease.preview_id
              AND preview.account_id = lease.account_id
              AND preview.canvas_id = lease.canvas_id
              AND preview.frame_node_id = lease.frame_node_id
              AND preview.status <> 'closed'
          )
      `)).run(
        request.nowMs,
        expiresAtMs,
        tenant.orgId,
        tenant.accountId,
        request.leaseId,
        request.previewId,
        request.previewRevisionId,
        request.canvasId,
        request.frameNodeId,
        request.nowMs,
        request.nowMs,
      );
      if (updated.changes !== 1) {
        await this.#prunePreviewRevisions(
          tenant.orgId,
          request.nowMs,
          request.previewId,
        );
        return null;
      }
      const row = await this.#getPreviewMountLeaseRow(
        tenant.orgId,
        tenant.accountId,
        request.leaseId,
      );
      return row ? this.#previewMountLease(row) : null;
    });
  }

  async releasePreviewMountLease(
    tenant: TTenantContext,
    request: TWidgetPreviewMountLeaseReleaseRequest,
  ): Promise<boolean> {
    this.#timestamp(request.nowMs, 'Preview mount lease release timestamp');
    this.#validatedPreviewMountLeaseIdentity(request);
    return this.#runArtifactMutation(tenant, async () => {
      const released = await (await this.database.prepare(`
        DELETE FROM agent_preview_mount_leases
        WHERE org_id = ? AND account_id = ? AND id = ?
          AND preview_id = ? AND preview_revision_id = ?
          AND canvas_id = ? AND frame_node_id = ?
      `)).run(
        tenant.orgId,
        tenant.accountId,
        request.leaseId,
        request.previewId,
        request.previewRevisionId,
        request.canvasId,
        request.frameNodeId,
      );
      await this.#deleteExpiredPreviewMountLeases(tenant.orgId, request.nowMs);
      await this.#prunePreviewRevisions(
        tenant.orgId,
        request.nowMs,
        request.previewId,
      );
      return released.changes === 1;
    });
  }

  async hasConfirmedPreviewExecution(
    tenant: TTenantContext,
    request: Readonly<{
      draftId: string;
      draftRevisionSha256: string;
      nowMs: number;
    }>,
  ): Promise<boolean> {
    this.#boundedText(request.draftId, 300, 'Preview draft ID');
    this.#sha256Digest(request.draftRevisionSha256, 'Preview draft revision');
    this.#timestamp(request.nowMs, 'Preview execution lookup timestamp');
    const row = await (await this.database.prepare(`
      SELECT 1
      FROM agent_preview_mount_leases AS lease
      JOIN agent_previews AS preview
        ON preview.org_id = lease.org_id
       AND preview.id = lease.preview_id
      JOIN agent_preview_revisions AS revision
        ON revision.org_id = lease.org_id
       AND revision.preview_id = lease.preview_id
       AND revision.id = lease.preview_revision_id
      WHERE lease.org_id = ? AND lease.account_id = ?
        AND preview.draft_id = ?
        AND preview.status = 'ready'
        AND preview.active_revision_id = revision.id
        AND revision.draft_revision_sha256 = ?
        AND lease.renewed_at_ms > lease.acquired_at_ms
        AND lease.expires_at_ms > ?
      LIMIT 1
    `)).get(
      tenant.orgId,
      tenant.accountId,
      request.draftId,
      request.draftRevisionSha256,
      request.nowMs,
    );
    return row !== undefined;
  }

  async resolvePreviewArtifact(
    tenant: TTenantContext,
    request: TWidgetPreviewArtifactResolutionRequest,
  ): Promise<TWidgetArtifactDescriptor | null> {
    const revision = await this.getPreviewRevision(tenant, request);
    if (revision === null) return null;
    const artifact = request.kind === 'source'
      ? revision.sourceArtifact
      : request.kind === 'unsigned_ui'
        ? revision.unsignedUiArtifact
        : request.kind === 'ui'
          ? revision.uiArtifact
          : revision.serverArtifact;
    return artifact !== null
      && artifact.id === request.artifactId
      && artifact.kind === request.kind
      && artifact.digestSha256 === request.digestSha256
      ? artifact
      : null;
  }

  async getPreviewBindings(
    tenant: TTenantContext,
    request: TWidgetPreviewRevisionGetRequest,
  ): Promise<readonly TWidgetResourceBindingInput[]> {
    if (await this.getPreviewRevision(tenant, request) === null) return [];
    const rows = await (await this.database.prepare(`
      SELECT slot_name, resource_id, resource_kind, allow_read, allow_write
      FROM agent_preview_resource_bindings
      WHERE org_id = ? AND preview_id = ? AND revision_id = ?
      ORDER BY slot_name ASC
    `)).all(tenant.orgId, request.previewId, request.revisionId);
    return Object.freeze(rows.map((row) => {
      const value = row as Record<string, unknown>;
      return Object.freeze({
        slot: String(value.slot_name),
        resourceId: String(value.resource_id),
        kind: value.resource_kind as TWidgetResourceBindingInput['kind'],
        allowRead: value.allow_read === 1 || value.allow_read === true,
        allowWrite: value.allow_write === 1 || value.allow_write === true,
      });
    }));
  }

  #validatedPreviewRevision(
    revision: TWidgetPreviewCommitInput['revision'],
  ): Readonly<{
    manifest: ReturnType<typeof ZWidgetManifestV3.parse>;
    canonicalManifestJson: string;
    functionDescriptorsJson: string;
    capsuleBuildIdentityJson: string;
    distributionProvenanceJson: string;
    uiRuntimeJson: string;
    diagnosticsJson: string;
  }> {
    try {
      this.#boundedText(
        revision.committedMutationId,
        1_024,
        'Preview committed mutation ID',
      );
      const manifest = ZWidgetManifestV3.parse(revision.manifest);
      const canonicalManifestJson = fnCanonicalizeWidgetManifest(manifest);
      if (canonicalManifestJson !== revision.canonicalManifestJson) {
        throw new Error('manifest is not canonical');
      }
      const functionDescriptors = ZWidgetServerFunctionDescriptors.parse(
        revision.functionDescriptors,
      );
      const functionValidation = fnValidateWidgetServerFunctionDescriptors(
        manifest,
        functionDescriptors,
      );
      const functionDescriptorsJson =
        fnCanonicalizeWidgetServerFunctionDescriptors(functionDescriptors);
      if (
        !functionValidation.valid
        || this.#digest(functionDescriptorsJson)
          !== revision.functionDescriptorsDigestSha256
      ) {
        throw new Error('function descriptors differ');
      }
      const uiRuntime = ZWidgetCapsuleRuntimeDescriptor.parse(revision.uiRuntime);
      const uiRuntimeJson = fnCanonicalizeWidgetCapsuleRuntimeDescriptor(uiRuntime);
      if (
        uiRuntime.capsuleArtifactHash
          !== revision.uiRuntime.capsuleArtifactHash
        || uiRuntime.signatureKeyIds.length < 1
        || this.#digest(fnCanonicalizeWidgetCapsuleCapabilityRequests(
          uiRuntime.capabilityRequests,
        )) !== revision.capabilityContractDigestSha256
        || this.#digest(fnCanonicalizeWidgetCapsuleChannelContract(
          uiRuntime.channels,
        )) !== revision.channelContractDigestSha256
      ) {
        throw new Error('runtime contract differs');
      }
      const capsuleBuildIdentity =
        revision.capsuleBuildIdentity as TWidgetCapsuleBuildIdentity;
      if (
        capsuleBuildIdentity.packageName !== '@omnidraw/capsule'
        || !capsuleBuildIdentity.packageVersion.trim()
        || !capsuleBuildIdentity.buildApiVersion.trim()
        || !capsuleBuildIdentity.packageDigest.startsWith('sha256:')
        || !capsuleBuildIdentity.runtimeBuildDigest.startsWith('sha256:')
      ) throw new Error('Capsule build identity is invalid');
      const capsuleBuildIdentityJson = JSON.stringify({
        packageName: '@omnidraw/capsule',
        packageVersion: capsuleBuildIdentity.packageVersion,
        packageDigest: capsuleBuildIdentity.packageDigest,
        buildApiVersion: capsuleBuildIdentity.buildApiVersion,
        runtimeBuildDigest: capsuleBuildIdentity.runtimeBuildDigest,
      });
      const provenance =
        revision.distributionProvenance as TWidgetDistributionBuildProvenance;
      if (
        provenance.kind !== 'external-distribution'
        || provenance.sourceRevision !== revision.sourceDigestSha256
        || !provenance.producer.name.trim()
        || !provenance.producer.version.trim()
        || !provenance.producer.digest.startsWith('sha256:')
        || !provenance.dependencyLockDigest.startsWith('sha256:')
        || !provenance.buildConfigurationDigest.startsWith('sha256:')
      ) throw new Error('distribution provenance is invalid');
      const distributionProvenanceJson = JSON.stringify({
        kind: 'external-distribution',
        producer: {
          name: provenance.producer.name,
          version: provenance.producer.version,
          digest: provenance.producer.digest,
        },
        sourceRevision: provenance.sourceRevision,
        dependencyLockDigest: provenance.dependencyLockDigest,
        buildConfigurationDigest: provenance.buildConfigurationDigest,
      });
      const diagnostics = revision.diagnostics.map((item) =>
        ZWidgetDiagnostic.parse(item));
      if (diagnostics.some((item) => (
        item.previewRevisionId !== revision.id
        || item.draftRevision !== revision.draftRevisionSha256
        || item.buildSequence !== revision.buildSequence
      ))) throw new Error('diagnostic ownership differs');
      const diagnosticsJson = JSON.stringify(diagnostics);
      if (
        revision.sourceArtifact.kind !== 'source'
        || revision.unsignedUiArtifact.kind !== 'unsigned_ui'
        || revision.uiArtifact.kind !== 'ui'
        || (
          revision.serverArtifact !== null
          && revision.serverArtifact.kind !== 'server'
        )
        || (manifest.server === undefined) !== (revision.serverArtifact === null)
        || (manifest.server === undefined) !== (revision.serverRuntimeAbi === null)
        || (
          manifest.server !== undefined
          && manifest.server.runtimeAbi !== revision.serverRuntimeAbi
        )
      ) throw new Error('artifact kinds differ');
      const constructionDigest = this.#digest(
        fnCanonicalizeWidgetConstructionContractPayload({
          sourceSnapshotId: revision.sourceSnapshotId,
          sourceDigestSha256: revision.sourceDigestSha256,
          sourceArtifactDigestSha256: revision.sourceArtifact.digestSha256,
          canonicalManifestJson,
          unsignedUiDigestSha256: revision.unsignedUiArtifact.digestSha256,
          capsuleArtifactHash: uiRuntime.capsuleArtifactHash,
          apiContract: uiRuntime.apiContract,
          budgets: uiRuntime.budgets,
          capabilityContractDigestSha256:
            revision.capabilityContractDigestSha256,
          channelContractDigestSha256: revision.channelContractDigestSha256,
          serverDigestSha256: revision.serverArtifact?.digestSha256 ?? null,
          serverRuntimeAbi: revision.serverRuntimeAbi,
          functionDescriptorsDigestSha256:
            revision.functionDescriptorsDigestSha256,
          builderIdentity: revision.builderIdentity,
          capsuleBuildIdentity,
          buildPolicyId: revision.buildPolicyId,
          distributionProvenance: provenance,
        }),
      );
      const previewDigest = this.#digest(fnCanonicalizeWidgetContractPayload({
        canonicalManifestJson,
        uiDigestSha256: revision.uiArtifact.digestSha256,
        capsuleArtifactHash: uiRuntime.capsuleArtifactHash,
        apiContract: uiRuntime.apiContract,
        budgets: uiRuntime.budgets,
        capabilityContractDigestSha256: revision.capabilityContractDigestSha256,
        channelContractDigestSha256: revision.channelContractDigestSha256,
        signatureKeyIds: uiRuntime.signatureKeyIds,
        serverDigestSha256: revision.serverArtifact?.digestSha256 ?? null,
        serverRuntimeAbi: revision.serverRuntimeAbi,
        functionDescriptorsDigestSha256:
          revision.functionDescriptorsDigestSha256,
        sourceDigestSha256: revision.sourceDigestSha256,
        builderIdentity: revision.builderIdentity,
        capsuleBuildIdentity,
        buildPolicyId: revision.buildPolicyId,
      }));
      if (
        constructionDigest !== revision.constructionContractDigestSha256
        || previewDigest !== revision.previewContractDigestSha256
        || !/^[0-9a-f]{64}$/.test(revision.bindingPlanDigestSha256)
      ) throw new Error('revision contract digest differs');
      this.#boundedText(revision.id, 300, 'Preview revision ID');
      this.#boundedText(revision.previewId, 300, 'Preview owner ID');
      this.#boundedText(revision.sourceSnapshotId, 300, 'Preview source snapshot ID');
      this.#boundedText(revision.builderIdentity, 300, 'Preview builder identity');
      this.#boundedText(revision.buildPolicyId, 300, 'Preview build policy ID');
      return {
        manifest,
        canonicalManifestJson,
        functionDescriptorsJson,
        capsuleBuildIdentityJson,
        distributionProvenanceJson,
        uiRuntimeJson,
        diagnosticsJson,
      };
    } catch (cause) {
      if (
        cause !== null
        && typeof cause === 'object'
        && 'code' in cause
        && cause.code === 'AGENT_AUTHORING_INTEGRITY_FAILED'
      ) throw cause;
      throw authoringError(
        'WIDGET_PREVIEW_INTEGRITY_FAILED',
        'Preview revision failed its durable integrity contract.',
      );
    }
  }

  async #validatedPreviewBindings(
    tenant: TTenantContext,
    manifest: ReturnType<typeof ZWidgetManifestV3.parse>,
    inputs: readonly TWidgetResourceBindingInput[],
  ): Promise<readonly TValidatedPreviewBinding[]> {
    const validation = fnValidateWidgetResourceBindings(manifest, inputs);
    if (!validation.valid) {
      throw authoringError(
        'WIDGET_PREVIEW_BINDINGS_INVALID',
        `Preview resource bindings are invalid: ${validation.reason}.`,
      );
    }
    const requirements = new Map(
      (manifest.resources ?? []).map((item) => [item.slot, item]),
    );
    const bindings: TValidatedPreviewBinding[] = [];
    for (const input of inputs) {
      const requirement = requirements.get(input.slot);
      if (requirement === undefined) {
        throw authoringError(
          'WIDGET_PREVIEW_BINDINGS_INVALID',
          'Preview binding has no matching manifest requirement.',
        );
      }
      const resource = await (await this.database.prepare(`
        SELECT 1
        FROM resource_catalog
        WHERE org_id = ? AND id = ? AND kind = ? AND status = 'ready'
      `)).get(tenant.orgId, input.resourceId, input.kind);
      if (!resource) {
        throw authoringError(
          'WIDGET_PREVIEW_RESOURCE_NOT_FOUND',
          `Preview resource '${input.slot}' is unavailable.`,
        );
      }
      bindings.push(Object.freeze({ input, requirement }));
    }
    return Object.freeze(bindings);
  }

  async #pinPreviewArtifact(
    tenant: TTenantContext,
    artifact: TWidgetArtifactDescriptor,
    kind: TWidgetPreviewArtifactResolutionRequest['kind'],
  ): Promise<TWidgetArtifactDescriptor> {
    if (
      artifact.orgId !== tenant.orgId
      || artifact.kind !== kind
      || artifact.retentionState !== 'pinned'
      || artifact.retainUntilMs !== null
      || artifact.byteSize < 1
      || artifact.createdAtMs < 0
    ) {
      throw authoringError(
        'WIDGET_PREVIEW_ARTIFACT_INVALID',
        `Preview ${kind} artifact metadata is invalid.`,
      );
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
      artifact.kind,
      artifact.digestSha256,
      artifact.byteSize,
      artifact.createdAtMs,
    );
    const row = await (await this.database.prepare(`
      SELECT *
      FROM artifact_references
      WHERE org_id = ? AND kind = ? AND digest_sha256 = ?
    `)).get(tenant.orgId, kind, artifact.digestSha256);
    if (!row) {
      throw authoringError(
        'WIDGET_PREVIEW_ARTIFACT_INVALID',
        `Preview ${kind} artifact could not be retained.`,
      );
    }
    const stored = fnWidgetControlStoreArtifact(
      row as Parameters<typeof fnWidgetControlStoreArtifact>[0],
    );
    if (
      stored.byteSize !== artifact.byteSize
      || stored.retentionState === 'deleting'
    ) {
      throw authoringError(
        'WIDGET_PREVIEW_ARTIFACT_CONFLICT',
        `Preview ${kind} artifact conflicts with retained metadata.`,
      );
    }
    if (stored.retentionState !== 'pinned' || stored.retainUntilMs !== null) {
      await (await this.database.prepare(`
        UPDATE artifact_references
        SET retention_state = 'pinned', retain_until_ms = NULL
        WHERE org_id = ? AND id = ? AND kind = ?
          AND digest_sha256 = ? AND retention_state <> 'deleting'
      `)).run(
        tenant.orgId,
        stored.id,
        stored.kind,
        stored.digestSha256,
      );
      return Object.freeze({
        ...stored,
        retentionState: 'pinned' as const,
        retainUntilMs: null,
      });
    }
    return stored;
  }

  #previewRevision(row: unknown): TWidgetPreviewRevisionDescriptor {
    const value = row as Record<string, unknown>;
    try {
      const manifest = ZWidgetManifestV3.parse(this.#parsedJson(value.manifest_json));
      const descriptorsPayload = this.#parsedJson(value.function_descriptors_json) as {
        functions?: unknown;
      };
      const functionDescriptors = ZWidgetServerFunctionDescriptors.parse(
        descriptorsPayload.functions,
      );
      const diagnosticsPayload = this.#parsedJson(value.diagnostics_json);
      if (!Array.isArray(diagnosticsPayload)) throw new Error('diagnostics are not an array');
      const revision: TWidgetPreviewRevisionDescriptor = {
        orgId: String(value.org_id),
        id: String(value.id),
        previewId: String(value.preview_id),
        draftId: String(value.draft_id),
        definitionId: String(value.definition_id),
        draftRevisionSha256: String(value.draft_revision_sha256),
        committedMutationId: String(value.committed_mutation_id),
        sourceSnapshotId: String(value.source_snapshot_id),
        sourceDigestSha256: String(value.source_digest_sha256),
        sourceArtifact: this.#previewArtifact(value, 'source'),
        manifest,
        canonicalManifestJson: String(value.manifest_json),
        functionDescriptors,
        functionDescriptorsDigestSha256:
          String(value.function_descriptors_digest_sha256),
        capabilityContractDigestSha256:
          String(value.capability_contract_digest_sha256),
        channelContractDigestSha256:
          String(value.channel_contract_digest_sha256),
        constructionContractDigestSha256:
          String(value.construction_contract_digest_sha256),
        previewContractDigestSha256:
          String(value.preview_contract_digest_sha256),
        builderIdentity: String(value.builder_identity),
        capsuleBuildIdentity:
          this.#parsedJson(value.capsule_build_identity_json) as TWidgetCapsuleBuildIdentity,
        buildPolicyId: String(value.build_policy_id),
        distributionProvenance: this.#parsedJson(
          value.distribution_provenance_json,
        ) as TWidgetDistributionBuildProvenance,
        unsignedUiArtifact: this.#previewArtifact(value, 'unsigned_ui'),
        uiArtifact: this.#previewArtifact(value, 'ui'),
        uiRuntime: ZWidgetCapsuleRuntimeDescriptor.parse(
          this.#parsedJson(value.ui_runtime_json),
        ),
        serverArtifact: value.server_ref_id === null
          || value.server_ref_id === undefined
          ? null
          : this.#previewArtifact(value, 'server'),
        serverRuntimeAbi: value.server_runtime_abi === null
          ? null
          : String(value.server_runtime_abi),
        bindingRevision: storedInteger(
          value.binding_revision,
          'Preview binding revision',
        ),
        bindingPlanDigestSha256: String(value.binding_plan_digest_sha256),
        buildSequence: storedInteger(value.build_sequence, 'Preview build sequence'),
        diagnostics: Object.freeze(
          diagnosticsPayload.map((item) => ZWidgetDiagnostic.parse(item)),
        ),
        createdAtMs: storedInteger(
          value.created_at_ms,
          'Preview revision creation timestamp',
        ),
      };
      this.#validatedPreviewRevision(revision);
      return Object.freeze(revision);
    } catch {
      throw authoringError(
        'WIDGET_PREVIEW_INTEGRITY_FAILED',
        'Stored Preview revision failed integrity verification.',
      );
    }
  }

  #previewArtifact(
    row: Record<string, unknown>,
    alias: TPreviewArtifactAlias,
  ): TWidgetArtifactDescriptor {
    return fnWidgetControlStoreArtifact({
      org_id: String(row.org_id),
      id: String(row[`${alias}_ref_id`]),
      kind: row[`${alias}_ref_kind`] as TWidgetArtifactKind,
      digest_sha256: String(row[`${alias}_ref_digest_sha256`]),
      byte_size: row[`${alias}_ref_byte_size`],
      retention_state: (
        row[`${alias}_ref_retention_state`]
      ) as TWidgetArtifactDescriptor['retentionState'],
      retain_until_ms: row[`${alias}_ref_retain_until_ms`],
      created_at_ms: row[`${alias}_ref_created_at_ms`],
    });
  }

  #previewRevisionSelect(): string {
    return `
      SELECT
        revision.*,
        source.id AS source_ref_id,
        source.kind AS source_ref_kind,
        source.digest_sha256 AS source_ref_digest_sha256,
        source.byte_size AS source_ref_byte_size,
        source.retention_state AS source_ref_retention_state,
        source.retain_until_ms AS source_ref_retain_until_ms,
        source.created_at_ms AS source_ref_created_at_ms,
        unsigned_ui.id AS unsigned_ui_ref_id,
        unsigned_ui.kind AS unsigned_ui_ref_kind,
        unsigned_ui.digest_sha256 AS unsigned_ui_ref_digest_sha256,
        unsigned_ui.byte_size AS unsigned_ui_ref_byte_size,
        unsigned_ui.retention_state AS unsigned_ui_ref_retention_state,
        unsigned_ui.retain_until_ms AS unsigned_ui_ref_retain_until_ms,
        unsigned_ui.created_at_ms AS unsigned_ui_ref_created_at_ms,
        ui.id AS ui_ref_id,
        ui.kind AS ui_ref_kind,
        ui.digest_sha256 AS ui_ref_digest_sha256,
        ui.byte_size AS ui_ref_byte_size,
        ui.retention_state AS ui_ref_retention_state,
        ui.retain_until_ms AS ui_ref_retain_until_ms,
        ui.created_at_ms AS ui_ref_created_at_ms,
        server.id AS server_ref_id,
        server.kind AS server_ref_kind,
        server.digest_sha256 AS server_ref_digest_sha256,
        server.byte_size AS server_ref_byte_size,
        server.retention_state AS server_ref_retention_state,
        server.retain_until_ms AS server_ref_retain_until_ms,
        server.created_at_ms AS server_ref_created_at_ms
      FROM agent_preview_revisions AS revision
      JOIN agent_previews AS preview
        ON preview.org_id = revision.org_id AND preview.id = revision.preview_id
      JOIN artifact_references AS source
        ON source.org_id = revision.org_id
       AND source.id = revision.source_artifact_id
       AND source.kind = revision.source_artifact_kind
      JOIN artifact_references AS unsigned_ui
        ON unsigned_ui.org_id = revision.org_id
       AND unsigned_ui.id = revision.unsigned_ui_artifact_id
       AND unsigned_ui.kind = revision.unsigned_ui_artifact_kind
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

  #parsedJson(value: unknown): unknown {
    return typeof value === 'string' ? JSON.parse(value) : value;
  }

  #digest(value: string): string {
    return createHash('sha256').update(value).digest('hex');
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
      committedMutationId: value.committed_mutation_id === null
        ? null
        : String(value.committed_mutation_id),
      buildSequence: storedInteger(value.build_sequence, 'draft build sequence'),
      lastError: parsedObject(value.last_error_json),
      createdAtMs: storedInteger(value.created_at_ms, 'draft creation timestamp'),
      updatedAtMs: storedInteger(value.updated_at_ms, 'draft update timestamp'),
    };
  }

  #previewOwner(row: unknown): TWidgetPreviewOwnerDescriptor {
    const value = row as Record<string, unknown>;
    const status = String(value.status) as TWidgetPreviewOwnerDescriptor['status'];
    const role = String(value.role) as TWidgetPreviewOwnerDescriptor['role'];
    if (
      !['queued', 'building', 'ready', 'failed', 'closed'].includes(status)
      || (role !== 'companion' && role !== 'placed')
    ) {
      throw authoringError(
        'AGENT_AUTHORING_INTEGRITY_FAILED',
        'Stored Preview owner role or status is invalid.',
      );
    }
    return {
      orgId: String(value.org_id),
      id: String(value.id),
      accountId: String(value.account_id),
      canvasId: String(value.canvas_id),
      frameNodeId: String(value.frame_node_id),
      draftId: String(value.draft_id),
      originChatId: String(value.origin_chat_id),
      role,
      status,
      activeRevisionId: value.active_revision_id === null
        ? null
        : String(value.active_revision_id),
      pendingBuildId: value.pending_build_id === null
        ? null
        : String(value.pending_build_id),
      buildSequence: storedInteger(value.build_sequence, 'Preview build sequence'),
      bindingRevision: storedInteger(value.binding_revision, 'Preview binding revision'),
      bindingPlanDigestSha256: value.binding_plan_digest_sha256 === null
        ? null
        : String(value.binding_plan_digest_sha256),
      sourceDigestSha256: value.source_digest_sha256 === null
        ? null
        : String(value.source_digest_sha256),
      committedMutationId: value.committed_mutation_id === null
        ? null
        : String(value.committed_mutation_id),
      runtimeDiagnostics: parsedRuntimeDiagnostics(value.runtime_diagnostics_json),
      publishedPreviewRevisionId: value.published_preview_revision_id === null
        ? null
        : String(value.published_preview_revision_id),
      publishedBindingRevision: value.published_binding_revision === null
        ? null
        : storedInteger(
            value.published_binding_revision,
            'published Preview binding revision',
          ),
      publishedBindingPlanDigestSha256:
        value.published_binding_plan_digest_sha256 === null
          ? null
          : String(value.published_binding_plan_digest_sha256),
      publishedWidgetRevisionId: value.published_widget_revision_id === null
        ? null
        : String(value.published_widget_revision_id),
      publishedIdempotencyKey: value.published_idempotency_key === null
        ? null
        : String(value.published_idempotency_key),
      lastError: parsedObject(value.last_error_json),
      createdAtMs: storedInteger(value.created_at_ms, 'Preview creation timestamp'),
      updatedAtMs: storedInteger(value.updated_at_ms, 'Preview update timestamp'),
      closedAtMs: value.closed_at_ms === null
        ? null
        : storedInteger(value.closed_at_ms, 'Preview close timestamp'),
    };
  }

  async #getPreviewCompanion(
    tenant: TTenantContext,
    draftId: string,
    originChatId: string,
  ): Promise<TWidgetPreviewOwnerDescriptor | null> {
    const row = await (await this.database.prepare(`
      SELECT *
      FROM agent_previews
      WHERE org_id = ? AND account_id = ?
        AND draft_id = ? AND origin_chat_id = ?
        AND role = 'companion' AND status <> 'closed'
      LIMIT 1
    `)).get(tenant.orgId, tenant.accountId, draftId, originChatId);
    return row ? this.#previewOwner(row) : null;
  }

  async #getPreviewMountLeaseRow(
    orgId: string,
    accountId: string,
    leaseId: string,
  ): Promise<Record<string, unknown> | null> {
    const row = await (await this.database.prepare(`
      SELECT *
      FROM agent_preview_mount_leases
      WHERE org_id = ? AND account_id = ? AND id = ?
    `)).get(orgId, accountId, leaseId);
    return row ? row as Record<string, unknown> : null;
  }

  #previewMountLease(
    row: Record<string, unknown>,
  ): TWidgetPreviewMountLeaseDescriptor {
    return Object.freeze({
      leaseId: String(row.id),
      previewId: String(row.preview_id),
      previewRevisionId: String(row.preview_revision_id),
      canvasId: String(row.canvas_id),
      frameNodeId: String(row.frame_node_id),
      acquiredAtMs: storedInteger(row.acquired_at_ms, 'Preview mount acquisition timestamp'),
      renewedAtMs: storedInteger(row.renewed_at_ms, 'Preview mount renewal timestamp'),
      expiresAtMs: storedInteger(row.expires_at_ms, 'Preview mount expiry timestamp'),
    });
  }

  #previewMountLeaseIdentityMatches(
    row: Record<string, unknown>,
    request: Readonly<{
      leaseId: string;
      previewId: string;
      previewRevisionId: string;
      canvasId: string;
      frameNodeId: string;
    }>,
  ): boolean {
    return String(row.id) === request.leaseId
      && String(row.preview_id) === request.previewId
      && String(row.preview_revision_id) === request.previewRevisionId
      && String(row.canvas_id) === request.canvasId
      && String(row.frame_node_id) === request.frameNodeId;
  }

  #validatedPreviewMountLeaseIdentity(request: Readonly<{
    leaseId: string;
    previewId: string;
    previewRevisionId: string;
    canvasId: string;
    frameNodeId: string;
  }>): void {
    this.#boundedText(request.leaseId, 300, 'Preview mount lease ID');
    this.#boundedText(request.previewId, 300, 'Preview owner ID');
    this.#boundedText(request.previewRevisionId, 300, 'Preview revision ID');
    this.#boundedText(request.canvasId, 300, 'Preview canvas ID');
    this.#boundedText(request.frameNodeId, 300, 'Preview frame node ID');
  }

  #previewMountLeaseExpiry(nowMs: number, ttlMs: number): number {
    this.#timestamp(nowMs, 'Preview mount lease timestamp');
    if (
      !Number.isSafeInteger(ttlMs)
      || ttlMs < WIDGET_PREVIEW_MOUNT_LEASE_MIN_TTL_MS
      || ttlMs > WIDGET_PREVIEW_MOUNT_LEASE_MAX_TTL_MS
    ) {
      throw new TypeError('Preview mount lease TTL is outside the safe bound.');
    }
    return this.#timestamp(nowMs + ttlMs, 'Preview mount lease expiry timestamp');
  }

  async #deleteExpiredPreviewMountLeases(
    orgId: string,
    nowMs: number,
  ): Promise<number> {
    const result = await (await this.database.prepare(`
      DELETE FROM agent_preview_mount_leases
      WHERE org_id = ? AND expires_at_ms <= ?
    `)).run(orgId, nowMs);
    return Number(result.changes);
  }

  async #prunePreviewRevisions(
    orgId: string,
    nowMs: number,
    previewId?: string,
  ): Promise<number> {
    const result = await (await this.database.prepare(`
      DELETE FROM agent_preview_revisions AS revision
      WHERE revision.org_id = ?
        AND (? IS NULL OR revision.preview_id = ?)
        AND EXISTS (
          SELECT 1 FROM agent_previews AS owner
          WHERE owner.org_id = revision.org_id
            AND owner.id = revision.preview_id
            AND (
              owner.status = 'closed'
              OR owner.active_revision_id IS NULL
              OR owner.active_revision_id <> revision.id
            )
        )
        AND NOT EXISTS (
          SELECT 1 FROM agent_preview_mount_leases AS lease
          WHERE lease.org_id = revision.org_id
            AND lease.preview_id = revision.preview_id
            AND lease.preview_revision_id = revision.id
            AND lease.expires_at_ms > ?
        )
        AND NOT EXISTS (
          SELECT 1 FROM function_invocations AS invocation
          WHERE invocation.org_id = revision.org_id
            AND invocation.subject_kind = 'widget_preview'
            AND invocation.widget_instance_id = revision.preview_id
            AND invocation.widget_revision_id = revision.id
            AND invocation.retains_revision = 1
        )
        AND NOT EXISTS (
          SELECT 1
          FROM agent_previews AS diagnostic_owner,
            json_each(diagnostic_owner.runtime_diagnostics_json) AS diagnostic
          WHERE diagnostic_owner.org_id = revision.org_id
            AND diagnostic_owner.id = revision.preview_id
            AND diagnostic_owner.status <> 'closed'
            AND json_extract(
              diagnostic.value,
              '$.diagnostic.previewRevisionId'
            ) = revision.id
        )
    `)).run(orgId, previewId ?? null, previewId ?? null, nowMs);
    return Number(result.changes);
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
