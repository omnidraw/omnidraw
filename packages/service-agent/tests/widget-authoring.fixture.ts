import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import type { TTenantContext } from '@omnidraw/tenant-core';
import {
  fnCanonicalizeWidgetBrowserFunctionDescriptors,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnNormalizeWidgetBuildDiagnostics,
  fnProjectWidgetBrowserFunctionDescriptors,
  fnWidgetPreviewBindingPlanDigest,
  type TWidgetArtifactDescriptor,
  type TWidgetBuildDiagnostic,
  type TWidgetCapsuleBuildIdentity,
  type TWidgetCapsuleRuntimeDescriptor,
  type TWidgetCapsuleUiArtifact,
  type TWidgetManifestV3,
  type TWidgetPreviewBuildRequest,
  type TWidgetPreviewBuildResult,
  type TWidgetPublishRequest,
  type TWidgetResourceBindingInput,
  type TWidgetRevisionDescriptor,
  type TWidgetRevisionSourceDescriptor,
  type TWidgetServerFunctionDescriptor,
  type TWidgetSourceSnapshot,
} from '@omnidraw/widget-contract';
import { WidgetSourceSnapshot } from '@omnidraw/widget-contract/local';
import { WidgetDraftController } from '../src/widget-drafts/WidgetDraftController';
import type {
  IAgentAuthoringStore,
  TAgentAuthoringChatDescriptor,
  TAgentAuthoringDraftDescriptor,
  TWidgetAuthoringCapability,
  TWidgetPreviewOwnerDescriptor,
} from '../src/widget-drafts/types';
import { WidgetWorkspace } from '../src/workspace/WidgetWorkspace';
import { TEST_TENANT, createTestTenantEvents } from './tenant.fixture';
import type { ITenantEventPublisherService } from '@omnidraw/service-event-publisher/IEventPublisherService';

