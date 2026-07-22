import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type {
  TWidgetArtifactDescriptor,
  TWidgetManifestV2,
  TWidgetPreviewBuildRequest,
  TWidgetPreviewRevisionDescriptor,
  TWidgetPublishRequest,
  TWidgetRevisionDescriptor,
  TWidgetRevisionSourceDescriptor,
  TWidgetServerFunctionDescriptor,
  TWidgetSourceSnapshot,
} from '@vibecanvas/widget-contract';
import { WidgetSourceSnapshot } from '@vibecanvas/widget-contract/local';
import { WidgetDraftController } from '../src/widget-drafts/WidgetDraftController';
import type {
  IAgentAuthoringStore,
  IWidgetPreviewFunctionCapability,
  TAgentAuthoringChatDescriptor,
  TAgentAuthoringDraftDescriptor,
  TWidgetAuthoringCapability,
} from '../src/widget-drafts/types';
import { WidgetWorkspace } from '../src/workspace/WidgetWorkspace';
import { TEST_TENANT, createTestTenantEvents } from './tenant.fixture';
import type { ITenantEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

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

export class MemoryAuthoringStore implements IAgentAuthoringStore {
  readonly chats = new Map<string, TAgentAuthoringChatDescriptor>();
  readonly drafts = new Map<string, TAgentAuthoringDraftDescriptor>();
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
        status: 'editing',
        updatedAtMs: request.nowMs,
      };
      this.drafts.set(current.id, current);
      return { status: 'conflict', current };
    }
    const next: TAgentAuthoringDraftDescriptor = {
      ...current,
      sourceDigestSha256: request.nextSourceDigestSha256,
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
    ) return { status: 'conflict', current };
    const next: TAgentAuthoringDraftDescriptor = {
      ...current,
      name: request.nextName,
      sourceRelativePath: request.nextSourceRelativePath,
      sourceDigestSha256: request.nextSourceDigestSha256,
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
    return { status: 'updated', draft: next };
  }
}

export class MemoryWidgetAuthoringCapability implements TWidgetAuthoringCapability {
  readonly source = new WidgetSourceSnapshot();
  readonly previews = new Map<string, TWidgetPreviewRevisionDescriptor>();
  readonly previewRevisions = new Map<string, TWidgetPreviewRevisionDescriptor>();
  readonly revisions = new Map<string, TWidgetRevisionDescriptor>();
  readonly revisionSources = new Map<string, TWidgetRevisionSourceDescriptor>();
  readonly revisionSnapshots = new Map<string, TWidgetSourceSnapshot>();
  readonly activeRevisions = new Map<string, string>();
  readonly artifactBytes = new Map<string, Uint8Array>();
  tamperRead = false;
  failArtifactRead = false;
  publishCount = 0;
  stopPreviewCalls = 0;
  stopPreviewFailuresRemaining = 0;
  stopPreviewFalseFailuresRemaining = 0;
  beforeValidateBuild: (() => Promise<void>) | null = null;
  beforeBuildPreview: (() => Promise<void>) | null = null;
  beforePublish: (() => Promise<void>) | null = null;
  afterBuildPreviewCommit: (() => Promise<void>) | null = null;
  validateBuildResult: Awaited<ReturnType<TWidgetAuthoringCapability['validateBuild']>> = {
    valid: true,
    diagnostics: [],
  };

  captureSource: TWidgetAuthoringCapability['captureSource'] = async (_tenant, root, args) => (
    this.source.capture(root, args)
  );

  validateBuild: TWidgetAuthoringCapability['validateBuild'] = async () => {
    await this.beforeValidateBuild?.();
    return this.validateBuildResult;
  };

  async buildPreview(_tenant: TTenantContext, request: TWidgetPreviewBuildRequest) {
    await this.beforeBuildPreview?.();
    const active = this.previews.get(request.previewId) ?? null;
    if ((active?.id ?? null) !== request.expectedActiveRevisionId) {
      return { status: 'conflict' as const, currentActiveRevisionId: active?.id ?? null };
    }
    const artifact = this.#uiArtifact(request);
    const descriptor: TWidgetPreviewRevisionDescriptor = {
      orgId: TEST_TENANT.orgId,
      id: request.revisionId,
      previewId: request.previewId,
      draftId: request.draftId,
      definitionId: request.definitionId,
      draftRevisionSha256: request.draftRevisionSha256,
      sourceSnapshotId: request.snapshot.id,
      sourceDigestSha256: request.snapshot.digestSha256,
      sourceArtifact: this.#artifact(`source-${request.revisionId}`, 'source', '0'.repeat(64), 1, request.nowMs),
      manifest: request.manifest,
      canonicalManifestJson: JSON.stringify(request.manifest),
      functionDescriptors: request.manifest.server ? [SERVER_FUNCTION] : [],
      functionDescriptorsDigestSha256: '1'.repeat(64),
      contractDigestSha256: '2'.repeat(64),
      builderIdentity: request.builderIdentity,
      uiArtifact: artifact.descriptor,
      serverArtifact: request.manifest.server
        ? this.#artifact(`server-${request.revisionId}`, 'server', '3'.repeat(64), 4, request.nowMs)
        : null,
      createdAtMs: request.nowMs,
      retainUntilMs: request.retainUntilMs,
      expiresAtMs: request.expiresAtMs,
    };
    this.previews.set(request.previewId, descriptor);
    this.previewRevisions.set(`${request.previewId}:${request.revisionId}`, descriptor);
    await this.afterBuildPreviewCommit?.();
    return {
      status: 'committed' as const,
      revision: descriptor,
      previousActiveRevisionId: active?.id ?? null,
    };
  }

