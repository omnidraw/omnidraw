import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  ZWidgetBrowserFunctionDescriptors,
  ZWidgetCapsuleRuntimeDescriptor,
  ZWidgetDiagnostic,
  ZWidgetManifestV3,
  ZWidgetServerFunctionDescriptors,
  fnCanonicalizeWidgetBrowserFunctionDescriptors,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnNormalizeWidgetBuildError,
  fnProjectWidgetBrowserFunctionDescriptors,
  fnValidateWidgetServerFunctionDescriptors,
  fnWidgetPreviewBindingPlanDigest,
  fnWidgetServerFunctionCapabilityRequestMatches,
  type TWidgetCapsuleBuildIdentity,
  type TWidgetCapsuleRuntimeDescriptor,
  type TWidgetDiagnostic,
  type TWidgetManifestV3,
  type TWidgetPreviewBuildResult,
  type TWidgetPreviewMountLeaseDescriptor,
  type TWidgetSourceSnapshot,
} from '@vibecanvas/widget-contract';
import type { ITenantEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { txValidateWidgetFiles } from '../core/tx.validate-widget-files';
import type { TValidationResult } from '../core/types';
import type { TWidgetDraftChange } from '../tools/types';
import type { WidgetWorkspace } from '../workspace/WidgetWorkspace';
import type { TWidgetDraftWorkspaceEntry } from '../workspace/types';
import type {
  IAgentAuthoringStore,
  TAgentAuthoringDraftDescriptor,
  TWidgetAuthoringCapability,
  TWidgetDraftSummary,
  TWidgetPreviewCatalogState,
  TWidgetPreviewFailureReason,
  TWidgetPreviewOwnerDescriptor,
  TWidgetPreviewOwnerRole,
  TWidgetPreviewPublishSelection,
  TWidgetPreviewReady,
  TWidgetPreviewResult,
  TWidgetPreviewRuntimeDiagnosticRecord,
  TWidgetPublishResult,
  TWidgetResourceBindingResolver,
} from './types';
import {
  PreviewBuildCoordinator,
  type TPreviewBuildProgressPhase,
} from './PreviewBuildCoordinator';
import {
  PreviewBuildAdmission,
  type IPreviewBuildAdmission,
} from './PreviewBuildAdmission';

const WIDGET_UI_ARTIFACT_MAX_BYTES = 16 * 1_024 * 1_024;
const WIDGET_PREVIEW_MOUNT_LEASE_TTL_MS = 60_000;
const WIDGET_PREVIEW_DIAGNOSTIC_MAX_COUNT = 20;
const WIDGET_PREVIEW_DIAGNOSTIC_MAX_BYTES = 64 * 1_024;
const WIDGET_PREVIEW_DIAGNOSTIC_RATE_WINDOW_MS = 10_000;
const WIDGET_PREVIEW_DIAGNOSTIC_RATE_MAX_REPORTS = 32;

type TValidationCacheEntry = TValidationResult & { revision: string };

type TCapturedDraft = Readonly<{
  workspace: TWidgetDraftWorkspaceEntry;
  rootPath: string;
  snapshot: TWidgetSourceSnapshot;
}>;

export type TWidgetDraftControllerConfig = Readonly<{
  tenant: TTenantContext;
  workspace: WidgetWorkspace;
  eventPublisher: ITenantEventPublisherService;
  authoringStore: IAgentAuthoringStore;
  widgets: TWidgetAuthoringCapability;
  resolveResourceBindings: TWidgetResourceBindingResolver;
  createId: () => string;
  nowMs: () => number;
  builderIdentity: string;
  capsuleBuildIdentity: TWidgetCapsuleBuildIdentity;
  buildPolicyId: string;
  previewBuildDebounceMs?: number;
  previewBuildAdmission?: IPreviewBuildAdmission;
}>;

function controllerError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function errorCode(error: unknown): string {
  return error !== null && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCurrentRevision(error: unknown): string | null {
  if (error === null || typeof error !== 'object' || !('currentRevision' in error)) return null;
  const currentRevision = error.currentRevision;
  return typeof currentRevision === 'string' ? currentRevision : null;
}

/** Durable draft, full-stack Preview, diagnostic, and publication orchestration. */
export class WidgetDraftController {
  readonly #config: TWidgetDraftControllerConfig;
  readonly #validationByDraft = new Map<string, TValidationCacheEntry>();
  readonly #operations = new Map<string, Promise<unknown>>();
  readonly #previewBuilds: PreviewBuildCoordinator<TWidgetPreviewResult>;
  readonly #previewBuildAdmission: IPreviewBuildAdmission;
  readonly #previewBuildTenantKey: string;
  readonly #previewDiagnosticRateByOwner = new Map<string, {
    count: number;
    windowStartedAtMs: number;
  }>();
  readonly #previewBuildKeysByDraft = new Map<string, Set<string>>();
  readonly #previewBuildFencesByOwner = new Map<string, Readonly<{
    buildId: string;
    ownerBuildSequence: number;
    coordinatorBuildSequence: number;
  }>>();
  #closing = false;

  constructor(config: TWidgetDraftControllerConfig) {
    this.#config = config;
    if (!config.builderIdentity.trim()) {
      throw new TypeError('Widget authoring builder identity is required.');
    }
    this.#previewBuilds = new PreviewBuildCoordinator({
      debounceMs: config.previewBuildDebounceMs,
    });
    this.#previewBuildAdmission = config.previewBuildAdmission
      ?? new PreviewBuildAdmission();
    this.#previewBuildTenantKey = JSON.stringify([
      config.tenant.orgId,
      config.tenant.accountId,
      config.tenant.cellId,
      config.tenant.placementEpoch,
    ]);
  }

  async close(): Promise<void> {
    this.#closing = true;
    this.#previewBuilds.close();
    this.#previewBuildKeysByDraft.clear();
    this.#previewBuildFencesByOwner.clear();
    this.#previewDiagnosticRateByOwner.clear();
    await Promise.allSettled(this.#operations.values());
  }

  async handleToolChange(change: TWidgetDraftChange): Promise<TWidgetDraftSummary | null> {
    const durable = await this.#config.authoringStore.getDraftByName(
      this.#config.tenant,
      change.name,
    );
    if (durable && change.type !== 'validated') {
      this.#cancelPreviewBuildsForDraft(durable.id);
    }
    return this.#queue(durable ? this.#draftOperationKey(durable.id) : `name:${change.name}`, async () => {
      const workspace = await this.#config.workspace.getDraft(change.name);
      if (!workspace) return null;
      return this.#withCapturedWorkspace(workspace, async (captured) => {
        const draft = await this.#ensureDurableDraft(captured, change.chatId);
        if (!draft) return null;
        const committedMutationId = change.type === 'validated'
          ? undefined
          : this.#config.createId();
        const synced = await this.#compareAndSetDraft(draft, captured.snapshot.digestSha256, {
          status: 'editing',
          lastError: null,
          ...(committedMutationId === undefined
            ? {}
            : { committedMutationId }),
        });
        if (!synced) return null;

        if (change.type === 'validated') {
          await this.#validateCaptured(synced, captured);
          const validated = await this.#activeDraft(synced.id);
          return validated ? this.#summary(validated, captured.workspace) : null;
        }
        this.#validationByDraft.delete(synced.id);
        this.#publishDraftEvent(change.type, synced);
        return this.#summary(synced, captured.workspace);
      });
    });
  }

  async list(): Promise<TWidgetDraftSummary[]> {
    const drafts = await this.#config.authoringStore.listDrafts(this.#config.tenant);
    const summaries = await Promise.all(drafts
      .filter((draft) => draft.status !== 'discarded')
      .map((draft) => this.#refreshAndSummarize(draft)));
    return summaries
      .filter((summary): summary is TWidgetDraftSummary => summary !== null)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async get(draftId: string): Promise<TWidgetDraftSummary | null> {
    const draft = await this.#config.authoringStore.getDraft(this.#config.tenant, draftId);
    return draft && draft.status !== 'discarded' ? this.#refreshAndSummarize(draft) : null;
  }

  async getByName(name: string): Promise<TWidgetDraftSummary | null> {
    const draft = await this.#config.authoringStore.getDraftByName(this.#config.tenant, name);
    return draft && draft.status !== 'discarded' ? this.#refreshAndSummarize(draft) : null;
  }

  async ensurePreviewOwner(request: Readonly<{
    previewId: string;
    canvasId: string;
    frameNodeId: string;
    draftId: string;
    originChatId: string;
    role: TWidgetPreviewOwnerRole;
  }>): Promise<TWidgetPreviewOwnerDescriptor> {
    if (this.#closing) {
      throw controllerError(
        'WIDGET_PREVIEW_SERVICE_CLOSING',
        'Preview owner service is closing.',
      );
    }
    return this.#config.authoringStore.ensurePreviewOwner(this.#config.tenant, {
      id: request.previewId,
      canvasId: request.canvasId,
      frameNodeId: request.frameNodeId,
      draftId: request.draftId,
      originChatId: request.originChatId,
      role: request.role,
      nowMs: this.#now(),
    });
  }

  async getPreviewOwner(request: Readonly<{
    previewId: string;
    canvasId: string;
    frameNodeId: string;
  }>): Promise<TWidgetPreviewOwnerDescriptor | null> {
    const owner = await this.#config.authoringStore.getPreviewOwner(
      this.#config.tenant,
      request.previewId,
    );
    return owner?.canvasId === request.canvasId
      && owner.frameNodeId === request.frameNodeId
      ? owner
      : null;
  }

  async listPreviewOwners(request: Readonly<{
    canvasId: string;
    draftId?: string;
    includeClosed?: boolean;
  }>): Promise<readonly TWidgetPreviewOwnerDescriptor[]> {
    const owners = await this.#config.authoringStore.listPreviewOwners(this.#config.tenant, {
      ...(request.draftId === undefined ? {} : { draftId: request.draftId }),
      ...(request.includeClosed === undefined ? {} : { includeClosed: request.includeClosed }),
    });
    return owners.filter((owner) => owner.canvasId === request.canvasId);
  }

  async closePreviewOwner(request: Readonly<{
    previewId: string;
    canvasId: string;
    frameNodeId: string;
  }>): Promise<boolean> {
    const owner = await this.getPreviewOwner({
      previewId: request.previewId,
      canvasId: request.canvasId,
      frameNodeId: request.frameNodeId,
    });
    if (!owner) return false;
    this.#previewBuilds.cancel(owner.id);
    const closed = await this.#config.authoringStore.closePreviewOwner(this.#config.tenant, {
      previewId: request.previewId,
      frameNodeId: request.frameNodeId,
      nowMs: this.#now(),
    });
    if (!closed) return false;
    this.#previewDiagnosticRateByOwner.delete(owner.id);
    this.#forgetPreviewBuildKey(owner.draftId, owner.id);
    this.#previewBuildFencesByOwner.delete(owner.id);
    this.#previewBuilds.clear(owner.id);
    const remaining = await this.#config.authoringStore.listPreviewOwners(
      this.#config.tenant,
      { draftId: owner.draftId },
    );
    if (remaining.length === 0) {
      await this.#config.widgets.closePreviewWorkspace(this.#config.tenant, {
        draftId: owner.draftId,
      });
    }
    return true;
  }

  async invalidatePreviewBindingsForChat(
    externalSessionKey: string,
  ): Promise<void> {
    const chat = await this.#config.authoringStore.getChatByExternalSessionKey(
      this.#config.tenant,
      externalSessionKey,
    );
    if (chat === null) return;
    const drafts = (await this.#config.authoringStore.listDrafts(
      this.#config.tenant,
    )).filter((draft) => (
      draft.chatId === chat.id && draft.status !== 'discarded'
    ));
    const ownerGroups = await Promise.all(drafts.map((draft) =>
      this.#config.authoringStore.listPreviewOwners(
        this.#config.tenant,
        { draftId: draft.id },
      )));
    for (const owners of ownerGroups) {
      for (const owner of owners) this.#previewBuilds.cancel(owner.id);
    }
    await Promise.all(drafts.map((draft, index) =>
      this.#queue(`draft:${draft.id}`, async () => {
        let changed = false;
        for (const owner of ownerGroups[index] ?? []) {
          if (owner.status === 'closed') continue;
          const nextBindingRevision = owner.bindingRevision + 1;
          if (!Number.isSafeInteger(nextBindingRevision)) {
            throw controllerError(
              'WIDGET_PREVIEW_BINDING_REVISION_EXHAUSTED',
              'Preview binding revision is exhausted.',
            );
          }
          const invalidated =
            await this.#config.authoringStore.compareAndSetPreviewOwner(
              this.#config.tenant,
              {
                previewId: owner.id,
                expectedBuildSequence: owner.buildSequence,
                expectedStatus: owner.status,
                expectedPendingBuildId: owner.pendingBuildId,
                nextBuildSequence: owner.buildSequence,
                status: 'queued',
                pendingBuildId: null,
                lastError: null,
                expectedBindingRevision: owner.bindingRevision,
                nextBindingRevision,
                expectedBindingPlanDigestSha256:
                  owner.bindingPlanDigestSha256,
                nextBindingPlanDigestSha256: null,
                nowMs: this.#now(),
              },
            );
          changed ||= invalidated !== null;
        }
        if (changed && draft.sourceDigestSha256 !== null) {
          this.#publishDraftEvent('changed', draft);
        }
      })));
  }

  async cancelPreviewBuild(request: Readonly<{
    previewId: string;
    canvasId: string;
    frameNodeId: string;
    buildId: string;
    expectedBuildSequence: number;
  }>): Promise<boolean> {
    const owner = await this.getPreviewOwner(request);
    if (
      owner === null
      || owner.status !== 'building'
      || owner.pendingBuildId !== request.buildId
      || owner.buildSequence !== request.expectedBuildSequence
    ) return false;
    const draft = await this.#activeDraft(owner.draftId);
    if (draft === null || draft.sourceDigestSha256 === null) return false;

    const localFence = this.#previewBuildFencesByOwner.get(owner.id);
    if (
      localFence?.buildId === request.buildId
      && localFence.ownerBuildSequence === request.expectedBuildSequence
    ) {
      this.#previewBuilds.cancel(
        owner.id,
        localFence.coordinatorBuildSequence,
      );
    }
    const superseded = await this.#clearSupersededPreviewBuild(
      owner,
      request.buildId,
      draft.sourceDigestSha256,
    );
    if (superseded === null) return false;
    this.#publishPreviewProgress({
      owner: superseded,
      draftRevision: draft.sourceDigestSha256,
      buildId: request.buildId,
      phase: 'superseded',
    });
    return true;
  }

  async acquirePreviewMountLease(request: Readonly<{
    leaseId: string;
    previewId: string;
    previewRevisionId: string;
    canvasId: string;
    frameNodeId: string;
  }>): Promise<TWidgetPreviewMountLeaseDescriptor | null> {
    if (this.#closing) return null;
    return this.#config.authoringStore.acquirePreviewMountLease(this.#config.tenant, {
      ...request,
      nowMs: this.#now(),
      ttlMs: WIDGET_PREVIEW_MOUNT_LEASE_TTL_MS,
    });
  }

  async renewPreviewMountLease(request: Readonly<{
    leaseId: string;
    previewId: string;
    previewRevisionId: string;
    canvasId: string;
    frameNodeId: string;
  }>): Promise<TWidgetPreviewMountLeaseDescriptor | null> {
    if (this.#closing) return null;
    return this.#config.authoringStore.renewPreviewMountLease(this.#config.tenant, {
      ...request,
      nowMs: this.#now(),
      ttlMs: WIDGET_PREVIEW_MOUNT_LEASE_TTL_MS,
    });
  }

  releasePreviewMountLease(request: Readonly<{
    leaseId: string;
    previewId: string;
    previewRevisionId: string;
    canvasId: string;
    frameNodeId: string;
  }>): Promise<boolean> {
    return this.#config.authoringStore.releasePreviewMountLease(this.#config.tenant, {
      ...request,
      nowMs: this.#now(),
    });
  }

  async reportPreviewDiagnostic(request: Readonly<{
    previewId: string;
    canvasId: string;
    frameNodeId: string;
    draftId: string;
    originChatId: string;
    diagnostic: TWidgetDiagnostic;
  }>): Promise<Readonly<{
    deduplicated: boolean;
    diagnostic: TWidgetDiagnostic;
    owner: TWidgetPreviewOwnerDescriptor;
  }>> {
    const diagnostic = ZWidgetDiagnostic.parse(request.diagnostic);
    const owner = await this.getPreviewOwner(request);
    if (
      owner === null
      || owner.status === 'closed'
      || owner.draftId !== request.draftId
      || owner.originChatId !== request.originChatId
      || owner.activeRevisionId === null
      || diagnostic.previewRevisionId !== owner.activeRevisionId
      || diagnostic.trust !== 'untrusted'
      || !['host', 'guest', 'capability', 'channel', 'budget', 'lifecycle']
        .includes(diagnostic.origin)
    ) {
      throw controllerError(
        'WIDGET_PREVIEW_DIAGNOSTIC_SCOPE_INVALID',
        'Preview diagnostic does not match the active frame-owned revision.',
      );
    }
    this.#admitPreviewDiagnostic(owner.id);
    const retained = await this.#config.widgets.loadPreviewRevision(
      this.#config.tenant,
      {
        previewId: owner.id,
        revisionId: owner.activeRevisionId,
      },
    );
    if (
      retained === null
      || retained.draftId !== owner.draftId
      || retained.draftRevisionSha256 !== diagnostic.draftRevision
      || retained.previewRevisionId !== diagnostic.previewRevisionId
      || diagnostic.buildId !== retained.previewRevisionId
      || retained.buildSequence !== diagnostic.buildSequence
    ) {
      throw controllerError(
        'WIDGET_PREVIEW_DIAGNOSTIC_STALE',
        'Preview diagnostic refers to an obsolete revision.',
      );
    }
    const previousRecords = owner.runtimeDiagnostics;
    const previousIndex = previousRecords.findIndex((record) => (
      record.diagnostic.fingerprint === diagnostic.fingerprint
      && record.diagnostic.draftRevision === diagnostic.draftRevision
      && record.diagnostic.previewRevisionId === diagnostic.previewRevisionId
    ));
    const deduplicated = previousIndex >= 0;
    const storedDiagnostic = deduplicated
      ? {
          ...diagnostic,
          occurrenceCount: Math.min(
            1_000_000,
            previousRecords[previousIndex]!.diagnostic.occurrenceCount + 1,
          ),
        }
      : diagnostic;
    const reportedAtMs = this.#now();
    const storedRecord: TWidgetPreviewRuntimeDiagnosticRecord = Object.freeze({
      diagnostic: Object.freeze(storedDiagnostic),
      status: 'awaiting-retest',
      reportedAtMs,
    });
    const unboundedRecords = deduplicated
      ? [
          ...previousRecords.filter((_value, index) => index !== previousIndex),
          storedRecord,
        ]
      : [...previousRecords, storedRecord];
    const nextRecords = this.#boundedPreviewRuntimeDiagnostics(unboundedRecords);
    const diagnosticOwnsCurrentBuildFence = (
      owner.buildSequence === retained.buildSequence
      && (owner.status === 'ready' || owner.status === 'failed')
    );
    const updated = await this.#config.authoringStore.compareAndSetPreviewOwner(
      this.#config.tenant,
      {
        previewId: owner.id,
        expectedBuildSequence: owner.buildSequence,
        expectedStatus: owner.status,
        expectedPendingBuildId: owner.pendingBuildId,
        nextBuildSequence: owner.buildSequence,
        status: diagnosticOwnsCurrentBuildFence ? 'failed' : owner.status,
        activeRevisionId: owner.activeRevisionId,
        pendingBuildId: diagnosticOwnsCurrentBuildFence
          ? null
          : owner.pendingBuildId,
        runtimeDiagnostics: nextRecords,
        nowMs: reportedAtMs,
      },
    );
    if (updated === null) {
      throw controllerError(
        'WIDGET_PREVIEW_DIAGNOSTIC_CONFLICT',
        'Preview changed before its diagnostic could be recorded.',
      );
    }
    return Object.freeze({
      deduplicated,
      diagnostic: Object.freeze(storedDiagnostic),
      owner: updated,
    });
  }

  async getPreviewDiagnostics(request: Readonly<{
    previewId: string;
    canvasId: string;
    frameNodeId: string;
  }>): Promise<readonly TWidgetPreviewRuntimeDiagnosticRecord[]> {
    const owner = await this.getPreviewOwner(request);
    if (owner === null || owner.status === 'closed') {
      throw controllerError(
        'WIDGET_PREVIEW_DIAGNOSTIC_SCOPE_INVALID',
        'Preview diagnostics do not match an open frame owner.',
      );
    }
    return owner.runtimeDiagnostics;
  }

  resolvePreviewDiagnostic(request: Readonly<{
    previewId: string;
    canvasId: string;
    frameNodeId: string;
    previewRevisionId: string;
    fingerprint: string;
  }>): Promise<TWidgetPreviewOwnerDescriptor> {
    return this.#clearPreviewRuntimeDiagnostic(request, false);
  }

  retestPreviewDiagnostic(request: Readonly<{
    previewId: string;
    canvasId: string;
    frameNodeId: string;
    previewRevisionId: string;
    fingerprint: string;
    operation: string;
  }>): Promise<TWidgetPreviewOwnerDescriptor> {
    return this.#clearPreviewRuntimeDiagnostic(request, true);
  }

  /** Reconstructs an editable draft from one exact durable publication source. */
  async materializePublishedDraft(request: Readonly<{
    name: string;
    definitionId: string;
    publishedRevisionId: string;
    snapshot: TWidgetSourceSnapshot;
  }>): Promise<TWidgetDraftSummary> {
    const initial = await this.#config.authoringStore.getDraftByName(
      this.#config.tenant,
      request.name,
    );
    return this.#queue(initial ? this.#draftOperationKey(initial.id) : `name:${request.name}`, async () => {
      const materialized = await this.#config.workspace.materializeDraftFromSnapshot(
        request.name,
        request.snapshot,
        {
          definitionId: request.definitionId,
          publishedRevisionId: request.publishedRevisionId,
        },
      );
      const existing = await this.#config.authoringStore.getDraftByName(
        this.#config.tenant,
        request.name,
      );
      if (existing && existing.status !== 'discarded') {
        if (
          (materialized.pending && !this.#matchesPublicationSeed(existing, request))
          || (!materialized.pending && existing.definitionId !== request.definitionId)
        ) {
          if (materialized.pending) await materialized.rollback().catch(() => false);
          throw controllerError(
            'AGENT_AUTHORING_INTEGRITY_FAILED',
            'Widget source conflicts with its active durable publication identity.',
          );
        }
        if (materialized.pending) {
          await materialized.commitSeed(async () => existing);
        }
        await this.#mountDurableDraft(existing);
        return this.#summary(existing, materialized.draft);
      }
      if (!materialized.pending) {
        throw controllerError(
          'AGENT_AUTHORING_INTEGRITY_FAILED',
          'Untracked widget source cannot be claimed as an immutable publication draft.',
        );
      }

      const externalSessionKey = this.#managementChatExternalKey(request.definitionId);
      await this.#config.workspace.ensureChat(externalSessionKey);
      let chat = await this.#config.authoringStore.getChatByExternalSessionKey(
        this.#config.tenant,
        externalSessionKey,
      );
      if (!chat) {
        try {
          chat = await this.#config.authoringStore.createChat(this.#config.tenant, {
            id: this.#config.createId(),
            canvasId: this.#config.tenant.canvasId ?? null,
            externalSessionKey,
            name: request.name,
            workspaceRelativePath: relative(
              this.#config.workspace.agentRoot,
              this.#config.workspace.getChatRoot(externalSessionKey),
            ),
            historyRelativePath: relative(
              this.#config.workspace.agentRoot,
              this.#config.workspace.getChatHistoryRoot(externalSessionKey),
            ),
            nowMs: this.#now(),
          });
        } catch {
          chat = await this.#config.authoringStore.getChatByExternalSessionKey(
            this.#config.tenant,
            externalSessionKey,
          );
        }
      }
      if (!chat) throw controllerError('AGENT_CHAT_CREATE_FAILED', 'Widget management chat could not be created.');

      let seeded: TAgentAuthoringDraftDescriptor;
      try {
        seeded = await materialized.commitSeed(() => (
          this.#config.authoringStore.createDraft(this.#config.tenant, {
            id: this.#config.createId(),
            chatId: chat.id,
            name: request.name,
            sourceRelativePath: this.#sourceRelativePath(materialized.draft),
            publicationSeed: {
              definitionId: request.definitionId,
              publishedRevisionId: request.publishedRevisionId,
              sourceDigestSha256: request.snapshot.digestSha256,
              committedMutationId: this.#config.createId(),
            },
            nowMs: this.#now(),
          })
        ));
      } catch (error) {
        const winner = await this.#config.authoringStore.getDraftByName(
          this.#config.tenant,
          request.name,
        );
        if (!winner || winner.status === 'discarded') {
          await materialized.rollback().catch(() => false);
          throw error;
        }
        if (!this.#matchesPublicationSeed(winner, request)) {
          await materialized.rollback().catch(() => false);
          throw controllerError(
            'AGENT_AUTHORING_INTEGRITY_FAILED',
            'Newly materialized widget source conflicts with its active durable draft.',
          );
        }
        await materialized.commitSeed(async () => winner);
        await this.#mountDurableDraft(winner);
        return this.#summary(winner, materialized.draft);
      }
      if (
        seeded.definitionId !== request.definitionId
        || seeded.publishedRevisionId !== request.publishedRevisionId
        || seeded.sourceDigestSha256 !== request.snapshot.digestSha256
        || seeded.status !== 'published'
      ) {
        throw controllerError(
          'AGENT_AUTHORING_INTEGRITY_FAILED',
          'Materialized widget draft does not match its durable publication seed.',
        );
      }
      await this.#mountDurableDraft(seeded);
      this.#validationByDraft.delete(seeded.id);
      this.#publishDraftEvent('created', seeded);
      return this.#summary(seeded, materialized.draft);
    });
  }

  /** Resolves a public immutable source revision to the current private workspace CAS token. */
  async getWorkspaceRevision(name: string, expectedSourceRevision: string): Promise<string> {
    const draft = await this.#config.authoringStore.getDraftByName(this.#config.tenant, name);
    if (!draft || draft.status === 'discarded') {
      throw controllerError('WIDGET_DRAFT_NOT_FOUND', `Widget draft '${name}' was not found.`);
    }
    const workspace = await this.#config.workspace.getDraft(name);
    if (!workspace) throw controllerError('WIDGET_DRAFT_NOT_FOUND', `Widget draft '${name}' was not found.`);
    return this.#withCapturedWorkspace(workspace, async (captured) => {
      if (captured.snapshot.digestSha256 !== expectedSourceRevision) {
        throw controllerError(
          'STALE_REVISION',
          `STALE_REVISION: Widget draft '${name}' changed before the edit was saved.`,
        );
      }
      return workspace.revision;
    });
  }

  async validate(draftId: string, expectedRevision?: string): Promise<TWidgetDraftSummary | null> {
    return this.#queue(`draft:${draftId}`, async () => {
      const draft = await this.#activeDraft(draftId);
      if (!draft) return null;
      const workspace = await this.#config.workspace.getDraft(draft.name);
      if (!workspace) return null;

      return this.#withCapturedWorkspace(workspace, async (captured) => {
        const currentRevision = captured.snapshot.digestSha256;
        const synced = await this.#compareAndSetDraft(draft, currentRevision, { status: 'editing' });
        if (!synced) return this.get(draftId);
        if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
          return this.#summary(synced, captured.workspace);
        }
        await this.#validateCaptured(synced, captured);
        const current = await this.#activeDraft(draftId);
        return current ? this.#summary(current, captured.workspace) : null;
      });
    });
  }

  async getPreviewCatalogState(name: string): Promise<TWidgetPreviewCatalogState | null> {
    const draft = await this.#config.authoringStore.getDraftByName(this.#config.tenant, name);
    if (!draft || draft.status === 'discarded') return null;
    const currentRevision = draft.sourceDigestSha256 ?? '';
    const validation = this.#validationForDraft(draft, currentRevision);
    if (validation.status === 'invalid') {
      return {
        status: 'failed',
        revision: currentRevision,
        message: 'Draft validation failed. Open the draft for diagnostics.',
      };
    }
    return validation.status === 'valid'
      ? { status: 'ready', revision: currentRevision }
      : { status: 'not-ready', revision: currentRevision, message: null };
  }

  async buildPreview(
    draftId: string,
    ownerRef?: Readonly<{
      previewId: string;
      canvasId: string;
      frameNodeId: string;
    }>,
  ): Promise<TWidgetPreviewResult> {
    if (this.#closing) {
      return this.#previewFailure(draftId, 'build-failed', 'Preview service is closing.');
    }
    const draft = await this.#activeDraft(draftId);
    if (!draft) return this.#previewFailure(draftId, 'not-found', 'Widget draft was not found.');
    const workspace = await this.#config.workspace.getDraft(draft.name);
    if (!workspace) return this.#previewFailure(draft.id, 'not-found', 'Widget draft source was not found.');
    const fencedDraft = await this.#withCapturedWorkspace(workspace, (captured) =>
      this.#compareAndSetDraft(draft, captured.snapshot.digestSha256, {
        status: 'editing',
      }));
    if (
      fencedDraft === null
      || fencedDraft.sourceDigestSha256 === null
      || fencedDraft.committedMutationId === null
    ) {
      return this.#previewFailure(
        draft.id,
        'build-failed',
        'Widget draft source could not be committed before Preview opened.',
      );
    }
    const owner = ownerRef === undefined
      ? null
      : await this.getPreviewOwner(ownerRef);
    if (
      ownerRef !== undefined
      && (owner === null || owner.status === 'closed' || owner.draftId !== fencedDraft.id)
    ) {
      return this.#previewFailure(
        fencedDraft.id,
        'build-failed',
        'Preview frame ownership could not be verified.',
      );
    }
    // This draft/owner key only deduplicates debounce scheduling. The widget
    // construction cache owns the authoritative exact source/toolchain key.
    const buildKey = createHash('sha256').update(JSON.stringify({
      draftId: fencedDraft.id,
      sourceDigestSha256: fencedDraft.sourceDigestSha256,
      committedMutationId: fencedDraft.committedMutationId,
      builderIdentity: this.#config.builderIdentity,
      capsuleBuildIdentity: this.#config.capsuleBuildIdentity,
      buildPolicyId: this.#config.buildPolicyId,
      bindingRevision: owner?.bindingRevision ?? null,
      bindingPlanDigestSha256: owner?.bindingPlanDigestSha256 ?? null,
    })).digest('hex');
    const coordinatorKey = owner?.id ?? fencedDraft.id;
    this.#rememberPreviewBuildKey(fencedDraft.id, coordinatorKey);
    const outcome = await this.#previewBuilds.request({
      draftId: coordinatorKey,
      buildKey,
      sourceDigestSha256: fencedDraft.sourceDigestSha256,
      committedMutationId: fencedDraft.committedMutationId,
      buildSequence: fencedDraft.buildSequence,
      build: async ({ buildSequence, signal, reportProgress }) => this.#previewBuildAdmission.run({
        tenantKey: this.#previewBuildTenantKey,
        draftId: fencedDraft.id,
        signal,
      }, async () => {
        if (signal.aborted) throw controllerError(
          'WIDGET_PREVIEW_BUILD_SUPERSEDED',
          'Preview build was superseded.',
        );
        const result = await this.#buildPreviewNow(draftId, ownerRef, {
          coordinatorBuildSequence: buildSequence,
          sourceDigestSha256: fencedDraft.sourceDigestSha256!,
          committedMutationId: fencedDraft.committedMutationId!,
          signal,
          reportProgress,
        });
        if (!result.ready) {
          throw Object.assign(
            controllerError('WIDGET_PREVIEW_BUILD_FAILED', result.message),
            { previewFailure: result },
          );
        }
        return result;
      }),
    });
    if (outcome.status === 'ready') return outcome.result;
    if (outcome.status === 'failed') {
      const error = outcome.error;
      if (
        error !== null
        && typeof error === 'object'
        && 'previewFailure' in error
      ) {
        return error.previewFailure as Exclude<TWidgetPreviewResult, { ready: true }>;
      }
      return this.#previewFailure(draftId, 'build-failed', errorMessage(error));
    }
    return this.#previewFailure(
      draftId,
      'build-failed',
      'Preview build was superseded by a newer draft revision.',
    );
  }

  async #buildPreviewNow(
    draftId: string,
    ownerRef?: Readonly<{
      previewId: string;
      canvasId: string;
      frameNodeId: string;
    }>,
    execution?: Readonly<{
      coordinatorBuildSequence: number;
      sourceDigestSha256: string;
      committedMutationId: string;
      signal: AbortSignal;
      reportProgress(phase: 'installing' | 'building' | 'validating'): void;
    }>,
  ): Promise<TWidgetPreviewResult> {
    return this.#queue(`draft:${draftId}`, async () => {
      if (execution?.signal.aborted) {
        throw controllerError(
          'WIDGET_BUILD_SUPERSEDED',
          'Preview build was superseded.',
        );
      }
      if (this.#closing) {
        return this.#previewFailure(draftId, 'build-failed', 'Preview service is closing.');
      }
      const draft = await this.#activeDraft(draftId);
      if (!draft) return this.#previewFailure(draftId, 'not-found', 'Widget draft was not found.');
      const workspace = await this.#config.workspace.getDraft(draft.name);
      if (!workspace) return this.#previewFailure(draft.id, 'not-found', 'Widget draft source was not found.');

      return this.#withCapturedWorkspace(workspace, async (captured) => {
        const currentRevision = captured.snapshot.digestSha256;
        const synced = await this.#compareAndSetDraft(draft, currentRevision, { status: 'editing' });
        if (
          !synced
          || (
            execution !== undefined
            && (
              currentRevision !== execution.sourceDigestSha256
              || synced.sourceDigestSha256 !== execution.sourceDigestSha256
              || synced.committedMutationId !== execution.committedMutationId
            )
          )
        ) {
          return this.#previewFailure(draft.id, 'build-failed', 'The widget draft changed before Preview opened.');
        }

        let previewOwner: TWidgetPreviewOwnerDescriptor | null = null;
        let previewRevisionId: string | null = null;
        const markOwnerFailed = async (
          message: string,
          errors: readonly unknown[],
          code = 'WIDGET_BUILD_FAILED',
        ): Promise<void> => {
          if (previewOwner === null) return;
          const timestampMs = this.#now();
          const failedBuildId = previewRevisionId ?? previewOwner.pendingBuildId;
          if (failedBuildId === null) return;
          const structuredDiagnostics = (errors.length === 0 ? [message] : errors)
            .slice(0, 20)
            .map((error) => fnNormalizeWidgetBuildError({
              error: typeof error === 'string'
                ? Object.assign(new Error(error), { code })
                : error,
              draftRevision: currentRevision,
              previewRevisionId: null,
              buildId: failedBuildId,
              buildSequence: previewOwner!.buildSequence,
              timestampMs,
              digestSha256: (value) => (
                createHash('sha256').update(value).digest('hex')
              ),
            }));
          const failed = await this.#config.authoringStore.compareAndSetPreviewOwner(
            this.#config.tenant,
            {
              previewId: previewOwner.id,
              expectedBuildSequence: previewOwner.buildSequence,
              expectedStatus: 'building',
              expectedPendingBuildId: failedBuildId,
              nextBuildSequence: previewOwner.buildSequence,
              status: 'failed',
              pendingBuildId: null,
              lastError: {
                message: message.slice(0, 2_000),
                diagnostics: structuredDiagnostics,
                draftRevision: currentRevision,
                previewRevisionId: null,
                buildId: previewRevisionId,
              },
              nowMs: timestampMs,
            },
          );
          if (failed !== null) {
            previewOwner = failed;
            this.#publishPreviewProgress({
              owner: failed,
              draftRevision: currentRevision,
              buildId: failedBuildId,
              phase: 'failed',
            });
          }
        };
        if (ownerRef !== undefined) {
          const currentOwner = await this.getPreviewOwner(ownerRef);
          if (
            currentOwner === null
            || currentOwner.status === 'closed'
            || currentOwner.draftId !== draft.id
          ) {
            return this.#previewFailure(
              draft.id,
              'build-failed',
              'Preview frame ownership changed before the build started.',
              { revision: currentRevision },
            );
          }
          let preflightBindingPlanDigestSha256: string | null = null;
          try {
            const preflightManifest = await this.#readManifest(captured.rootPath);
            if (
              preflightManifest.ok
              && preflightManifest.manifest.name === draft.name
            ) {
              const preflightBindings =
                await this.#config.resolveResourceBindings(this.#config.tenant, {
                  draft: synced,
                  manifest: preflightManifest.manifest,
                });
              preflightBindingPlanDigestSha256 =
                fnWidgetPreviewBindingPlanDigest({
                  bindings: preflightBindings,
                  digestSha256: (value) =>
                    createHash('sha256').update(value).digest('hex'),
                });
            }
          } catch {
            // The normal validation path below records the exact failure. A
            // null binding digest still invalidates any retained ready state.
          }
          if (currentOwner.activeRevisionId !== null) {
            const retained = await this.#config.widgets.loadPreview(
              this.#config.tenant,
              { previewId: currentOwner.id },
            );
            if (
              retained !== null
              && retained.previewRevisionId === currentOwner.activeRevisionId
              && retained.draftRevisionSha256 === currentRevision
              && retained.committedMutationId === synced.committedMutationId
              && retained.bindingRevision === currentOwner.bindingRevision
              && retained.bindingPlanDigestSha256
                === preflightBindingPlanDigestSha256
              && currentOwner.bindingPlanDigestSha256
                === preflightBindingPlanDigestSha256
              && currentOwner.sourceDigestSha256 === currentRevision
              && currentOwner.committedMutationId === synced.committedMutationId
            ) {
              return this.#previewReady(retained);
            }
          }
          const nextSequence = synced.buildSequence;
          const bindingChanged = currentOwner.bindingPlanDigestSha256
            !== preflightBindingPlanDigestSha256;
          const nextBindingRevision = currentOwner.bindingRevision
            + (bindingChanged ? 1 : 0);
          if (
            !Number.isSafeInteger(nextSequence)
            || nextSequence < currentOwner.buildSequence
            || !Number.isSafeInteger(nextBindingRevision)
          ) {
            return this.#previewFailure(
              draft.id,
              'build-failed',
              'Preview build sequence is exhausted.',
              { revision: currentRevision },
            );
          }
          previewRevisionId = this.#config.createId();
          previewOwner = await this.#config.authoringStore.compareAndSetPreviewOwner(
            this.#config.tenant,
            {
              previewId: currentOwner.id,
              expectedBuildSequence: currentOwner.buildSequence,
              expectedStatus: currentOwner.status,
              expectedPendingBuildId: currentOwner.pendingBuildId,
              nextBuildSequence: nextSequence,
              status: 'building',
              pendingBuildId: previewRevisionId,
              lastError: null,
              expectedBindingRevision: currentOwner.bindingRevision,
              nextBindingRevision,
              expectedBindingPlanDigestSha256:
                currentOwner.bindingPlanDigestSha256,
              nextBindingPlanDigestSha256:
                preflightBindingPlanDigestSha256,
              expectedSourceDigestSha256: currentOwner.sourceDigestSha256,
              nextSourceDigestSha256: currentRevision,
              expectedCommittedMutationId: currentOwner.committedMutationId,
              nextCommittedMutationId: synced.committedMutationId!,
              nowMs: this.#now(),
            },
          );
          if (previewOwner === null) {
            return this.#previewFailure(
              draft.id,
              'build-failed',
              'Preview changed before the build could be queued.',
              { revision: currentRevision },
            );
          }
          if (execution !== undefined) {
            this.#previewBuildFencesByOwner.set(previewOwner.id, {
              buildId: previewRevisionId,
              ownerBuildSequence: previewOwner.buildSequence,
              coordinatorBuildSequence: execution.coordinatorBuildSequence,
            });
          }
          this.#publishPreviewProgress({
            owner: previewOwner,
            draftRevision: currentRevision,
            buildId: previewRevisionId,
            phase: 'queued',
          });
        }

        const validation = await this.#validateCaptured(synced, captured, {
          skipTrustedBuild: true,
        });
        if (!validation.ok) {
          await markOwnerFailed(
            'The widget draft must pass validation before it can be previewed.',
            validation.errors,
            'WIDGET_SOURCE_VALIDATION_FAILED',
          );
          return this.#previewFailure(draft.id, 'validation-failed', 'The widget draft must pass validation before it can be previewed.', {
            revision: currentRevision,
            diagnostics: validation.errors,
          });
        }
        const manifest = await this.#readManifest(captured.rootPath);
        if (!manifest.ok) {
          await markOwnerFailed(
            manifest.message,
            [manifest.message],
            'WIDGET_MANIFEST_INVALID',
          );
          return this.#previewFailure(draft.id, 'manifest-invalid', manifest.message, {
            revision: currentRevision,
            diagnostics: [manifest.message],
          });
        }
        if (manifest.manifest.name !== draft.name) {
          const message = `Draft identity is '${draft.name}', but vibecanvas.json declares '${manifest.manifest.name}'.`;
          await markOwnerFailed(
            message,
            [message],
            'WIDGET_MANIFEST_IDENTITY_INVALID',
          );
          return this.#previewFailure(draft.id, 'manifest-invalid', message, {
            revision: currentRevision,
            diagnostics: [message],
          });
        }
        let bindings;
        try {
          bindings = await this.#config.resolveResourceBindings(this.#config.tenant, {
            draft: synced,
            manifest: manifest.manifest,
          });
        } catch (error) {
          const message = errorMessage(error);
          await markOwnerFailed(message, [error]);
          return this.#previewFailure(draft.id, 'build-failed', message, {
            revision: currentRevision,
            diagnostics: [message],
          });
        }
        const bindingPlanDigestSha256 = fnWidgetPreviewBindingPlanDigest({
          bindings,
          digestSha256: (value) =>
            createHash('sha256').update(value).digest('hex'),
        });
        if (
          previewOwner !== null
          && previewOwner.bindingPlanDigestSha256 !== bindingPlanDigestSha256
        ) {
          const nextBindingRevision = previewOwner.bindingRevision + 1;
          if (!Number.isSafeInteger(nextBindingRevision)) {
            await markOwnerFailed(
              'Preview binding revision is exhausted.',
              ['Preview binding revision is exhausted.'],
            );
            return this.#previewFailure(
              draft.id,
              'build-failed',
              'Preview binding revision is exhausted.',
              { revision: currentRevision },
            );
          }
          const rebound = await this.#config.authoringStore.compareAndSetPreviewOwner(
            this.#config.tenant,
            {
              previewId: previewOwner.id,
              expectedBuildSequence: previewOwner.buildSequence,
              expectedStatus: 'building',
              expectedPendingBuildId: previewRevisionId,
              nextBuildSequence: previewOwner.buildSequence,
              status: 'building',
              expectedBindingRevision: previewOwner.bindingRevision,
              nextBindingRevision,
              expectedBindingPlanDigestSha256:
                previewOwner.bindingPlanDigestSha256,
              nextBindingPlanDigestSha256: bindingPlanDigestSha256,
              nowMs: this.#now(),
            },
          );
          if (rebound === null) {
            return this.#previewFailure(
              draft.id,
              'build-failed',
              'Preview resource selection changed before the build could start.',
              { revision: currentRevision },
            );
          }
          previewOwner = rebound;
        }

        try {
          const fenced = await this.#config.workspace.withDraftRevisionFence(
            draft.name,
            captured.workspace.revision,
            async () => {
              const commitDraft = await this.#activeDraft(draft.id);
              if (!commitDraft) {
                return {
                  status: 'failed' as const,
                  result: this.#previewFailure(
                    draft.id,
                    'not-found',
                    'Widget draft was discarded before Preview opened.',
                    { revision: currentRevision },
                  ),
                };
              }
              if (commitDraft.sourceDigestSha256 !== currentRevision) {
                return {
                  status: 'failed' as const,
                  result: this.#previewFailure(
                    draft.id,
                    'build-failed',
                    'The widget draft changed before Preview opened.',
                    {
                      revision: commitDraft.sourceDigestSha256 ?? currentRevision,
                    },
                  ),
                };
              }
              if (commitDraft.committedMutationId !== synced.committedMutationId) {
                return {
                  status: 'failed' as const,
                  result: this.#previewFailure(
                    draft.id,
                    'build-failed',
                    'The widget draft mutation fence changed before Preview opened.',
                    { revision: commitDraft.sourceDigestSha256 ?? currentRevision },
                  ),
                };
              }

              const result = await this.#config.widgets.buildPreview(this.#config.tenant, {
                draftId: draft.id,
                definitionId: draft.definitionId,
                draftRevisionSha256: currentRevision,
                committedMutationId: synced.committedMutationId!,
                snapshot: captured.snapshot,
                manifest: manifest.manifest,
                builderIdentity: this.#config.builderIdentity,
                capsuleBuildIdentity: this.#config.capsuleBuildIdentity,
                buildPolicyId: this.#config.buildPolicyId,
                bindings,
                ...(execution === undefined
                  ? {}
                  : {
                      signal: execution.signal,
                      reportProgress: (
                        phase: 'installing' | 'building' | 'validating',
                      ) => {
                        execution.reportProgress(phase);
                        if (previewOwner !== null && previewRevisionId !== null) {
                          this.#publishPreviewProgress({
                            owner: previewOwner,
                            draftRevision: currentRevision,
                            buildId: previewRevisionId,
                            phase,
                          });
                        }
                      },
                    }),
                ...(previewOwner === null || previewRevisionId === null
                  ? {}
                  : {
                      previewId: previewOwner.id,
                      expectedActiveRevisionId: previewOwner.activeRevisionId,
                      previewRevisionId,
                      buildSequence: previewOwner.buildSequence,
                      bindingRevision: previewOwner.bindingRevision,
                      nowMs: this.#now(),
                    }),
              });
              return { status: 'committed' as const, result };
            },
          );
          if (fenced.status === 'failed') {
            await markOwnerFailed(
              fenced.result.message,
              fenced.result.diagnostics,
            );
            return fenced.result;
          }
          const ready = this.#previewReady(fenced.result);
          if (
            ready.ready
            && previewOwner !== null
            && ready.previewId !== null
            && ready.previewRevisionId !== null
            && ready.buildSequence !== null
          ) {
            this.#publishPreviewProgress({
              owner: {
                ...previewOwner,
                status: 'ready',
                activeRevisionId: ready.previewRevisionId,
                pendingBuildId: null,
                buildSequence: ready.buildSequence,
              },
              draftRevision: currentRevision,
              buildId: ready.previewRevisionId,
              phase: 'ready',
            });
          }

          // Preview bytes are complete; event delivery remains best-effort.
          try {
            this.#config.eventPublisher.publishAgentEvent({
              kind: 'widget-preview',
              type: 'catalog-changed',
              draftId: draft.id,
              revision: currentRevision,
              sourceDigestSha256: currentRevision,
              committedMutationId: synced.committedMutationId!,
              buildSequence: synced.buildSequence,
            });
          } catch {}
          return ready;
        } catch (error) {
          const message = errorMessage(error);
          if (
            errorCode(error) === 'WIDGET_BUILD_SUPERSEDED'
            && previewOwner !== null
            && previewRevisionId !== null
          ) {
            const superseded = await this.#clearSupersededPreviewBuild(
              previewOwner,
              previewRevisionId,
              currentRevision,
            );
            if (superseded !== null) {
              this.#publishPreviewProgress({
                owner: superseded,
                draftRevision: currentRevision,
                buildId: previewRevisionId,
                phase: 'superseded',
              });
            }
            return this.#previewFailure(draft.id, 'build-failed', message, {
              revision: currentRevision,
              diagnostics: [message],
            });
          }
          await markOwnerFailed(message, [error]);
          const code = errorCode(error);
          const failureCurrentRevision = code === 'WIDGET_DRAFT_REVISION_CHANGED'
            ? await this.#currentWorkspaceSourceRevision(
              draft.name,
              errorCurrentRevision(error) ?? currentRevision,
            )
            : currentRevision;
          return this.#previewFailure(draft.id, 'build-failed', message, {
            revision: failureCurrentRevision,
            diagnostics: [message],
          });
        }
      });
    });
  }

  async publish(
    draftId: string,
    expectedRevision: string,
    preview: TWidgetPreviewPublishSelection,
  ): Promise<TWidgetPublishResult> {
    return this.#queue(`draft:${draftId}`, async () => {
      const draft = await this.#activeDraft(draftId);
      if (!draft) return this.#publishFailure(draftId, 'not-found', 'Widget draft was not found.');
      const workspace = await this.#config.workspace.getDraft(draft.name);
      if (!workspace) return this.#publishFailure(draft.id, 'not-found', 'Widget draft source was not found.');

      return this.#withCapturedWorkspace(workspace, async (captured) => {
        const currentRevision = captured.snapshot.digestSha256;
        const synced = await this.#compareAndSetDraft(draft, currentRevision, { status: 'editing' });
        if (!synced || expectedRevision !== currentRevision) {
          return this.#publishFailure(
            draft.id,
            'stale-revision',
            'The widget draft changed before publication started.',
            currentRevision,
          );
        }
        const validation = await this.#validateCaptured(synced, captured, {
          skipTrustedBuild: true,
        });
        if (!validation.ok) {
          return this.#publishFailure(
            draft.id,
            'validation-failed',
            'The widget draft must pass validation before publication.',
            currentRevision,
            validation.errors,
            validation.warnings,
          );
        }
        const manifest = await this.#readManifest(captured.rootPath);
        if (!manifest.ok || manifest.manifest.name !== draft.name) {
          const message = manifest.ok
            ? `Draft identity is '${draft.name}', but vibecanvas.json declares '${manifest.manifest.name}'.`
            : manifest.message;
          return this.#publishFailure(draft.id, 'validation-failed', message, currentRevision, [message]);
        }
        let currentBindings;
        try {
          currentBindings = await this.#config.resolveResourceBindings(this.#config.tenant, {
            draft: synced,
            manifest: manifest.manifest,
          });
        } catch (error) {
          const message = errorMessage(error);
          return this.#publishFailure(draft.id, 'resource-binding-invalid', message, currentRevision, [message]);
        }
        const currentBindingPlanDigestSha256 = fnWidgetPreviewBindingPlanDigest({
          bindings: currentBindings,
          digestSha256: (value) =>
            createHash('sha256').update(value).digest('hex'),
        });
        if (
          currentBindingPlanDigestSha256
          !== preview.expectedBindingPlanDigestSha256
        ) {
          const message =
            'The selected resources changed after this Preview was reviewed. Rebuild and review the Preview again.';
          return this.#publishFailure(
            draft.id,
            'resource-binding-invalid',
            message,
            currentRevision,
            [message],
          );
        }

        let publishedRevisionId: string;
        let publishedUiRuntime: TWidgetCapsuleRuntimeDescriptor;
        try {
          const fenced = await this.#config.workspace.withDraftRevisionFence(
            draft.name,
            captured.workspace.revision,
            async () => {
              const commitDraft = await this.#activeDraft(draft.id);
              if (!commitDraft) {
                return {
                  status: 'failed' as const,
                  result: this.#publishFailure(
                    draft.id,
                    'not-found',
                    'Widget draft was discarded before publication committed.',
                  ),
                };
              }
              if (commitDraft.sourceDigestSha256 !== currentRevision) {
                return {
                  status: 'failed' as const,
                  result: this.#publishFailure(
                    draft.id,
                    'stale-revision',
                    'The widget draft changed before publication committed.',
                    commitDraft.sourceDigestSha256 ?? currentRevision,
                  ),
                };
              }

              const result = await this.#config.widgets.publishPreview(this.#config.tenant, {
                idempotencyKey: preview.idempotencyKey,
                previewId: preview.previewId,
                previewRevisionId: preview.previewRevisionId,
                canvasId: preview.canvasId,
                frameNodeId: preview.frameNodeId,
                expectedDraftRevisionSha256: currentRevision,
                expectedBindingRevision: preview.expectedBindingRevision,
                expectedBindingPlanDigestSha256:
                  preview.expectedBindingPlanDigestSha256,
                definitionId: draft.definitionId,
                expectedActiveRevisionId: commitDraft.publishedRevisionId,
                revisionId: this.#config.createId(),
                nowMs: this.#now(),
              });
              if (result.status === 'conflict') {
                return {
                  status: 'failed' as const,
                  result: this.#publishFailure(
                    draft.id,
                    'publication-conflict',
                    'Published widget changed before this exact reviewed Preview could be committed.',
                    currentRevision,
                  ),
                };
              }
              return {
                status: 'committed' as const,
                publishedRevisionId: result.revision.id,
                uiRuntime: result.revision.uiRuntime,
              };
            },
          );
          if (fenced.status === 'failed') return fenced.result;
          publishedRevisionId = fenced.publishedRevisionId;
          publishedUiRuntime = fenced.uiRuntime;
        } catch (error) {
          const message = errorMessage(error);
          if (errorCode(error) === 'WIDGET_DRAFT_REVISION_CHANGED') {
            return this.#publishFailure(
              draft.id,
              'stale-revision',
              'The widget draft changed before publication committed.',
              await this.#currentWorkspaceSourceRevision(
                draft.name,
                errorCurrentRevision(error) ?? currentRevision,
              ),
            );
          }
          if (errorCode(error) === 'WIDGET_PREVIEW_PROMOTION_STALE') {
            return this.#publishFailure(
              draft.id,
              'stale-revision',
              message,
              currentRevision,
              [message],
            );
          }
          if (
            errorCode(error) === 'WIDGET_PUBLICATION_IDEMPOTENCY_CONFLICT'
            || errorCode(error) === 'WIDGET_PREVIEW_ALREADY_PUBLISHED'
          ) {
            return this.#publishFailure(
              draft.id,
              'publication-conflict',
              message,
              currentRevision,
              [message],
            );
          }
          return this.#publishFailure(
            draft.id,
            'publication-failed',
            message,
            currentRevision,
            [message],
          );
        }

        // Publication is committed from here onward. Reconciliation and event
        // delivery are best-effort and must never turn a committed response
        // into a false publication failure.
        try {
          await this.#recordPublishedRevision(draft, currentRevision, publishedRevisionId);
        } catch {}
        try {
          this.#config.eventPublisher.publishAgentEvent({
            kind: 'widget-published',
            draftId: draft.id,
            revision: currentRevision,
            definitionName: manifest.manifest.name,
          });
        } catch {}
        return {
          published: true,
          draftId: draft.id,
          definitionId: draft.definitionId,
          revision: currentRevision,
          publishedRevisionId,
          manifest: manifest.manifest,
          uiRuntime: publishedUiRuntime,
        };
      });
    });
  }

  async forget(name: string): Promise<void> {
    const initial = await this.#config.authoringStore.getDraftByName(this.#config.tenant, name);
    if (!initial) return;
    this.#cancelPreviewBuildsForDraft(initial.id);
    await this.#queue(this.#draftOperationKey(initial.id), async () => {
      const draft = await this.#config.authoringStore.getDraft(this.#config.tenant, initial.id);
      if (!draft || draft.status === 'discarded' || draft.name !== name) return;
      const result = await this.#config.authoringStore.discardDraft(this.#config.tenant, {
        draftId: draft.id,
        expectedSourceDigestSha256: draft.sourceDigestSha256,
        nowMs: this.#now(),
      });
      if (result.status !== 'updated') {
        throw controllerError('AGENT_DRAFT_CONFLICT', 'Widget draft changed before it could be discarded.');
      }
      await this.#cleanupDiscardedDraft(draft.id);
    });
  }

  async withDraftDeletion<T>(
    name: string,
    operation: (
      cleanup: () => Promise<void>,
      discardBeforeRemoval: () => Promise<void>,
    ) => Promise<T>,
  ): Promise<T> {
    const initial = await this.#config.authoringStore.getDraftByName(this.#config.tenant, name);
    if (initial) this.#cancelPreviewBuildsForDraft(initial.id);
    return this.#queue(initial ? this.#draftOperationKey(initial.id) : `name:${name}`, async () => {
      const current = initial
        ? await this.#config.authoringStore.getDraft(this.#config.tenant, initial.id)
        : null;
      const draft = current?.status !== 'discarded' && current?.name === name ? current : null;
      const cleanup = async () => {};
      let discarded = false;
      const discardBeforeRemoval = async () => {
        if (discarded) return;
        await cleanup();
        if (!draft) {
          discarded = true;
          return;
        }
        const discardResult = await this.#config.authoringStore.discardDraft(this.#config.tenant, {
          draftId: draft.id,
          expectedSourceDigestSha256: draft.sourceDigestSha256,
          nowMs: this.#now(),
        });
        if (discardResult.status !== 'updated') {
          throw controllerError('AGENT_DRAFT_CONFLICT', 'Widget draft changed before deletion was recorded.');
        }
        await this.#cleanupDiscardedDraft(draft.id);
        discarded = true;
      };
      return operation(cleanup, discardBeforeRemoval);
    });
  }

  async withDraftRename<T>(
    name: string,
    nextName: string,
    operation: (
      cleanup: () => Promise<void>,
      coordinateCommit: (commit: () => Promise<void>) => Promise<void>,
    ) => Promise<T>,
  ): Promise<T> {
    const [initial, target] = await Promise.all([
      this.#config.authoringStore.getDraftByName(this.#config.tenant, name),
      this.#config.authoringStore.getDraftByName(this.#config.tenant, nextName),
    ]);
    const keys = initial
      ? [this.#draftOperationKey(initial.id), ...(target ? [this.#draftOperationKey(target.id)] : [`name:${nextName}`])]
      : [`name:${name}`, ...(target ? [this.#draftOperationKey(target.id)] : [`name:${nextName}`])];
    return this.#queueMany(keys, async () => {
      const current = initial
        ? await this.#config.authoringStore.getDraft(this.#config.tenant, initial.id)
        : null;
      const draft = current?.status !== 'discarded' && current?.name === name ? current : null;
      const cleanup = async () => {};
      let coordinated = false;
      const coordinateCommit = async (commit: () => Promise<void>) => {
        await cleanup();
        await commit();
        if (draft && name !== nextName) {
          const beforeCapture = await this.#config.workspace.getDraft(nextName);
          if (!beforeCapture) {
            throw controllerError('AGENT_DRAFT_RENAME_FAILED', 'Renamed widget source was not found.');
          }
          const copied = await this.#config.workspace
            .createTransientDraftSnapshotAtCoordinatedCommit(
              beforeCapture.name,
              beforeCapture.revision,
            );
          try {
            const snapshot = await this.#config.widgets.captureSource(
              this.#config.tenant,
              copied.rootPath,
              { captureId: this.#config.createId(), createdAtMs: this.#now() },
            );
            const afterCapture = await this.#config.workspace.getDraft(nextName);
            if (!afterCapture || afterCapture.revision !== beforeCapture.revision) {
              throw controllerError(
                'WIDGET_DRAFT_REVISION_CHANGED',
                'Widget draft changed while its rename was being committed.',
              );
            }
            const renamed = await this.#config.authoringStore.renameDraft(this.#config.tenant, {
              draftId: draft.id,
              expectedName: name,
              nextName,
              nextSourceRelativePath: this.#sourceRelativePath(afterCapture),
              expectedSourceDigestSha256: draft.sourceDigestSha256,
              nextSourceDigestSha256: snapshot.digestSha256,
              expectedCommittedMutationId: draft.committedMutationId,
              nextCommittedMutationId: this.#config.createId(),
              expectedBuildSequence: draft.buildSequence,
              nextBuildSequence: draft.buildSequence + 1,
              nowMs: this.#now(),
            });
            if (renamed.status !== 'updated') {
              throw controllerError('AGENT_DRAFT_CONFLICT', 'Widget draft changed before rename was recorded.');
            }
            this.#validationByDraft.delete(draft.id);
            this.#publishDraftEvent('changed', renamed.draft);
          } finally {
            await copied.dispose().catch(() => undefined);
          }
        }
        coordinated = true;
      };
      const result = await operation(cleanup, coordinateCommit);
      if (!coordinated) {
        throw controllerError(
          'AGENT_DRAFT_RENAME_FAILED',
          'Widget draft rename did not use its coordinated commit boundary.',
        );
      }
      return result;
    });
  }

  async #refreshAndSummarize(
    draft: TAgentAuthoringDraftDescriptor,
  ): Promise<TWidgetDraftSummary | null> {
    const workspace = await this.#config.workspace.getDraft(draft.name);
    if (!workspace) return null;
    return this.#summary(draft, workspace);
  }

  async #summary(
    draft: TAgentAuthoringDraftDescriptor,
    workspace: TWidgetDraftWorkspaceEntry,
  ): Promise<TWidgetDraftSummary> {
    const manifest = await this.#readManifest(workspace.draftPath);
    const revision = draft.sourceDigestSha256 ?? workspace.revision;
    const validation = this.#validationForDraft(draft, revision);
    const previewAvailable = manifest.ok && await this.#hasUiEntry(
      workspace.draftPath,
      manifest.manifest.ui.entry,
    );
    const publishReady = validation.status === 'valid'
      && await this.#config.authoringStore.hasConfirmedPreviewExecution(
        this.#config.tenant,
        {
          draftId: draft.id,
          draftRevisionSha256: revision,
          nowMs: this.#now(),
        },
      );
    return {
      draftId: draft.id,
      definitionId: draft.definitionId,
      chatId: draft.chatId,
      name: draft.name,
      displayName: manifest.ok ? manifest.manifest.name : draft.name,
      state: draft.status === 'published'
        ? 'published'
        : draft.publishedRevisionId ? 'modified' : 'new',
      revision,
      committedMutationId: draft.committedMutationId,
      buildSequence: draft.buildSequence,
      publishedRevisionId: draft.publishedRevisionId,
      updatedAt: new Date(draft.updatedAtMs).toISOString(),
      validation,
      previewAvailable,
      publishReady,
    };
  }

  async #validateCaptured(
    draft: TAgentAuthoringDraftDescriptor,
    captured: TCapturedDraft,
    options: Readonly<{ skipTrustedBuild?: boolean }> = {},
  ): Promise<TValidationResult> {
    const validation = await txValidateWidgetFiles(
      { readdir, readFile, writeFile, rm, execFile, join, relative },
      { cwd: captured.rootPath },
    );
    const manifest = await this.#readManifest(captured.rootPath);
    if (manifest.ok && manifest.manifest.name !== draft.name) {
      validation.ok = false;
      validation.errors.push(
        `Draft identity is '${draft.name}', but vibecanvas.json declares '${manifest.manifest.name}'.`,
      );
    }
    if (validation.ok && manifest.ok && options.skipTrustedBuild !== true) {
      try {
        const trusted = await this.#config.widgets.validateBuild(this.#config.tenant, {
          draftId: draft.id,
          snapshot: captured.snapshot,
          manifest: manifest.manifest,
        });
        if (!trusted.valid) {
          validation.ok = false;
          validation.errors.push(...trusted.diagnostics.slice(0, 40));
        }
      } catch (error) {
        validation.ok = false;
        validation.errors.push(errorMessage(error));
      }
    }
    const errors = validation.errors.slice(0, 40);
    const warnings = validation.warnings.slice(0, 40);
    this.#validationByDraft.set(draft.id, {
      revision: captured.snapshot.digestSha256,
      ok: validation.ok,
      errors,
      warnings,
    });
    const transitioned = await this.#config.authoringStore.compareAndSetDraft(this.#config.tenant, {
      draftId: draft.id,
      expectedSourceDigestSha256: captured.snapshot.digestSha256,
      nextSourceDigestSha256: captured.snapshot.digestSha256,
      expectedCommittedMutationId: draft.committedMutationId,
      nextCommittedMutationId: draft.committedMutationId!,
      expectedBuildSequence: draft.buildSequence,
      nextBuildSequence: draft.buildSequence,
      nextStatus: validation.ok ? 'ready' : 'error',
      lastError: validation.ok ? null : this.#validationError({ ok: false, errors, warnings }),
      nowMs: this.#now(),
    });
    if (transitioned.status !== 'updated') {
      throw controllerError('AGENT_DRAFT_CONFLICT', 'Widget draft changed while validation was finishing.');
    }
    this.#publishDraftEvent('validated', transitioned.draft);
    return { ok: validation.ok, errors, warnings };
  }

  #previewReady(preview: TWidgetPreviewBuildResult): TWidgetPreviewResult {
    try {
      const uiArtifact = preview.uiArtifact;
      if (
        uiArtifact.bytes.byteLength < 1
        || uiArtifact.bytes.byteLength > WIDGET_UI_ARTIFACT_MAX_BYTES
      ) throw controllerError('WIDGET_PREVIEW_ARTIFACT_INVALID', 'Preview UI artifact exceeds its safe size limit.');
      const bytes = uiArtifact.bytes;
      if (createHash('sha256').update(bytes).digest('hex') !== uiArtifact.digestSha256) {
        throw controllerError('WIDGET_PREVIEW_ARTIFACT_INVALID', 'Preview UI artifact integrity verification failed.');
      }
      if (uiArtifact.builderIdentity !== preview.builderIdentity) {
        throw controllerError('WIDGET_PREVIEW_ARTIFACT_INVALID', 'Preview UI artifact identity is inconsistent.');
      }
      const runtimeDescriptor = ZWidgetCapsuleRuntimeDescriptor.parse(
        uiArtifact.runtimeDescriptor,
      );
      const serverDescriptors = ZWidgetServerFunctionDescriptors.parse(
        preview.functionDescriptors,
      );
      const descriptorValidation = fnValidateWidgetServerFunctionDescriptors(
        preview.manifest,
        serverDescriptors,
      );
      if (!descriptorValidation.valid) {
        throw controllerError(
          'WIDGET_PREVIEW_ARTIFACT_INVALID',
          'Preview server-function descriptors are invalid.',
        );
      }
      const persistedFunctionDigestSha256 = createHash('sha256')
        .update(fnCanonicalizeWidgetServerFunctionDescriptors(serverDescriptors))
        .digest('hex');
      if (
        persistedFunctionDigestSha256
        !== preview.functionDescriptorsDigestSha256
      ) {
        throw controllerError(
          'WIDGET_PREVIEW_ARTIFACT_INVALID',
          'Preview server-function descriptor integrity verification failed.',
        );
      }
      const browserDescriptors = ZWidgetBrowserFunctionDescriptors.parse(
        fnProjectWidgetBrowserFunctionDescriptors(serverDescriptors),
      );
      const browserFunctionDescriptorsDigestSha256 = createHash('sha256')
        .update(fnCanonicalizeWidgetBrowserFunctionDescriptors(browserDescriptors))
        .digest('hex');
      if (!fnWidgetServerFunctionCapabilityRequestMatches(
        browserFunctionDescriptorsDigestSha256,
        browserDescriptors,
        runtimeDescriptor.capabilityRequests,
      )) {
        throw controllerError(
          'WIDGET_PREVIEW_ARTIFACT_INVALID',
          'Preview server-function descriptors do not match the signed runtime request.',
        );
      }
      const ready: TWidgetPreviewReady = {
        ready: true,
        draftId: preview.draftId,
        definitionId: preview.definitionId,
        previewId: preview.previewId,
        previewRevisionId: preview.previewRevisionId,
        buildSequence: preview.buildSequence,
        bindingRevision: preview.bindingRevision,
        bindingPlanDigestSha256: preview.bindingPlanDigestSha256,
        name: preview.manifest.name,
        revision: preview.draftRevisionSha256,
        committedMutationId: preview.committedMutationId,
        manifest: preview.manifest,
        uiArtifact: {
          digestSha256: uiArtifact.digestSha256,
          byteSize: bytes.byteLength,
          bytesBase64: Buffer.from(bytes).toString('base64'),
          runtimeDescriptor,
        },
        contract: {
          digestSha256: preview.contractDigestSha256,
          functions: browserDescriptors,
          browserFunctionDescriptorsDigestSha256,
        },
        diagnostics: preview.normalizedDiagnostics.slice(0, 20),
      };
      return ready;
    } catch (error) {
      const message = errorMessage(error);
      return this.#previewFailure(preview.draftId, 'artifact-unavailable', message, {
        revision: preview.draftRevisionSha256,
        diagnostics: [message],
      });
    }
  }

  async #ensureDurableDraft(
    captured: TCapturedDraft,
    chatExternalKey?: string,
  ): Promise<TAgentAuthoringDraftDescriptor | null> {
    const existing = await this.#config.authoringStore.getDraftByName(
      this.#config.tenant,
      captured.workspace.name,
    );
    if (existing) return existing;
    if (!chatExternalKey) return null;
    let chat = await this.#config.authoringStore.getChatByExternalSessionKey(
      this.#config.tenant,
      chatExternalKey,
    );
    if (!chat) {
      try {
        chat = await this.#config.authoringStore.createChat(this.#config.tenant, {
          id: this.#config.createId(),
          canvasId: this.#config.tenant.canvasId ?? null,
          externalSessionKey: chatExternalKey,
          name: chatExternalKey,
          workspaceRelativePath: relative(
            this.#config.workspace.agentRoot,
            this.#config.workspace.getChatRoot(chatExternalKey),
          ),
          historyRelativePath: relative(
            this.#config.workspace.agentRoot,
            this.#config.workspace.getChatHistoryRoot(chatExternalKey),
          ),
          nowMs: this.#now(),
        });
      } catch {
        chat = await this.#config.authoringStore.getChatByExternalSessionKey(
          this.#config.tenant,
          chatExternalKey,
        );
      }
    }
    if (!chat) throw controllerError('AGENT_CHAT_CREATE_FAILED', 'Agent chat could not be created.');
    try {
      return await this.#config.authoringStore.createDraft(this.#config.tenant, {
        id: this.#config.createId(),
        chatId: chat.id,
        definitionId: this.#config.createId(),
        name: captured.workspace.name,
        sourceRelativePath: this.#sourceRelativePath(captured.workspace),
        nowMs: this.#now(),
      });
    } catch {
      const raced = await this.#config.authoringStore.getDraftByName(
        this.#config.tenant,
        captured.workspace.name,
      );
      if (raced) return raced;
      throw controllerError('AGENT_DRAFT_CREATE_FAILED', 'Widget draft metadata could not be created.');
    }
  }

  async #compareAndSetDraft(
    draft: TAgentAuthoringDraftDescriptor,
    nextDigest: string,
    args: Readonly<{
      status: TAgentAuthoringDraftDescriptor['status'];
      lastError?: Readonly<Record<string, unknown>> | null;
      committedMutationId?: string;
    }>,
  ): Promise<TAgentAuthoringDraftDescriptor | null> {
    if (draft.status === 'discarded') return null;
    const commitsMutation = args.committedMutationId !== undefined;
    if (
      !commitsMutation
      && (
        draft.sourceDigestSha256 !== nextDigest
        || draft.committedMutationId === null
      )
    ) return null;
    const nextCommittedMutationId = commitsMutation
      ? args.committedMutationId!
      : draft.committedMutationId;
    if (nextCommittedMutationId === null) return null;
    const nextBuildSequence = commitsMutation
      ? draft.buildSequence + 1
      : draft.buildSequence;
    if (!Number.isSafeInteger(nextBuildSequence)) {
      throw controllerError(
        'WIDGET_DRAFT_BUILD_SEQUENCE_EXHAUSTED',
        'Widget draft build sequence is exhausted.',
      );
    }
    if (
      draft.sourceDigestSha256 === nextDigest
      && draft.status === args.status
      && args.lastError === undefined
      && !commitsMutation
    ) return draft;
    const result = await this.#config.authoringStore.compareAndSetDraft(this.#config.tenant, {
      draftId: draft.id,
      expectedSourceDigestSha256: draft.sourceDigestSha256,
      nextSourceDigestSha256: nextDigest,
      expectedCommittedMutationId: draft.committedMutationId,
      nextCommittedMutationId,
      expectedBuildSequence: draft.buildSequence,
      nextBuildSequence,
      nextStatus: args.status,
      ...(args.lastError === undefined ? {} : { lastError: args.lastError }),
      nowMs: this.#now(),
    });
    if (result.status === 'updated') {
      return result.draft.status === 'discarded' ? null : result.draft;
    }
    if (
      result.current
      && result.current.id === draft.id
      && result.current.status !== 'discarded'
      && result.current.sourceDigestSha256 === nextDigest
      && result.current.committedMutationId === nextCommittedMutationId
      && result.current.buildSequence === nextBuildSequence
    ) return result.current;
    return null;
  }

  async #recordPublishedRevision(
    original: TAgentAuthoringDraftDescriptor,
    publishedSourceRevision: string,
    publishedRevisionId: string,
  ): Promise<void> {
    let current = original;
    // Publication is already committed before this metadata transition. Make
    // a bounded best-effort attempt instead of risking an unbounded API call.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (current.id !== original.id || current.definitionId !== original.definitionId) {
        throw controllerError(
          'AGENT_AUTHORING_INTEGRITY_FAILED',
          'Published revision does not belong to the durable widget draft.',
        );
      }
      if (current.status === 'discarded') return;
      if (
        current.sourceDigestSha256 === null
        || current.committedMutationId === null
        || current.buildSequence < 1
      ) {
        throw controllerError(
          'AGENT_AUTHORING_INTEGRITY_FAILED',
          'Published widget draft has no committed source-mutation fence.',
        );
      }
      const sourceAdvanced = current.sourceDigestSha256 !== publishedSourceRevision;
      const result = await this.#config.authoringStore.compareAndSetDraft(this.#config.tenant, {
        draftId: original.id,
        expectedSourceDigestSha256: current.sourceDigestSha256,
        nextSourceDigestSha256: current.sourceDigestSha256,
        expectedCommittedMutationId: current.committedMutationId,
        nextCommittedMutationId: current.committedMutationId,
        expectedBuildSequence: current.buildSequence,
        nextBuildSequence: current.buildSequence,
        nextStatus: sourceAdvanced ? current.status : 'published',
        publishedRevisionId,
        ...(sourceAdvanced ? {} : { lastError: null }),
        nowMs: this.#now(),
      });
      if (result.status === 'updated') return;
      if (!result.current) {
        throw controllerError(
          'AGENT_AUTHORING_INTEGRITY_FAILED',
          'Durable widget draft disappeared after publication committed.',
        );
      }
      current = result.current;
    }
  }

  async #withCapturedWorkspace<T>(
    workspace: TWidgetDraftWorkspaceEntry,
    operation: (captured: TCapturedDraft) => Promise<T>,
  ): Promise<T> {
    const copied = await this.#config.workspace.createTransientDraftSnapshot(
      workspace.name,
      workspace.revision,
    );
    try {
      const snapshot = await this.#config.widgets.captureSource(
        this.#config.tenant,
        copied.rootPath,
        { captureId: this.#config.createId(), createdAtMs: this.#now() },
      );
      return await operation({ workspace, rootPath: copied.rootPath, snapshot });
    } finally {
      await copied.dispose().catch(() => undefined);
    }
  }

  async #currentDraftRevision(
    draft: TAgentAuthoringDraftDescriptor,
  ): Promise<string | null> {
    const workspace = await this.#config.workspace.getDraft(draft.name);
    if (!workspace) return null;
    return this.#withCapturedWorkspace(workspace, async (captured) => {
      const current = await this.#compareAndSetDraft(draft, captured.snapshot.digestSha256, {
        status: draft.sourceDigestSha256 === captured.snapshot.digestSha256
          ? draft.status
          : 'editing',
      });
      return current?.sourceDigestSha256 ?? captured.snapshot.digestSha256;
    });
  }

  async #currentWorkspaceSourceRevision(name: string, fallback: string): Promise<string> {
    const workspace = await this.#config.workspace.getDraft(name).catch(() => null);
    if (!workspace) return fallback;
    try {
      return await this.#withCapturedWorkspace(
        workspace,
        async (captured) => captured.snapshot.digestSha256,
      );
    } catch {
      return fallback;
    }
  }

  #managementChatExternalKey(definitionId: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(definitionId)) {
      throw controllerError('WIDGET_DEFINITION_ID_INVALID', 'Published widget definition identity is invalid.');
    }
    return `widget-management-${definitionId}`;
  }

  #matchesPublicationSeed(
    draft: TAgentAuthoringDraftDescriptor,
    request: Readonly<{
      definitionId: string;
      publishedRevisionId: string;
      snapshot: TWidgetSourceSnapshot;
    }>,
  ): boolean {
    return draft.definitionId === request.definitionId
      && draft.publishedRevisionId === request.publishedRevisionId
      && draft.sourceDigestSha256 === request.snapshot.digestSha256;
  }

  async #mountDurableDraft(draft: TAgentAuthoringDraftDescriptor): Promise<void> {
    const chat = await this.#config.authoringStore.getChat(this.#config.tenant, draft.chatId);
    if (!chat) {
      throw controllerError('AGENT_AUTHORING_INTEGRITY_FAILED', 'Durable widget draft chat is unavailable.');
    }
    await this.#config.workspace.ensureChat(chat.externalSessionKey);
    await this.#config.workspace.loadWidget(chat.externalSessionKey, draft.name);
  }

  async #activeDraft(draftId: string): Promise<TAgentAuthoringDraftDescriptor | null> {
    const draft = await this.#config.authoringStore.getDraft(this.#config.tenant, draftId);
    return draft && draft.status !== 'discarded' ? draft : null;
  }

  async #readManifest(
    root: string,
  ): Promise<{ ok: true; manifest: TWidgetManifestV3 } | { ok: false; message: string }> {
    try {
      const source = JSON.parse(await readFile(join(root, 'vibecanvas.json'), 'utf8'));
      const parsed = ZWidgetManifestV3.safeParse(source);
      if (!parsed.success) {
        return {
          ok: false,
          message: parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; '),
        };
      }
      return { ok: true, manifest: parsed.data };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  }

  async #hasUiEntry(root: string, entry: string): Promise<boolean> {
    const candidate = resolve(root, entry);
    const rel = relative(resolve(root), candidate);
    if (rel.startsWith('..') || isAbsolute(rel)) return false;
    return Boolean((await stat(candidate).catch(() => null))?.isFile());
  }

  #validationForDraft(
    draft: TAgentAuthoringDraftDescriptor,
    revision: string,
  ): TWidgetDraftSummary['validation'] {
    const cached = this.#validationByDraft.get(draft.id);
    if (cached?.revision === revision) {
      return {
        status: cached.ok ? 'valid' : 'invalid',
        errors: cached.errors,
        warnings: cached.warnings,
        validatedRevision: revision,
      };
    }
    if (
      draft.sourceDigestSha256 === revision
      && (draft.status === 'ready' || draft.status === 'published')
    ) {
      return { status: 'valid', errors: [], warnings: [], validatedRevision: revision };
    }
    if (draft.sourceDigestSha256 === revision && draft.status === 'error') {
      const errors = Array.isArray(draft.lastError?.errors)
        ? draft.lastError.errors.filter((value): value is string => typeof value === 'string').slice(0, 40)
        : [];
      const warnings = Array.isArray(draft.lastError?.warnings)
        ? draft.lastError.warnings.filter((value): value is string => typeof value === 'string').slice(0, 40)
        : [];
      return { status: 'invalid', errors, warnings, validatedRevision: revision };
    }
    return { status: 'unknown', errors: [], warnings: [] };
  }

  #validationError(validation: TValidationResult): Readonly<Record<string, unknown>> {
    return Object.freeze({
      kind: 'validation',
      errors: validation.errors.slice(0, 40),
      warnings: validation.warnings.slice(0, 40),
    });
  }

  #sourceRelativePath(workspace: TWidgetDraftWorkspaceEntry): string {
    const value = relative(this.#config.workspace.agentRoot, workspace.draftPath);
    if (!value || value.startsWith('..') || isAbsolute(value)) {
      throw controllerError('AGENT_DRAFT_PATH_INVALID', 'Widget draft path is outside the agent workspace.');
    }
    return value.split('\\').join('/');
  }

  #previewFailure(
    draftId: string,
    reason: TWidgetPreviewFailureReason,
    message: string,
    details: Readonly<{
      revision?: string;
      diagnostics?: readonly string[];
    }> = {},
  ): Exclude<TWidgetPreviewResult, { ready: true }> {
    return {
      ready: false,
      draftId,
      ...details,
      reason,
      message,
      diagnostics: details.diagnostics ?? [],
    };
  }

  #publishFailure(
    draftId: string,
    reason: Exclude<TWidgetPublishResult, { published: true }>['reason'],
    message: string,
    currentRevision?: string,
    errors: readonly string[] = [],
    warnings: readonly string[] = [],
  ): Exclude<TWidgetPublishResult, { published: true }> {
    return {
      published: false,
      draftId,
      reason,
      message,
      ...(currentRevision === undefined ? {} : { currentRevision }),
      errors,
      warnings,
    };
  }

  #publishDraftEvent(
    type: 'created' | 'changed' | 'validated',
    draft: TAgentAuthoringDraftDescriptor,
  ): void {
    if (
      draft.sourceDigestSha256 === null
      || draft.committedMutationId === null
    ) return;
    try {
      this.#config.eventPublisher.publishAgentEvent({
        kind: 'widget-draft',
        type,
        draftId: draft.id,
        revision: draft.sourceDigestSha256,
        sourceDigestSha256: draft.sourceDigestSha256,
        committedMutationId: draft.committedMutationId,
        buildSequence: draft.buildSequence,
      });
    } catch {}
  }

  #clearSupersededPreviewBuild(
    owner: TWidgetPreviewOwnerDescriptor,
    buildId: string,
    draftRevision: string,
  ): Promise<TWidgetPreviewOwnerDescriptor | null> {
    const hasLastGood = owner.activeRevisionId !== null;
    return this.#config.authoringStore.compareAndSetPreviewOwner(
      this.#config.tenant,
      {
        previewId: owner.id,
        expectedBuildSequence: owner.buildSequence,
        expectedStatus: 'building',
        expectedPendingBuildId: buildId,
        nextBuildSequence: owner.buildSequence,
        status: hasLastGood ? 'ready' : 'failed',
        pendingBuildId: null,
        lastError: hasLastGood
          ? null
          : {
              code: 'WIDGET_BUILD_SUPERSEDED',
              message: 'Preview build was superseded.',
              draftRevision,
              buildId,
            },
        nowMs: this.#now(),
      },
    );
  }

  async #cleanupDiscardedDraft(draftId: string): Promise<void> {
    const owners = await this.#config.authoringStore.listPreviewOwners(
      this.#config.tenant,
      { draftId, includeClosed: true },
    );
    this.#clearPreviewBuildsForDraft(
      draftId,
      owners.map((owner) => owner.id),
    );
    for (const owner of owners) {
      this.#previewDiagnosticRateByOwner.delete(owner.id);
    }
    this.#validationByDraft.delete(draftId);
    await this.#config.widgets.closePreviewWorkspace(this.#config.tenant, {
      draftId,
    });
  }

  #rememberPreviewBuildKey(draftId: string, coordinatorKey: string): void {
    const keys = this.#previewBuildKeysByDraft.get(draftId) ?? new Set<string>();
    keys.add(coordinatorKey);
    this.#previewBuildKeysByDraft.set(draftId, keys);
  }

  #forgetPreviewBuildKey(draftId: string, coordinatorKey: string): void {
    const keys = this.#previewBuildKeysByDraft.get(draftId);
    if (!keys) return;
    keys.delete(coordinatorKey);
    if (keys.size === 0) this.#previewBuildKeysByDraft.delete(draftId);
  }

  #admitPreviewDiagnostic(previewId: string): void {
    const nowMs = this.#now();
    const current = this.#previewDiagnosticRateByOwner.get(previewId);
    if (
      current === undefined
      || nowMs - current.windowStartedAtMs >= WIDGET_PREVIEW_DIAGNOSTIC_RATE_WINDOW_MS
    ) {
      this.#previewDiagnosticRateByOwner.set(previewId, {
        count: 1,
        windowStartedAtMs: nowMs,
      });
      return;
    }
    if (current.count >= WIDGET_PREVIEW_DIAGNOSTIC_RATE_MAX_REPORTS) {
      throw controllerError(
        'WIDGET_PREVIEW_DIAGNOSTIC_RATE_LIMITED',
        'Preview diagnostic report rate exceeded.',
      );
    }
    current.count += 1;
  }

  async #clearPreviewRuntimeDiagnostic(
    request: Readonly<{
      previewId: string;
      canvasId: string;
      frameNodeId: string;
      previewRevisionId: string;
      fingerprint: string;
      operation?: string;
    }>,
    retest: boolean,
  ): Promise<TWidgetPreviewOwnerDescriptor> {
    const owner = await this.getPreviewOwner(request);
    if (owner === null || owner.status === 'closed') {
      throw controllerError(
        'WIDGET_PREVIEW_DIAGNOSTIC_SCOPE_INVALID',
        'Preview diagnostic does not match an open frame owner.',
      );
    }
    const index = owner.runtimeDiagnostics.findIndex((record) => (
      record.diagnostic.previewRevisionId === request.previewRevisionId
      && record.diagnostic.fingerprint === request.fingerprint
    ));
    if (index < 0) {
      throw controllerError(
        'WIDGET_PREVIEW_DIAGNOSTIC_STALE',
        'Preview diagnostic is no longer awaiting a retest or resolution.',
      );
    }
    const selected = owner.runtimeDiagnostics[index]!;
    if (retest) {
      if (
        owner.activeRevisionId !== request.previewRevisionId
        || selected.diagnostic.operation === undefined
        || selected.diagnostic.operation !== request.operation
      ) {
        throw controllerError(
          selected.diagnostic.operation === undefined
            ? 'WIDGET_PREVIEW_DIAGNOSTIC_RETEST_UNAVAILABLE'
            : 'WIDGET_PREVIEW_DIAGNOSTIC_STALE',
          selected.diagnostic.operation === undefined
            ? 'This Preview diagnostic has no trustworthy interaction-success class.'
            : 'Preview interaction success does not match the active diagnostic fence.',
        );
      }
    }
    const remaining = owner.runtimeDiagnostics.filter(
      (_record, recordIndex) => recordIndex !== index,
    );
    const activeStillFailed = remaining.some(
      (record) => record.diagnostic.previewRevisionId === owner.activeRevisionId,
    );
    const mayReturnReady = (
      owner.status === 'failed'
      && owner.lastError === null
      && owner.activeRevisionId !== null
      && !activeStillFailed
    );
    const updated = await this.#config.authoringStore.compareAndSetPreviewOwner(
      this.#config.tenant,
      {
        previewId: owner.id,
        expectedBuildSequence: owner.buildSequence,
        expectedStatus: owner.status,
        expectedPendingBuildId: owner.pendingBuildId,
        nextBuildSequence: owner.buildSequence,
        status: mayReturnReady ? 'ready' : owner.status,
        activeRevisionId: owner.activeRevisionId,
        pendingBuildId: owner.pendingBuildId,
        runtimeDiagnostics: remaining,
        nowMs: this.#now(),
      },
    );
    if (updated === null) {
      throw controllerError(
        'WIDGET_PREVIEW_DIAGNOSTIC_CONFLICT',
        'Preview changed before its diagnostic could be resolved.',
      );
    }
    return updated;
  }

  #boundedPreviewRuntimeDiagnostics(
    diagnostics: readonly TWidgetPreviewRuntimeDiagnosticRecord[],
  ): readonly TWidgetPreviewRuntimeDiagnosticRecord[] {
    const retained: TWidgetPreviewRuntimeDiagnosticRecord[] = [];
    for (
      let index = diagnostics.length - 1;
      index >= 0 && retained.length < WIDGET_PREVIEW_DIAGNOSTIC_MAX_COUNT;
      index -= 1
    ) {
      const candidate = [diagnostics[index]!, ...retained];
      if (
        Buffer.byteLength(JSON.stringify(candidate), 'utf8')
        > WIDGET_PREVIEW_DIAGNOSTIC_MAX_BYTES
      ) continue;
      retained.unshift(diagnostics[index]!);
    }
    return retained;
  }

  #cancelPreviewBuildsForDraft(draftId: string): void {
    this.#previewBuilds.cancel(draftId);
    for (const key of this.#previewBuildKeysByDraft.get(draftId) ?? []) {
      this.#previewBuilds.cancel(key);
    }
  }

  #clearPreviewBuildsForDraft(
    draftId: string,
    ownerIds: readonly string[] = [],
  ): void {
    const keys = new Set([
      draftId,
      ...(this.#previewBuildKeysByDraft.get(draftId) ?? []),
      ...ownerIds,
    ]);
    for (const key of keys) this.#previewBuilds.clear(key);
    for (const ownerId of ownerIds) {
      this.#previewBuildFencesByOwner.delete(ownerId);
    }
    this.#previewBuildKeysByDraft.delete(draftId);
  }

  #publishPreviewProgress(args: Readonly<{
    owner: TWidgetPreviewOwnerDescriptor;
    draftRevision: string;
    buildId: string;
    phase: TPreviewBuildProgressPhase;
  }>): void {
    if (
      args.owner.sourceDigestSha256 === null
      || args.owner.committedMutationId === null
      || args.owner.sourceDigestSha256 !== args.draftRevision
    ) return;
    try {
      this.#config.eventPublisher.publishAgentEvent({
        kind: 'widget-preview',
        type: 'progress',
        draftId: args.owner.draftId,
        revision: args.draftRevision,
        sourceDigestSha256: args.owner.sourceDigestSha256,
        committedMutationId: args.owner.committedMutationId,
        previewId: args.owner.id,
        buildId: args.buildId,
        buildSequence: args.owner.buildSequence,
        phase: args.phase,
      });
    } catch {}
  }

  #now(): number {
    const value = this.#config.nowMs();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError('Widget authoring clock returned an invalid timestamp.');
    }
    return value;
  }

  #queue<T>(key: string, operation: () => Promise<T>): Promise<T> {
    return this.#queueMany([key], operation);
  }

  #queueMany<T>(keys: readonly string[], operation: () => Promise<T>): Promise<T> {
    const uniqueKeys = [...new Set(keys)].sort();
    const previous = Promise.all(uniqueKeys.map((key) => (
      this.#operations.get(key)?.catch(() => undefined) ?? Promise.resolve()
    )));
    const current = previous.then(operation);
    const tracked = current.finally(() => {
      for (const key of uniqueKeys) {
        if (this.#operations.get(key) === tracked) this.#operations.delete(key);
      }
    });
    for (const key of uniqueKeys) this.#operations.set(key, tracked);
    return tracked;
  }

  #draftOperationKey(draftId: string): string {
    return `draft:${draftId}`;
  }
}