function digest(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export const TEST_CAPSULE_BUILD_IDENTITY: TWidgetCapsuleBuildIdentity = Object.freeze({
  packageName: '@omnidraw/capsule',
  packageVersion: '0.10.1',
  packageDigest: `sha256:${'a'.repeat(64)}`,
  buildApiVersion: '0.1.0',
  runtimeBuildDigest: `sha256:${'b'.repeat(64)}`,
});

export const TEST_CAPSULE_BUILD_POLICY_ID = 'test-omnidraw-capsule-widget-v2';

const SERVER_FUNCTION: TWidgetServerFunctionDescriptor = Object.freeze({
  schemaVersion: 1,
  exportName: 'lookup',
  modulePath: 'server/main.ts',
  effect: 'fn',
  inputSchema: Object.freeze({ type: 'object', additionalProperties: false }),
  outputSchema: Object.freeze({ type: 'object', additionalProperties: false }),
  resources: Object.freeze([]),
  limits: Object.freeze({
    timeoutMs: 5_000,
    memoryTier: 'small',
    outputByteLimit: 262_144,
    logByteLimit: 65_536,
  }),
  retry: Object.freeze({
    mode: 'none',
    maxAttempts: 1,
    initialBackoffMs: 0,
    maxBackoffMs: 0,
  }),
});

function serverFunctions(
  manifest: TWidgetManifestV3,
): readonly TWidgetServerFunctionDescriptor[] {
  return manifest.server ? Object.freeze([SERVER_FUNCTION]) : Object.freeze([]);
}

function serverFunctionDigest(
  descriptors: readonly TWidgetServerFunctionDescriptor[],
): string {
  return createHash('sha256')
    .update(fnCanonicalizeWidgetServerFunctionDescriptors(descriptors))
    .digest('hex');
}

function browserFunctionDigest(
  descriptors: readonly TWidgetServerFunctionDescriptor[],
): string {
  return createHash('sha256')
    .update(fnCanonicalizeWidgetBrowserFunctionDescriptors(
      fnProjectWidgetBrowserFunctionDescriptors(descriptors),
    ))
    .digest('hex');
}

export class MemoryAuthoringStore implements IAgentAuthoringStore {
  readonly chats = new Map<string, TAgentAuthoringChatDescriptor>();
  readonly drafts = new Map<string, TAgentAuthoringDraftDescriptor>();
  readonly previewOwners = new Map<string, TWidgetPreviewOwnerDescriptor>();
  conflictPublishedCasWithAdvancedSource = false;
  alwaysConflictPublishedCas = false;
  throwPublishedCasError = false;
  publishedCasAttempts = 0;
  publishedCasConflicts = 0;
  getDraftFailuresRemaining = 0;
  conflictRenameDraft = false;
  throwRenameDraftError = false;
  beforeRenameDraft: (() => Promise<void>) | null = null;
  conflictDiscardDraft = false;
  throwDiscardDraftError = false;

  async createChat(
    tenant: TTenantContext,
    request: Parameters<IAgentAuthoringStore['createChat']>[1],
  ): Promise<TAgentAuthoringChatDescriptor> {
    const chat: TAgentAuthoringChatDescriptor = {
      orgId: tenant.orgId,
      accountId: tenant.accountId,
      id: request.id,
      canvasId: request.canvasId,
      externalSessionKey: request.externalSessionKey,
      name: request.name,
      status: 'active',
      workspaceRelativePath: request.workspaceRelativePath,
      historyRelativePath: request.historyRelativePath,
      createdAtMs: request.nowMs,
      updatedAtMs: request.nowMs,
    };
    this.chats.set(chat.id, chat);
    return chat;
  }

  async ensurePreviewOwner(
    tenant: TTenantContext,
    request: Parameters<IAgentAuthoringStore['ensurePreviewOwner']>[1],
  ): Promise<TWidgetPreviewOwnerDescriptor> {
    const draft = await this.getDraft(tenant, request.draftId);
    const chat = await this.getChat(tenant, request.originChatId);
    if (!draft || draft.status === 'discarded' || !chat || draft.chatId !== chat.id) {
      throw new Error('Preview owner does not match its durable draft and chat.');
    }
    const existing = this.previewOwners.get(request.id);
    if (existing) {
      if (
        existing.accountId !== tenant.accountId
        || existing.canvasId !== request.canvasId
        || existing.frameNodeId !== request.frameNodeId
        || existing.draftId !== request.draftId
        || existing.originChatId !== request.originChatId
        || existing.role !== request.role
        || existing.status === 'closed'
      ) throw new Error('Preview owner identity conflict.');
      return existing;
    }
    const frameOwner = [...this.previewOwners.values()].find((owner) => (
      owner.orgId === tenant.orgId
      && owner.canvasId === request.canvasId
      && owner.frameNodeId === request.frameNodeId
      && owner.status !== 'closed'
    ));
    if (frameOwner) throw new Error('Preview frame already has a different owner.');
    if (request.role === 'companion') {
      const companion = [...this.previewOwners.values()].find((owner) => (
        owner.orgId === tenant.orgId
        && owner.accountId === tenant.accountId
        && owner.draftId === request.draftId
        && owner.originChatId === request.originChatId
        && owner.role === 'companion'
        && owner.status !== 'closed'
      ));
      if (companion) return companion;
    }
    const owner: TWidgetPreviewOwnerDescriptor = {
      orgId: tenant.orgId,
      id: request.id,
      accountId: tenant.accountId,
      canvasId: request.canvasId,
      frameNodeId: request.frameNodeId,
      draftId: request.draftId,
      originChatId: request.originChatId,
      role: request.role,
      status: 'queued',
      activeRevisionId: null,
      pendingBuildId: null,
      buildSequence: 0,
      bindingRevision: 0,
      bindingPlanDigestSha256: null,
      sourceDigestSha256: null,
      committedMutationId: null,
      runtimeDiagnostics: [],
      publishedPreviewRevisionId: null,
      publishedBindingRevision: null,
      publishedBindingPlanDigestSha256: null,
      publishedWidgetRevisionId: null,
      publishedIdempotencyKey: null,
      lastError: null,
      createdAtMs: request.nowMs,
      updatedAtMs: request.nowMs,
      closedAtMs: null,
    };
    this.previewOwners.set(owner.id, owner);
    return owner;
  }

  async getPreviewOwner(
    tenant: TTenantContext,
    previewId: string,
  ): Promise<TWidgetPreviewOwnerDescriptor | null> {
    const owner = this.previewOwners.get(previewId);
    return owner?.orgId === tenant.orgId && owner.accountId === tenant.accountId
      ? owner
      : null;
  }

  async listPreviewOwners(
    tenant: TTenantContext,
    request: Parameters<IAgentAuthoringStore['listPreviewOwners']>[1] = {},
  ): Promise<readonly TWidgetPreviewOwnerDescriptor[]> {
    return [...this.previewOwners.values()].filter((owner) => (
      owner.orgId === tenant.orgId
      && owner.accountId === tenant.accountId
      && (request?.draftId === undefined || owner.draftId === request.draftId)
      && (request?.includeClosed === true || owner.status !== 'closed')
    ));
  }

  async compareAndSetPreviewOwner(
    tenant: TTenantContext,
    request: Parameters<IAgentAuthoringStore['compareAndSetPreviewOwner']>[1],
  ): Promise<TWidgetPreviewOwnerDescriptor | null> {
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
        request.expectedBindingRevision !== undefined
        && (
          current.bindingRevision !== request.expectedBindingRevision
          || current.bindingPlanDigestSha256
            !== request.expectedBindingPlanDigestSha256
        )
      )
      || (
        request.expectedSourceDigestSha256 !== undefined
        && (
          current.sourceDigestSha256 !== request.expectedSourceDigestSha256
          || current.committedMutationId !== request.expectedCommittedMutationId
        )
      )
      || request.nextBuildSequence < request.expectedBuildSequence
    ) return null;
    const next: TWidgetPreviewOwnerDescriptor = {
      ...current,
      status: request.status,
      buildSequence: request.nextBuildSequence,
      activeRevisionId: request.activeRevisionId === undefined
        ? current.activeRevisionId
        : request.activeRevisionId,
      pendingBuildId: request.pendingBuildId === undefined
        ? current.pendingBuildId
        : request.pendingBuildId,
      bindingRevision: request.nextBindingRevision
        ?? current.bindingRevision,
      bindingPlanDigestSha256:
        request.nextBindingPlanDigestSha256 === undefined
          ? current.bindingPlanDigestSha256
          : request.nextBindingPlanDigestSha256,
      sourceDigestSha256: request.nextSourceDigestSha256 === undefined
        ? current.sourceDigestSha256
        : request.nextSourceDigestSha256,
      committedMutationId: request.nextCommittedMutationId === undefined
        ? current.committedMutationId
        : request.nextCommittedMutationId,
      runtimeDiagnostics: request.runtimeDiagnostics ?? current.runtimeDiagnostics,
      lastError: request.lastError === undefined ? current.lastError : request.lastError,
      updatedAtMs: request.nowMs,
    };
    this.previewOwners.set(next.id, next);
    return next;
  }

  async closePreviewOwner(
    tenant: TTenantContext,
    request: Parameters<IAgentAuthoringStore['closePreviewOwner']>[1],
  ): Promise<boolean> {
    const current = await this.getPreviewOwner(tenant, request.previewId);
    if (!current || current.frameNodeId !== request.frameNodeId) return false;
    if (current.status === 'closed') return true;
    this.previewOwners.set(current.id, {
      ...current,
      status: 'closed',
      activeRevisionId: null,
      pendingBuildId: null,
      updatedAtMs: request.nowMs,
      closedAtMs: request.nowMs,
    });
    return true;
  }

  async acquirePreviewMountLease(
    _tenant: TTenantContext,
    _request: Parameters<IAgentAuthoringStore['acquirePreviewMountLease']>[1],
  ): ReturnType<IAgentAuthoringStore['acquirePreviewMountLease']> {
    return null;
  }

  async renewPreviewMountLease(
    _tenant: TTenantContext,
    _request: Parameters<IAgentAuthoringStore['renewPreviewMountLease']>[1],
  ): ReturnType<IAgentAuthoringStore['renewPreviewMountLease']> {
    return null;
  }

  async releasePreviewMountLease(
    _tenant: TTenantContext,
    _request: Parameters<IAgentAuthoringStore['releasePreviewMountLease']>[1],
  ): ReturnType<IAgentAuthoringStore['releasePreviewMountLease']> {
    return false;
  }

  async hasConfirmedPreviewExecution(
    _tenant: TTenantContext,
    _request: Parameters<IAgentAuthoringStore['hasConfirmedPreviewExecution']>[1],
  ): ReturnType<IAgentAuthoringStore['hasConfirmedPreviewExecution']> {
    return false;
  }

  async getChatByExternalSessionKey(
    tenant: TTenantContext,
    externalSessionKey: string,
  ): Promise<TAgentAuthoringChatDescriptor | null> {
    return [...this.chats.values()].find((chat) => (
      chat.orgId === tenant.orgId
      && chat.accountId === tenant.accountId
      && chat.externalSessionKey === externalSessionKey
    )) ?? null;
  }

  async getChat(
    tenant: TTenantContext,
    chatId: string,
  ): Promise<TAgentAuthoringChatDescriptor | null> {
    const chat = this.chats.get(chatId);
    return chat?.orgId === tenant.orgId && chat.accountId === tenant.accountId
      ? chat
      : null;
  }

  async createDraft(
    tenant: TTenantContext,
    request: Parameters<IAgentAuthoringStore['createDraft']>[1],
  ): Promise<TAgentAuthoringDraftDescriptor> {
    const duplicate = await this.getDraftByName(tenant, request.name);
    if (duplicate) throw new Error(`Active draft '${request.name}' already exists.`);
    const publicationSeed = request.publicationSeed;
    const existingPath = [...this.drafts.values()].find((draft) => (
      draft.orgId === tenant.orgId
      && draft.chatId === request.chatId
      && draft.sourceRelativePath === request.sourceRelativePath
    ));
    if (existingPath) {
      if (existingPath.status !== 'discarded') throw new Error('Active draft source path already exists.');
      const revived: TAgentAuthoringDraftDescriptor = {
        ...existingPath,
        definitionId: publicationSeed?.definitionId ?? existingPath.definitionId,
        publishedRevisionId: publicationSeed?.publishedRevisionId ?? existingPath.publishedRevisionId,
        name: request.name,
        status: publicationSeed ? 'published' : 'editing',
        sourceDigestSha256: publicationSeed?.sourceDigestSha256 ?? null,
        committedMutationId: publicationSeed?.committedMutationId ?? null,
        buildSequence: publicationSeed ? 1 : 0,
        lastError: null,
        updatedAtMs: request.nowMs,
      };
      this.drafts.set(revived.id, revived);
      return revived;
    }
    const definitionId = publicationSeed?.definitionId ?? request.definitionId;
    if (!definitionId) throw new Error('Draft definition identity is required.');
    const draft: TAgentAuthoringDraftDescriptor = {
      orgId: tenant.orgId,
      id: request.id,
      chatId: request.chatId,
      definitionId,
      publishedRevisionId: publicationSeed?.publishedRevisionId ?? null,
      name: request.name,
      status: publicationSeed ? 'published' : 'editing',
      sourceRelativePath: request.sourceRelativePath,
      sourceDigestSha256: publicationSeed?.sourceDigestSha256 ?? null,
      committedMutationId: publicationSeed?.committedMutationId ?? null,
      buildSequence: publicationSeed ? 1 : 0,
      lastError: null,
      createdAtMs: request.nowMs,
      updatedAtMs: request.nowMs,
    };
    this.drafts.set(draft.id, draft);
    return draft;
  }

  async getDraft(tenant: TTenantContext, draftId: string): Promise<TAgentAuthoringDraftDescriptor | null> {
    if (this.getDraftFailuresRemaining > 0) {
      this.getDraftFailuresRemaining -= 1;
      throw new Error('Injected durable draft read failure.');
    }
    const draft = this.drafts.get(draftId);
    return draft?.orgId === tenant.orgId ? draft : null;
  }

  async getDraftByName(tenant: TTenantContext, name: string): Promise<TAgentAuthoringDraftDescriptor | null> {
    return [...this.drafts.values()].find((draft) => (
      draft.orgId === tenant.orgId && draft.name === name && draft.status !== 'discarded'
    )) ?? null;
  }

  async listDrafts(tenant: TTenantContext): Promise<readonly TAgentAuthoringDraftDescriptor[]> {
    return [...this.drafts.values()].filter((draft) => draft.orgId === tenant.orgId);
  }

  async compareAndSetDraft(
    tenant: TTenantContext,
    request: Parameters<IAgentAuthoringStore['compareAndSetDraft']>[1],
  ): ReturnType<IAgentAuthoringStore['compareAndSetDraft']> {
    let current = await this.getDraft(tenant, request.draftId);
    if (
      !current
      || current.status === 'discarded'
      || current.sourceDigestSha256 !== request.expectedSourceDigestSha256
      || current.committedMutationId !== request.expectedCommittedMutationId
      || current.buildSequence !== request.expectedBuildSequence
    ) {
      return { status: 'conflict', current };
    }
    if (request.publishedRevisionId) {
      this.publishedCasAttempts += 1;
      if (this.throwPublishedCasError) throw new Error('Injected durable publication metadata failure.');
      if (this.alwaysConflictPublishedCas) {
        this.publishedCasConflicts += 1;
        return { status: 'conflict', current };
      }
    }
    if (request.publishedRevisionId && this.conflictPublishedCasWithAdvancedSource) {
      this.conflictPublishedCasWithAdvancedSource = false;
      this.publishedCasConflicts += 1;
      current = {
        ...current,
        sourceDigestSha256: 'f'.repeat(64),
        committedMutationId: 'advanced-mutation',
        buildSequence: current.buildSequence + 1,
        status: 'editing',
        updatedAtMs: request.nowMs,
      };
      this.drafts.set(current.id, current);
      return { status: 'conflict', current };
    }
    const next: TAgentAuthoringDraftDescriptor = {
      ...current,
      sourceDigestSha256: request.nextSourceDigestSha256,
      committedMutationId: request.nextCommittedMutationId,
      buildSequence: request.nextBuildSequence,
      status: request.nextStatus,
      lastError: request.lastError === undefined ? current.lastError : request.lastError,
      publishedRevisionId: request.publishedRevisionId === undefined
        ? current.publishedRevisionId
        : request.publishedRevisionId,
      updatedAtMs: request.nowMs,
    };
    this.drafts.set(next.id, next);
    return { status: 'updated', draft: next };
  }

  async renameDraft(
    tenant: TTenantContext,
    request: Parameters<IAgentAuthoringStore['renameDraft']>[1],
  ): ReturnType<IAgentAuthoringStore['renameDraft']> {
    const current = await this.getDraft(tenant, request.draftId);
    await this.beforeRenameDraft?.();
    if (this.throwRenameDraftError) throw new Error('Injected durable rename failure.');
    if (this.conflictRenameDraft) return { status: 'conflict', current };
    if (
      !current
      || current.name !== request.expectedName
      || current.sourceDigestSha256 !== request.expectedSourceDigestSha256
      || current.committedMutationId !== request.expectedCommittedMutationId
      || current.buildSequence !== request.expectedBuildSequence
    ) return { status: 'conflict', current };
    const next: TAgentAuthoringDraftDescriptor = {
      ...current,
      name: request.nextName,
      sourceRelativePath: request.nextSourceRelativePath,
      sourceDigestSha256: request.nextSourceDigestSha256,
      committedMutationId: request.nextCommittedMutationId,
      buildSequence: request.nextBuildSequence,
      status: 'editing',
      updatedAtMs: request.nowMs,
    };
    this.drafts.set(next.id, next);
    return { status: 'updated', draft: next };
  }

  async discardDraft(
    tenant: TTenantContext,
    request: Parameters<IAgentAuthoringStore['discardDraft']>[1],
  ): ReturnType<IAgentAuthoringStore['discardDraft']> {
    const current = await this.getDraft(tenant, request.draftId);
    if (this.throwDiscardDraftError) throw new Error('Injected durable discard failure.');
    if (this.conflictDiscardDraft) return { status: 'conflict', current };
    if (!current || current.sourceDigestSha256 !== request.expectedSourceDigestSha256) {
      return { status: 'conflict', current };
    }
    const next: TAgentAuthoringDraftDescriptor = {
      ...current,
      status: 'discarded',
      updatedAtMs: request.nowMs,
    };
    this.drafts.set(next.id, next);
    for (const owner of this.previewOwners.values()) {
      if (
        owner.orgId === tenant.orgId
        && owner.accountId === tenant.accountId
        && owner.draftId === next.id
        && owner.status !== 'closed'
      ) {
        this.previewOwners.set(owner.id, {
          ...owner,
          status: 'closed',
          activeRevisionId: null,
          pendingBuildId: null,
          updatedAtMs: request.nowMs,
          closedAtMs: request.nowMs,
        });
      }
    }
    return { status: 'updated', draft: next };
  }
}