  async getPreview(
    _tenant: TTenantContext,
    request: Parameters<TWidgetAuthoringCapability['getPreview']>[1],
  ) {
    const preview = this.previews.get(request.previewId) ?? null;
    return preview && preview.expiresAtMs > request.nowMs ? preview : null;
  }

  async getPreviewRevision(
    _tenant: TTenantContext,
    request: Parameters<TWidgetAuthoringCapability['getPreviewRevision']>[1],
  ) {
    const preview = this.previewRevisions.get(`${request.previewId}:${request.revisionId}`) ?? null;
    return preview && preview.expiresAtMs > request.nowMs ? preview : null;
  }

  async stopPreview(
    _tenant: TTenantContext,
    request: Parameters<TWidgetAuthoringCapability['stopPreview']>[1],
  ): Promise<boolean> {
    this.stopPreviewCalls += 1;
    if (this.stopPreviewFailuresRemaining > 0) {
      this.stopPreviewFailuresRemaining -= 1;
      throw new Error('Injected Preview stop failure.');
    }
    if (this.stopPreviewFalseFailuresRemaining > 0) {
      this.stopPreviewFalseFailuresRemaining -= 1;
      return false;
    }
    const active = this.previews.get(request.previewId);
    if (!active || active.id !== request.expectedActiveRevisionId) return false;
    this.previews.delete(request.previewId);
    return true;
  }

  async publish(_tenant: TTenantContext, request: TWidgetPublishRequest) {
    await this.beforePublish?.();
    const activeRevisionId = this.activeRevisions.get(request.definitionId) ?? null;
    if (activeRevisionId !== request.expectedActiveRevisionId) {
      return { status: 'conflict' as const, currentActiveRevisionId: activeRevisionId };
    }
    this.publishCount += 1;
    const artifact = this.#uiArtifact({
      revisionId: request.revisionId,
      snapshot: request.snapshot,
      manifest: request.manifest,
      builderIdentity: request.builderIdentity,
      nowMs: request.nowMs,
    });
    const revision: TWidgetRevisionDescriptor = {
      orgId: TEST_TENANT.orgId,
      id: request.revisionId,
      definitionId: request.definitionId,
      revisionNumber: this.publishCount,
      manifest: request.manifest,
      canonicalManifestJson: JSON.stringify(request.manifest),
      functionDescriptors: request.manifest.server ? [SERVER_FUNCTION] : [],
      functionDescriptorsDigestSha256: '1'.repeat(64),
      contractDigestSha256: '2'.repeat(64),
      uiArtifact: artifact.descriptor,
      serverArtifact: request.manifest.server
        ? this.#artifact(`published-server-${request.revisionId}`, 'server', '3'.repeat(64), 4, request.nowMs)
        : null,
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

  async issueUiPreviewArtifactReadCapability(
    _tenant: TTenantContext,
    request: Parameters<TWidgetAuthoringCapability['issueUiPreviewArtifactReadCapability']>[1],
  ) {
    return JSON.stringify(request);
  }

  async readArtifact(
    _tenant: TTenantContext,
    request: Parameters<TWidgetAuthoringCapability['readArtifact']>[1],
  ): Promise<Uint8Array | null> {
    if (this.failArtifactRead) return null;
    const bytes = this.artifactBytes.get(request.artifactId);
    if (!bytes) return null;
    if (!this.tamperRead) return new Uint8Array(bytes);
    const tampered = new Uint8Array(bytes);
    tampered[0] = (tampered[0] ?? 0) ^ 1;
    return tampered;
  }

  #uiArtifact(request: Pick<
    TWidgetPreviewBuildRequest,
    'revisionId' | 'snapshot' | 'manifest' | 'builderIdentity' | 'nowMs'
  >): { descriptor: TWidgetArtifactDescriptor; bytes: Uint8Array } {
    const outputBytes = Buffer.from('export default function mount() {}\n', 'utf8');
    const envelope = {
      format: 'vibecanvas.widget-artifact.v1',
      kind: 'ui',
      entry: request.manifest.ui.entry,
      sourceDigestSha256: request.snapshot.digestSha256,
      builderIdentity: request.builderIdentity,
      runtimeAbi: null,
      outputs: [{
        path: 'output-0.js',
        loader: 'js',
        kind: 'entry-point',
        digestSha256: digest(outputBytes),
        bytesBase64: outputBytes.toString('base64'),
      }],
    };
    const bytes = new Uint8Array(Buffer.from(JSON.stringify(envelope), 'utf8'));
    const descriptor = this.#artifact(
      `ui-${request.revisionId}`,
      'ui',
      digest(bytes),
      bytes.byteLength,
      request.nowMs,
    );
    this.artifactBytes.set(descriptor.id, bytes);
    return { descriptor, bytes };
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