export class MemoryWidgetAuthoringCapability implements TWidgetAuthoringCapability {
  readonly source = new WidgetSourceSnapshot();
  readonly revisions = new Map<string, TWidgetRevisionDescriptor>();
  readonly revisionSources = new Map<string, TWidgetRevisionSourceDescriptor>();
  readonly revisionSnapshots = new Map<string, TWidgetSourceSnapshot>();
  readonly activeRevisions = new Map<string, string>();
  readonly artifactBytes = new Map<string, Uint8Array>();
  readonly previewResults = new Map<string, TWidgetPreviewBuildResult>();
  readonly activePreviewRevisions = new Map<string, string>();
  readonly previewSnapshots = new Map<string, TWidgetSourceSnapshot>();
  readonly closePreviewWorkspaceRequests: string[] = [];
  publishCount = 0;
  validateBuildCount = 0;
  beforeValidateBuild: (() => Promise<void>) | null = null;
  beforeBuildPreview: ((request: TWidgetPreviewBuildRequest) => Promise<void>) | null = null;
  beforePublish: (() => Promise<void>) | null = null;
  previewDiagnostics: TWidgetBuildDiagnostic[] = [];
  validateBuildResult: Awaited<ReturnType<TWidgetAuthoringCapability['validateBuild']>> = {
    valid: true,
    diagnostics: [],
  };

  constructor(readonly previewOwnerStore?: IAgentAuthoringStore) {}

  captureSource: TWidgetAuthoringCapability['captureSource'] = async (_tenant, root, args) => (
    this.source.capture(root, args)
  );

  validateBuild: TWidgetAuthoringCapability['validateBuild'] = async () => {
    this.validateBuildCount += 1;
    await this.beforeValidateBuild?.();
    return this.validateBuildResult;
  };

  async buildPreview(_tenant: TTenantContext, request: TWidgetPreviewBuildRequest) {
    await this.beforeBuildPreview?.(request);
    request.reportProgress?.('installing');
    request.reportProgress?.('building');
    request.reportProgress?.('validating');
    const functionDescriptors = serverFunctions(request.manifest);
    const functionDescriptorsDigestSha256 = serverFunctionDigest(functionDescriptors);
    const artifact = this.#uiArtifact({
      artifactId: `preview-ui-${request.draftId}`,
      snapshot: request.snapshot,
      manifest: request.manifest,
      builderIdentity: request.builderIdentity,
      capsuleBuildIdentity: request.capsuleBuildIdentity,
      signatureKeyId: 'omnidraw-preview-v1',
      nowMs: request.snapshot.createdAtMs,
    });
    const result: TWidgetPreviewBuildResult = {
      draftId: request.draftId,
      definitionId: request.definitionId,
      draftRevisionSha256: request.draftRevisionSha256,
      committedMutationId: request.committedMutationId,
      manifest: request.manifest,
      functionDescriptors,
      functionDescriptorsDigestSha256,
      capabilityContractDigestSha256: '3'.repeat(64),
      channelContractDigestSha256: '4'.repeat(64),
      contractDigestSha256: '2'.repeat(64),
      builderIdentity: request.builderIdentity,
      capsuleBuildIdentity: request.capsuleBuildIdentity,
      buildPolicyId: request.buildPolicyId,
      uiArtifact: artifact.uiArtifact,
      sourceMapArtifact: null,
      diagnostics: this.previewDiagnostics,
      normalizedDiagnostics: fnNormalizeWidgetBuildDiagnostics({
        diagnostics: this.previewDiagnostics,
        draftRevision: request.draftRevisionSha256,
        previewRevisionId: request.previewRevisionId ?? null,
        buildId: request.previewRevisionId ?? request.snapshot.id,
        buildSequence: request.buildSequence ?? 1,
        timestampMs: request.nowMs ?? request.snapshot.createdAtMs,
        digestSha256: (value) => createHash('sha256').update(value).digest('hex'),
      }),
      previewId: request.previewId ?? null,
      previewRevisionId: request.previewRevisionId ?? null,
      buildSequence: request.buildSequence ?? null,
      bindingRevision: request.bindingRevision ?? null,
      bindingPlanDigestSha256: request.previewId === undefined
        ? null
        : fnWidgetPreviewBindingPlanDigest({
            bindings: request.bindings ?? [],
            digestSha256: digest,
          }),
    };
    if (request.previewId !== undefined && request.previewRevisionId !== undefined) {
      const key = `${request.previewId}:${request.previewRevisionId}`;
      this.previewResults.set(key, result);
      this.previewSnapshots.set(key, request.snapshot);
      this.activePreviewRevisions.set(request.previewId, request.previewRevisionId);
      if (this.previewOwnerStore !== undefined && request.buildSequence !== undefined) {
        await this.previewOwnerStore.compareAndSetPreviewOwner(_tenant, {
          previewId: request.previewId,
          expectedBuildSequence: request.buildSequence,
          nextBuildSequence: request.buildSequence,
          status: 'ready',
          activeRevisionId: request.previewRevisionId,
          pendingBuildId: null,
          lastError: null,
          nowMs: request.nowMs ?? request.snapshot.createdAtMs,
        });
      }
    }
    return result;
  }

  loadPreview: TWidgetAuthoringCapability['loadPreview'] = async (_tenant, request) => {
    const revisionId = this.activePreviewRevisions.get(request.previewId);
    return revisionId === undefined
      ? null
      : this.previewResults.get(`${request.previewId}:${revisionId}`) ?? null;
  };

  loadPreviewRevision: TWidgetAuthoringCapability['loadPreviewRevision'] =
    async (_tenant, request) => (
      this.previewResults.get(`${request.previewId}:${request.revisionId}`) ?? null
    );

  publishPreview: TWidgetAuthoringCapability['publishPreview'] = async (tenant, request) => {
    const key = `${request.previewId}:${request.previewRevisionId}`;
    const preview = this.previewResults.get(key);
    const snapshot = this.previewSnapshots.get(key);
    if (
      preview === undefined
      || snapshot === undefined
      || preview.draftRevisionSha256 !== request.expectedDraftRevisionSha256
      || preview.definitionId !== request.definitionId
      || preview.bindingRevision !== request.expectedBindingRevision
      || preview.bindingPlanDigestSha256
        !== request.expectedBindingPlanDigestSha256
      || this.activePreviewRevisions.get(request.previewId) !== request.previewRevisionId
    ) {
      throw Object.assign(new Error(
        'The selected Preview is no longer the current reviewed revision.',
      ), { code: 'WIDGET_PREVIEW_PROMOTION_STALE' });
    }
    return this.publish(tenant, {
      definitionId: request.definitionId,
      expectedActiveRevisionId: request.expectedActiveRevisionId,
      revisionId: request.revisionId,
      snapshot,
      manifest: preview.manifest,
      bindings: [],
      builderIdentity: preview.builderIdentity,
      capsuleBuildIdentity: preview.capsuleBuildIdentity,
      buildPolicyId: preview.buildPolicyId,
      nowMs: request.nowMs,
    });
  };

  closePreviewWorkspace:
    TWidgetAuthoringCapability['closePreviewWorkspace'] = async (_tenant, request) => {
      this.closePreviewWorkspaceRequests.push(request.draftId);
    };

  async publish(_tenant: TTenantContext, request: TWidgetPublishRequest) {
    await this.beforePublish?.();
    const activeRevisionId = this.activeRevisions.get(request.definitionId) ?? null;
    if (activeRevisionId !== request.expectedActiveRevisionId) {
      return { status: 'conflict' as const, currentActiveRevisionId: activeRevisionId };
    }
    this.publishCount += 1;
    const functionDescriptors = serverFunctions(request.manifest);
    const functionDescriptorsDigestSha256 = serverFunctionDigest(functionDescriptors);
    const artifact = this.#uiArtifact({
      artifactId: `ui-${request.revisionId}`,
      snapshot: request.snapshot,
      manifest: request.manifest,
      builderIdentity: request.builderIdentity,
      capsuleBuildIdentity: request.capsuleBuildIdentity,
      signatureKeyId: 'omnidraw-release-v1',
      nowMs: request.nowMs,
    });
    const revision: TWidgetRevisionDescriptor = {
      orgId: TEST_TENANT.orgId,
      id: request.revisionId,
      definitionId: request.definitionId,
      revisionNumber: this.publishCount,
      manifest: request.manifest,
      canonicalManifestJson: JSON.stringify(request.manifest),
      functionDescriptors,
      functionDescriptorsDigestSha256,
      capabilityContractDigestSha256: '3'.repeat(64),
      channelContractDigestSha256: '4'.repeat(64),
      constructionContractDigestSha256: '5'.repeat(64),
      contractDigestSha256: '2'.repeat(64),
      distributionProvenance: {
        kind: 'external-distribution',
        producer: {
          name: 'widget-authoring-fixture',
          version: '1',
          digest: `sha256:${'6'.repeat(64)}`,
        },
        sourceRevision: request.snapshot.digestSha256,
        dependencyLockDigest: `sha256:${'7'.repeat(64)}`,
        buildConfigurationDigest: `sha256:${'8'.repeat(64)}`,
      },
      uiArtifact: artifact.descriptor,
      uiRuntime: artifact.uiArtifact.runtimeDescriptor,
      serverArtifact: request.manifest.server
        ? this.#artifact(`published-server-${request.revisionId}`, 'server', '3'.repeat(64), 4, request.nowMs)
        : null,
      serverRuntimeAbi: request.manifest.server?.runtimeAbi ?? null,
      capsuleBuildIdentity: request.capsuleBuildIdentity,
      buildPolicyId: request.buildPolicyId,
      createdAtMs: request.nowMs,
    };
    this.revisions.set(revision.id, revision);
    this.revisionSnapshots.set(revision.id, request.snapshot);
    this.revisionSources.set(revision.id, {
      orgId: TEST_TENANT.orgId,
      definitionId: request.definitionId,
      revisionId: revision.id,
      sourceSnapshotId: request.snapshot.id,
      sourceDigestSha256: request.snapshot.digestSha256,
      sourceArtifact: this.#artifact(
        `published-source-${request.revisionId}`,
        'source',
        request.snapshot.digestSha256,
        1,
        request.nowMs,
      ),
      builderIdentity: request.builderIdentity,
      createdAtMs: request.nowMs,
    });
    this.activeRevisions.set(request.definitionId, revision.id);
    return {
      status: 'committed' as const,
      definition: {
        orgId: TEST_TENANT.orgId,
        id: request.definitionId,
        slug: request.manifest.slug,
        name: request.manifest.name,
        status: 'published' as const,
        activeRevisionId: revision.id,
        createdAtMs: request.nowMs,
        updatedAtMs: request.nowMs,
      },
      revision,
      previousActiveRevisionId: activeRevisionId,
    };
  }

  async rollback() {
    return { status: 'conflict' as const, currentActiveRevisionId: null };
  }

  archive: TWidgetAuthoringCapability['archive'] = async (_tenant, request) => {
    const currentActiveRevisionId = this.activeRevisions.get(request.definitionId) ?? null;
    const revision = currentActiveRevisionId
      ? this.revisions.get(currentActiveRevisionId) ?? null
      : null;
    if (currentActiveRevisionId !== request.expectedActiveRevisionId || !revision) {
      return { status: 'conflict', currentActiveRevisionId };
    }
    this.activeRevisions.delete(request.definitionId);
    return {
      status: 'archived',
      definition: {
        orgId: TEST_TENANT.orgId,
        id: request.definitionId,
        slug: revision.manifest.slug,
        name: revision.manifest.name,
        status: 'archived',
        activeRevisionId: null,
        createdAtMs: revision.createdAtMs,
        updatedAtMs: request.nowMs,
      },
      previousActiveRevisionId: request.expectedActiveRevisionId,
    };
  };

  async getRevision(_tenant: TTenantContext, revisionId: string) {
    return this.revisions.get(revisionId) ?? null;
  }

  async getActiveRevision(_tenant: TTenantContext, definitionId: string) {
    const revisionId = this.activeRevisions.get(definitionId);
    return revisionId ? this.revisions.get(revisionId) ?? null : null;
  }

  async getRevisionSource(_tenant: TTenantContext, revisionId: string) {
    return this.revisionSources.get(revisionId) ?? null;
  }

  readRevisionSourceSnapshot:
    TWidgetAuthoringCapability['readRevisionSourceSnapshot'] = async (_tenant, request) => {
      const source = this.revisionSources.get(request.revisionId);
      return source?.definitionId === request.definitionId
        ? this.revisionSnapshots.get(request.revisionId) ?? null
        : null;
    };

  #uiArtifact(request: Readonly<{
    artifactId: string;
    snapshot: TWidgetSourceSnapshot;
    manifest: TWidgetManifestV3;
    builderIdentity: string;
    capsuleBuildIdentity: TWidgetCapsuleBuildIdentity;
    signatureKeyId: string;
    nowMs: number;
  }>): {
    descriptor: TWidgetArtifactDescriptor;
    uiArtifact: TWidgetCapsuleUiArtifact;
  } {
    const functionDescriptors = serverFunctions(request.manifest);
    const browserFunctionDescriptorsDigestSha256 =
      browserFunctionDigest(functionDescriptors);
    const bytes = new Uint8Array(Buffer.from(
      `signed-capsule:${request.snapshot.digestSha256}:${request.signatureKeyId}`,
      'utf8',
    ));
    const digestSha256 = digest(bytes);
    const runtimeDescriptor: TWidgetCapsuleRuntimeDescriptor = {
      format: 'omnidraw.capsule-runtime.v2',
      capsuleArtifactHash: `sha256:${digestSha256}`,
      apiContract: {
        format: 'capsule-api-groups-v1',
        groups: request.manifest.ui.apis,
        bundleDigest: `sha256:${'f'.repeat(64)}`,
      },
      budgets: request.manifest.ui.budgets ?? {},
      capabilityRequests: functionDescriptors.length === 0
        ? []
        : [{
            id: `omnidraw.widget.functions.h${browserFunctionDescriptorsDigestSha256}`,
            versionRange: '1.0.0',
            contractHash: `sha256:${browserFunctionDescriptorsDigestSha256}`,
            required: true,
            operations: functionDescriptors
              .map((descriptor) => descriptor.exportName)
              .sort(),
          }],
      channels: null,
      parkability: { parkable: false },
      signatureKeyIds: [request.signatureKeyId],
    };
    const descriptor = this.#artifact(
      request.artifactId,
      'ui',
      digestSha256,
      bytes.byteLength,
      request.nowMs,
    );
    const uiArtifact: TWidgetCapsuleUiArtifact = {
      kind: 'ui',
      digestSha256,
      bytes,
      capsuleArtifactHash: runtimeDescriptor.capsuleArtifactHash,
      runtimeDescriptor,
      builderIdentity: request.builderIdentity,
      capsuleBuildIdentity: request.capsuleBuildIdentity,
    };
    this.artifactBytes.set(descriptor.id, bytes);
    return { descriptor, uiArtifact };
  }

  #artifact(
    id: string,
    kind: TWidgetArtifactDescriptor['kind'],
    digestSha256: string,
    byteSize: number,
    createdAtMs: number,
  ): TWidgetArtifactDescriptor {
    return {
      orgId: TEST_TENANT.orgId,
      id,
      kind,
      digestSha256,
      byteSize,
      retentionState: 'pinned',
      retainUntilMs: null,
      createdAtMs,
    };
  }
}