export class MemoryPreviewFunctions implements IWidgetPreviewFunctionCapability {
  lastInvocation: Awaited<ReturnType<IWidgetPreviewFunctionCapability['invokePreviewFunction']>> | null = null;

  async invokePreviewFunction(
    _tenant: TTenantContext,
    request: Parameters<IWidgetPreviewFunctionCapability['invokePreviewFunction']>[1],
  ) {
    this.lastInvocation = {
      id: `invocation-${request.idempotencyKey}`,
      functionName: request.functionName,
      widgetRevisionId: request.previewRevisionId,
      subject: {
        kind: 'agent_preview',
        previewId: request.previewId,
        previewRevisionId: request.previewRevisionId,
      },
      status: 'succeeded',
      output: request.input,
      failure: null,
      createdAtMs: 1,
      startedAtMs: 2,
      finishedAtMs: 3,
    };
    return this.lastInvocation;
  }

  async getPreviewFunctionInvocation(
    _tenant: TTenantContext,
    request: Parameters<IWidgetPreviewFunctionCapability['getPreviewFunctionInvocation']>[1],
  ) {
    const invocation = this.lastInvocation;
    return invocation
      && invocation.id === request.invocationId
      && invocation.subject.previewId === request.previewId
      && invocation.subject.previewRevisionId === request.previewRevisionId
      ? invocation
      : null;
  }

  async cancelPreviewFunctionInvocation(
    tenant: TTenantContext,
    request: Parameters<IWidgetPreviewFunctionCapability['cancelPreviewFunctionInvocation']>[1],
  ) {
    const invocation = await this.getPreviewFunctionInvocation(tenant, request);
    if (!invocation) return null;
    this.lastInvocation = { ...invocation, status: 'cancelled' };
    return this.lastInvocation;
  }
}

export type TWidgetAuthoringHarness = Awaited<ReturnType<typeof createWidgetAuthoringHarness>>;

export function createWidgetDraftControllerForWorkspace(
  workspace: WidgetWorkspace,
  eventPublisher: ITenantEventPublisherService = createTestTenantEvents(),
) {
  const store = new MemoryAuthoringStore();
  const widgets = new MemoryWidgetAuthoringCapability();
  const previewFunctions = new MemoryPreviewFunctions();
  let id = 0;
  let nowMs = 10_000;
  const controller = new WidgetDraftController({
    tenant: TEST_TENANT,
    workspace,
    eventPublisher,
    authoringStore: store,
    widgets,
    resolveResourceBindings: async () => [],
    previewFunctions,
    createId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    nowMs: () => ++nowMs,
    builderIdentity: 'test-widget-builder/1',
  });
  return { controller, store, widgets, previewFunctions };
}

export async function createWidgetAuthoringHarness(
  root: string,
  eventPublisher: ITenantEventPublisherService = createTestTenantEvents(),
) {
  const workspace = new WidgetWorkspace({
    dataPath: root,
    configPath: `${root}/config`,
    createId: (() => {
      let id = 0;
      return () => `workspace-${++id}`;
    })(),
  });
  await workspace.init();
  const { controller, store, widgets, previewFunctions } =
    createWidgetDraftControllerForWorkspace(workspace, eventPublisher);

  const createDraft = async (name: string, server = false) => {
    const slug = name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await workspace.createDraft('external-chat', { name }, async ({ cwd }) => {
      await mkdir(`${cwd}/ui`, { recursive: true });
      await writeFile(`${cwd}/ui/main.ts`, 'export default function mount() {}\n', 'utf8');
      if (server) {
        await mkdir(`${cwd}/server`, { recursive: true });
        await writeFile(`${cwd}/server/main.ts`, 'export const lookup = () => ({ ok: true });\n', 'utf8');
      }
      const manifest: TWidgetManifestV2 = {
        schemaVersion: 2,
        name,
        slug,
        ui: { entry: 'ui/main.ts' },
        ...(server ? { server: { entry: 'server/main.ts', runtimeAbi: 'bun-v1' } } : {}),
      };
      await writeFile(`${cwd}/vibecanvas.json`, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      return ['vibecanvas.json', 'ui/main.ts'];
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

  return { controller, workspace, store, widgets, previewFunctions, createDraft };
}