export type TWidgetAuthoringHarness = Awaited<ReturnType<typeof createWidgetAuthoringHarness>>;

export function createWidgetDraftControllerForWorkspace(
  workspace: WidgetWorkspace,
  eventPublisher: ITenantEventPublisherService = createTestTenantEvents(),
) {
  const store = new MemoryAuthoringStore();
  const widgets = new MemoryWidgetAuthoringCapability(store);
  let resourceBindings: readonly TWidgetResourceBindingInput[] = [];
  let id = 0;
  let nowMs = 10_000;
  const controller = new WidgetDraftController({
    tenant: TEST_TENANT,
    workspace,
    eventPublisher,
    authoringStore: store,
    widgets,
    resolveResourceBindings: async () => resourceBindings,
    createId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    nowMs: () => ++nowMs,
    builderIdentity: 'test-widget-builder/1',
    capsuleBuildIdentity: TEST_CAPSULE_BUILD_IDENTITY,
    buildPolicyId: TEST_CAPSULE_BUILD_POLICY_ID,
    previewBuildDebounceMs: 0,
  });
  return {
    controller,
    store,
    widgets,
    setResourceBindings(
      bindings: readonly TWidgetResourceBindingInput[],
    ): void {
      resourceBindings = Object.freeze([...bindings]);
    },
  };
}

export async function createWidgetAuthoringHarness(
  root: string,
  eventPublisher: ITenantEventPublisherService = createTestTenantEvents(),
) {
  const workspace = new WidgetWorkspace({
    dataPath: root,
    createId: (() => {
      let id = 0;
      return () => `workspace-${++id}`;
    })(),
  });
  await workspace.init();
  const { controller, store, widgets, setResourceBindings } =
    createWidgetDraftControllerForWorkspace(workspace, eventPublisher);

  const createDraft = async (name: string, server = false) => {
    const slug = name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await workspace.createDraft('external-chat', { name }, async ({ cwd }) => {
      await mkdir(`${cwd}/ui`, { recursive: true });
      await writeFile(`${cwd}/ui/main.ts`, 'document.body.append(document.createElement("main"));\n', 'utf8');
      if (server) {
        await mkdir(`${cwd}/server`, { recursive: true });
        await writeFile(`${cwd}/server/main.ts`, 'export const lookup = () => ({ ok: true });\n', 'utf8');
      }
      const manifest: TWidgetManifestV3 = {
        schemaVersion: 3,
        name,
        slug,
        ui: {
          runtime: 'capsule',
          entry: 'ui/main.ts',
          apis: ['DOM'],
        },
        ...(server ? { server: { entry: 'server/main.ts', runtimeAbi: 'bun-v1' } } : {}),
      };
      await writeFile(`${cwd}/omnidraw.json`, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      return ['omnidraw.json', 'ui/main.ts'];
    });
    await controller.handleToolChange({
      name,
      chatId: 'external-chat',
      type: 'created',
    });
    const summary = await controller.getByName(name);
    if (!summary) throw new Error('Test draft was not created.');
    return summary;
  };

  return {
    controller,
    workspace,
    store,
    widgets,
    createDraft,
    setResourceBindings,
  };
}
