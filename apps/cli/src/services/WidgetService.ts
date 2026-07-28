import type { Database } from '@tursodatabase/database';
import { createHash } from 'node:crypto';
import {
  WidgetArtifactBuilderCapsule,
  type CapsuleArtifactSigningKey,
  type TVibecanvasCapsuleBuild,
  type TVibecanvasDistributionBuild,
} from '@vibecanvas/capsule-vibecanvas/builder';
import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import { AgentAuthoringStoreTurso } from '@vibecanvas/service-db/AgentAuthoringStoreTurso';
import { WidgetControlStoreTurso } from '@vibecanvas/service-db/WidgetControlStoreTurso';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type {
  IWidgetArtifactGarbageCollector,
  IWidgetArtifactConstructionBuilder,
  IWidgetArtifactMutationCoordinator,
  IWidgetBrowserUiArtifactReadCapabilityIssuer,
  IWidgetArtifactReader,
  IWidgetControlStore,
  IWidgetDurablePreviewService,
  IWidgetPreviewPromotionService,
  IWidgetPreviewWorkspaceService,
  IWidgetPublishedPlacementReader,
  IWidgetPublicationService,
  IWidgetRevisionSourceSnapshotReader,
  IWidgetServerExecutionArtifactReadCapabilityIssuer,
  IWidgetSourceBuildArtifactReadCapabilityIssuer,
  IWidgetServerFunctionDescriptorExtractor,
  TWidgetActiveRevisionCasResult,
  TWidgetArtifactDescriptor,
  TWidgetArtifactGcRequest,
  TWidgetArtifactGcResult,
  TWidgetArtifactReadCapability,
  TWidgetArtifactReadCapabilityIssueRequest,
  TWidgetArtifactReadRequest,
  TWidgetCapsuleBuildIdentity,
  TWidgetDefinitionDescriptor,
  TWidgetDefinitionArchiveInput,
  TWidgetDefinitionArchiveResult,
  TWidgetManifestV3,
  TWidgetPublishRequest,
  TWidgetPublishConstructionRequest,
  TWidgetPublishResult,
  TWidgetPublishedPlacementDescriptor,
  TWidgetPublishedPlacementTarget,
  TWidgetPreviewBuildRequest,
  TWidgetPreviewBuildResult,
  TWidgetPreviewGetRequest,
  TWidgetPreviewPromotionRequest,
  TWidgetPreviewRevisionGetRequest,
  TWidgetPreviewRevisionDescriptor,
  TWidgetResourceBindingInput,
  TWidgetPreviewWorkspaceCloseRequest,
  TWidgetRevisionDescriptor,
  TWidgetRevisionId,
  TWidgetRevisionSourceDescriptor,
  TWidgetRevisionSourceSnapshotReadRequest,
  TWidgetRollbackInput,
  TWidgetSourceSnapshot,
} from '@vibecanvas/widget-contract';
import {
  ZWidgetManifestV3,
  ZWidgetServerFunctionDescriptors,
  fnCanonicalizeWidgetManifest,
  fnValidateWidgetBuildIntegrity,
  fnWidgetPreviewBindingPlanDigest,
} from '@vibecanvas/widget-contract';
import {
  LocalWidgetArtifactStore,
  WidgetArtifactConstructionCache,
  WidgetArtifactGarbageCollector,
  WidgetArtifactOperationLane,
  WidgetArtifactReadAuthority,
  WidgetArtifactService,
  WidgetPreviewService,
  WidgetPublicationService,
  WidgetSourceSnapshot,
  type TCapturedWidgetSourceSnapshot,
} from '@vibecanvas/widget-contract/local';

type TWidgetServicePlacement = TTenantContext;

type TWidgetServiceConfig = Readonly<{
  placement: TWidgetServicePlacement;
  database: Database;
  artifactsRoot: string;
  buildTempRoot: string;
  builderIdentity: string;
  buildEnvironmentIdentity: string;
  artifactReadSecret: Uint8Array;
  artifactReadMaximumTtlMs: number;
  compiledExecutable?: boolean;
  nowMs?: () => number;
  artifactGcIntervalMs?: number;
  artifactGcGracePeriodMs?: number;
  artifactGcLimit?: number;
  functionDescriptorExtractor: IWidgetServerFunctionDescriptorExtractor;
  resolveTrustedPackageImport: (specifier: string) => string;
  capsuleBuildIdentity: TWidgetCapsuleBuildIdentity;
  buildPolicyId: string;
  capsuleBuild: TVibecanvasCapsuleBuild;
  distributionBuild: TVibecanvasDistributionBuild;
  loadCapsuleSigningKeys(
    purpose: 'preview' | 'release',
  ): Promise<readonly CapsuleArtifactSigningKey[]>;
}>;

type TWidgetSourceCaptureArgs = Readonly<{
  id?: string;
  createdAtMs?: number;
  expectedDigestSha256?: string;
}>;

type TWidgetBuildValidationRequest = Readonly<{
  snapshot: TWidgetSourceSnapshot;
  manifest: TWidgetManifestV3;
}>;

type TWidgetBuildValidationResult = Readonly<{
  valid: boolean;
  diagnostics: readonly string[];
}>;

const WIDGET_PLACEMENT_FALLBACK_BOUNDS = Object.freeze({ width: 360, height: 320 });
const WIDGET_PLACEMENT_CATALOG_MAX_DEFINITIONS = 1_000;
const WIDGET_PLACEMENT_CATALOG_READ_CONCURRENCY = 8;
const WIDGET_ARTIFACT_GC_INTERVAL_MS = 30_000;
const WIDGET_ARTIFACT_GC_GRACE_PERIOD_MS = 300_000;
const WIDGET_ARTIFACT_GC_LIMIT = 100;

/** Organization-placement owner for manifest-v3 Capsule widget artifacts and revisions. */
class WidgetService implements
  IService,
  IStartableService<object, object>,
  IStoppableService,
  IWidgetPublicationService,
  IWidgetRevisionSourceSnapshotReader,
  IWidgetPublishedPlacementReader,
  IWidgetArtifactReader,
  IWidgetBrowserUiArtifactReadCapabilityIssuer,
  IWidgetServerExecutionArtifactReadCapabilityIssuer,
  IWidgetSourceBuildArtifactReadCapabilityIssuer,
  IWidgetDurablePreviewService,
  IWidgetPreviewPromotionService,
  IWidgetPreviewWorkspaceService,
  IWidgetArtifactGarbageCollector {
  readonly name = 'widget-service';
  readonly #placement: TWidgetServicePlacement;
  readonly #builderIdentity: string;
  readonly #capsuleBuildIdentity: TWidgetCapsuleBuildIdentity;
  readonly #buildPolicyId: string;
  readonly #artifactReadMaximumTtlMs: number;
  readonly #nowMs: () => number;
  readonly #artifactGcIntervalMs: number;
  readonly #artifactGcGracePeriodMs: number;
  readonly #artifactGcLimit: number;
  readonly #controlStore: IWidgetControlStore & IWidgetArtifactMutationCoordinator;
  readonly authoringStore: AgentAuthoringStoreTurso;
  readonly #sourceSnapshot: WidgetSourceSnapshot;
  readonly #constructionCache: WidgetArtifactConstructionCache;
  readonly #builder: IWidgetArtifactConstructionBuilder;
  readonly #publication: WidgetPublicationService;
  readonly #preview: WidgetPreviewService;
  readonly #artifacts: WidgetArtifactService;
  readonly #garbageCollector: WidgetArtifactGarbageCollector;
  readonly #operationLane: WidgetArtifactOperationLane;
  #artifactGcTimer: ReturnType<typeof setInterval> | null = null;
  #artifactGcTail: Promise<void> = Promise.resolve();
  #artifactGcStarted = false;
  #artifactGcStopped = true;

  constructor(config: TWidgetServiceConfig) {
    this.#placement = Object.freeze({ ...config.placement });
    this.#builderIdentity = config.builderIdentity;
    this.#capsuleBuildIdentity = config.capsuleBuildIdentity;
    this.#buildPolicyId = config.buildPolicyId;
    this.#artifactReadMaximumTtlMs = config.artifactReadMaximumTtlMs;
    this.#nowMs = config.nowMs ?? Date.now;
    this.#artifactGcIntervalMs = this.#boundedMaintenanceInteger(
      config.artifactGcIntervalMs ?? WIDGET_ARTIFACT_GC_INTERVAL_MS,
      1,
      86_400_000,
      'Widget artifact GC interval',
    );
    this.#artifactGcGracePeriodMs = this.#boundedMaintenanceInteger(
      config.artifactGcGracePeriodMs ?? WIDGET_ARTIFACT_GC_GRACE_PERIOD_MS,
      0,
      2_592_000_000,
      'Widget artifact GC grace period',
    );
    this.#artifactGcLimit = this.#boundedMaintenanceInteger(
      config.artifactGcLimit ?? WIDGET_ARTIFACT_GC_LIMIT,
      1,
      10_000,
      'Widget artifact GC limit',
    );
    this.#sourceSnapshot = new WidgetSourceSnapshot();

    const controlStore: IWidgetControlStore & IWidgetArtifactMutationCoordinator =
      new WidgetControlStoreTurso(config.database);
    const authoringStore = new AgentAuthoringStoreTurso(
      config.database,
      controlStore,
    );
    this.authoringStore = authoringStore;
    this.#controlStore = controlStore;
    const blobs = new LocalWidgetArtifactStore({
      orgId: config.placement.orgId,
      artifactsRoot: config.artifactsRoot,
    });
    const operationLane = new WidgetArtifactOperationLane();
    this.#operationLane = operationLane;
    const readAuthority = new WidgetArtifactReadAuthority({
      secret: config.artifactReadSecret,
      maximumTtlMs: config.artifactReadMaximumTtlMs,
      now: this.#nowMs,
    });
    this.#artifacts = new WidgetArtifactService({
      controlStore,
      blobs,
      capabilityIssuer: readAuthority,
      capabilityVerifier: readAuthority,
    });
    const constructionBuilder = new WidgetArtifactBuilderCapsule({
      tempRoot: config.buildTempRoot,
      builderIdentity: config.builderIdentity,
      capsuleBuildIdentity: config.capsuleBuildIdentity,
      buildPolicyId: config.buildPolicyId,
      snapshotService: this.#sourceSnapshot,
      functionDescriptorExtractor: config.functionDescriptorExtractor,
      resolveTrustedPackageImport: config.resolveTrustedPackageImport,
      loadSigningKeys: config.loadCapsuleSigningKeys,
      capsuleBuild: config.capsuleBuild,
      distributionBuild: config.distributionBuild,
    });
    const builder = new WidgetArtifactConstructionCache({
      builder: constructionBuilder,
      environmentIdentity: config.buildEnvironmentIdentity,
    });
    this.#constructionCache = builder;
    this.#builder = builder;
    this.#publication = new WidgetPublicationService({
      builder,
      constructionSigner: builder,
      artifacts: this.#artifacts,
      controlStore,
      mutationCoordinator: controlStore,
      operationLane,
      sourceSnapshots: this.#sourceSnapshot,
    });
    this.#preview = new WidgetPreviewService({
      builder,
      constructionBuilder: builder,
      artifacts: this.#artifacts,
      previewStore: authoringStore,
      mutationCoordinator: controlStore,
      operationLane,
      readArtifactBytes: async (tenant, artifact) => {
        this.#assertPlacement(tenant);
        if (artifact.orgId !== tenant.orgId) return null;
        return blobs.readArtifact(artifact);
      },
    });
    this.#garbageCollector = new WidgetArtifactGarbageCollector({
      controlStore,
      mutationCoordinator: controlStore,
      blobs,
      operationLane,
    });
  }

  captureSource(
    tenant: TTenantContext,
    sourceRoot: string,
    args: TWidgetSourceCaptureArgs = {},
  ): Promise<TCapturedWidgetSourceSnapshot> {
    this.#assertPlacement(tenant);
    return this.#sourceSnapshot.capture(sourceRoot, args);
  }

  /** No-commit validation through the same injected build ports used by preview and publish. */
  async validateBuild(
    tenant: TTenantContext,
    request: TWidgetBuildValidationRequest,
  ): Promise<TWidgetBuildValidationResult> {
    this.#assertPlacement(tenant);
    try {
      const manifest = ZWidgetManifestV3.parse(request.manifest);
      const canonicalManifestJson = fnCanonicalizeWidgetManifest(manifest);
      const build = await this.#builder.build(tenant, {
        snapshot: request.snapshot,
        manifest,
        canonicalManifestJson,
        builderIdentity: this.#builderIdentity,
        capsuleBuildIdentity: this.#capsuleBuildIdentity,
        buildPolicyId: this.#buildPolicyId,
        signingPurpose: 'preview',
      });
      const descriptors = ZWidgetServerFunctionDescriptors.safeParse(build.functionDescriptors);
      if (!descriptors.success) {
        return Object.freeze({
          valid: false,
          diagnostics: Object.freeze(['Widget builder returned malformed server-function descriptors.']),
        });
      }
      const integrity = fnValidateWidgetBuildIntegrity({
        snapshot: request.snapshot,
        manifest,
        canonicalManifestJson,
        builderIdentity: this.#builderIdentity,
        capsuleBuildIdentity: this.#capsuleBuildIdentity,
        buildPolicyId: this.#buildPolicyId,
        build: { ...build, functionDescriptors: descriptors.data },
        digestSha256: (value) => createHash('sha256').update(value).digest('hex'),
      });
      if (!integrity.valid) {
        return Object.freeze({
          valid: false,
          diagnostics: Object.freeze([
            `Widget builder integrity check failed: ${integrity.reason}.`,
          ]),
        });
      }
      return Object.freeze({ valid: true, diagnostics: Object.freeze([]) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const bounded = message.replace(/\s+/g, ' ').trim().slice(0, 512)
        || 'Widget build validation failed.';
      return Object.freeze({ valid: false, diagnostics: Object.freeze([bounded]) });
    }
  }

  publish(
    tenant: TTenantContext,
    request: TWidgetPublishRequest,
  ): Promise<TWidgetPublishResult> {
    this.#assertPlacement(tenant);
    return this.#publication.publish(tenant, request);
  }

  publishConstruction(
    tenant: TTenantContext,
    request: TWidgetPublishConstructionRequest,
  ): Promise<TWidgetPublishResult> {
    this.#assertPlacement(tenant);
    return this.#publication.publishConstruction(tenant, request);
  }

  rollback(
    tenant: TTenantContext,
    request: TWidgetRollbackInput,
  ): Promise<TWidgetActiveRevisionCasResult> {
    this.#assertPlacement(tenant);
    return this.#publication.rollback(tenant, request);
  }

  archive(
    tenant: TTenantContext,
    request: TWidgetDefinitionArchiveInput,
  ): Promise<TWidgetDefinitionArchiveResult> {
    this.#assertPlacement(tenant);
    return this.#publication.archive(tenant, request);
  }

  getRevision(
    tenant: TTenantContext,
    revisionId: TWidgetRevisionId,
  ): Promise<TWidgetRevisionDescriptor | null> {
    this.#assertPlacement(tenant);
    return this.#publication.getRevision(tenant, revisionId);
  }

  getActiveRevision(
    tenant: TTenantContext,
    definitionId: string,
  ): Promise<TWidgetRevisionDescriptor | null> {
    this.#assertPlacement(tenant);
    return this.#publication.getActiveRevision(tenant, definitionId);
  }

  getRevisionSource(
    tenant: TTenantContext,
    revisionId: TWidgetRevisionId,
  ): Promise<TWidgetRevisionSourceDescriptor | null> {
    this.#assertPlacement(tenant);
    return this.#publication.getRevisionSource(tenant, revisionId);
  }

  async readRevisionSourceSnapshot(
    tenant: TTenantContext,
    request: TWidgetRevisionSourceSnapshotReadRequest,
  ): Promise<TWidgetSourceSnapshot | null> {
    this.#assertPlacement(tenant);
    const source = await this.#publication.getRevisionSource(tenant, request.revisionId);
    if (
      !source
      || source.definitionId !== request.definitionId
      || source.revisionId !== request.revisionId
      || source.sourceArtifact.kind !== 'source'
    ) return null;
    const capability = await this.#artifacts.issueSourceBuildArtifactReadCapability(tenant, {
      definitionId: source.definitionId,
      revisionId: source.revisionId,
      artifactId: source.sourceArtifact.id,
      artifactKind: 'source',
      digestSha256: source.sourceArtifact.digestSha256,
      expiresAtMs: this.#nowMs() + this.#artifactReadMaximumTtlMs,
    });
    const bytes = await this.#artifacts.readArtifact(tenant, {
      artifactId: source.sourceArtifact.id,
      readCapability: capability,
      purpose: 'source_build',
    });
    if (!bytes) return null;
    return this.#sourceSnapshot.decodeArtifact({
      kind: 'source',
      digestSha256: source.sourceArtifact.digestSha256,
      bytes,
    }, {
      expectedSnapshotId: source.sourceSnapshotId,
      expectedSourceDigestSha256: source.sourceDigestSha256,
      expectedBuilderIdentity: source.builderIdentity,
    });
  }

  async buildPreview(
    tenant: TTenantContext,
    request: TWidgetPreviewBuildRequest,
  ): Promise<TWidgetPreviewBuildResult> {
    this.#assertPlacement(tenant);
    if (request.previewId !== undefined) {
      const owner = await this.authoringStore.getPreviewOwner(
        tenant,
        request.previewId,
      );
      const frameOwned = owner === null
        ? false
        : await this.authoringStore.hasPreviewFrameOwnership(tenant, {
            previewId: owner.id,
            canvasId: owner.canvasId,
            frameNodeId: owner.frameNodeId,
            draftId: owner.draftId,
            originChatId: owner.originChatId,
            role: owner.role,
          });
      if (
        owner === null
        || owner.status === 'closed'
        || owner.draftId !== request.draftId
        || !frameOwned
      ) {
        throw Object.assign(new Error(
          'The Preview build no longer has an exact persisted frame owner.',
        ), { code: 'WIDGET_PREVIEW_FRAME_STALE' });
      }
    }
    return this.#preview.buildPreview(tenant, request);
  }

  loadPreview(
    tenant: TTenantContext,
    request: TWidgetPreviewGetRequest,
  ): Promise<TWidgetPreviewBuildResult | null> {
    this.#assertPlacement(tenant);
    return this.#preview.loadPreview(tenant, request);
  }

  loadPreviewRevision(
    tenant: TTenantContext,
    request: TWidgetPreviewRevisionGetRequest,
  ): Promise<TWidgetPreviewBuildResult | null> {
    this.#assertPlacement(tenant);
    return this.#preview.loadPreviewRevision(tenant, request);
  }

  publishPreview(
    tenant: TTenantContext,
    request: TWidgetPreviewPromotionRequest,
  ): Promise<TWidgetPublishResult> {
    this.#assertPlacement(tenant);
    // Always acquire the shared filesystem/metadata lane before opening the
    // database mutation. Publication re-enters the same lane, preventing the
    // inverse GC(lane -> transaction)/promotion(transaction -> lane) order.
    return this.#operationLane.run(() =>
      this.#controlStore.runArtifactMutation(tenant, async () => {
        const [owner, revision, construction, bindings] = await Promise.all([
          this.authoringStore.getPreviewOwner(tenant, request.previewId),
          this.authoringStore.getPreviewRevision(tenant, {
            previewId: request.previewId,
            revisionId: request.previewRevisionId,
          }),
          this.#preview.readPreviewConstruction(tenant, {
            previewId: request.previewId,
            revisionId: request.previewRevisionId,
          }),
          this.authoringStore.getPreviewBindings(tenant, {
            previewId: request.previewId,
            revisionId: request.previewRevisionId,
          }),
        ]);
        const [ownedDraft, frameOwned] = await Promise.all([
          revision === null
            ? Promise.resolve(null)
            : this.authoringStore.getDraft(tenant, revision.draftId),
          owner === null
            ? Promise.resolve(false)
            : this.authoringStore.hasPreviewFrameOwnership(tenant, {
                previewId: owner.id,
                canvasId: owner.canvasId,
                frameNodeId: owner.frameNodeId,
                draftId: owner.draftId,
                originChatId: owner.originChatId,
                role: owner.role,
              }),
        ]);
        const bindingPlanDigestSha256 = fnWidgetPreviewBindingPlanDigest({
          bindings,
          digestSha256: (value) =>
            createHash('sha256').update(value).digest('hex'),
        });
        if (
          owner === null
          || revision === null
          || construction === null
          || ownedDraft === null
          || !frameOwned
          || owner.canvasId !== request.canvasId
          || owner.frameNodeId !== request.frameNodeId
          || owner.status !== 'ready'
          || owner.activeRevisionId !== request.previewRevisionId
          || owner.bindingRevision !== request.expectedBindingRevision
          || revision.bindingRevision !== request.expectedBindingRevision
          || owner.bindingPlanDigestSha256
            !== request.expectedBindingPlanDigestSha256
          || revision.bindingPlanDigestSha256
            !== request.expectedBindingPlanDigestSha256
          || bindingPlanDigestSha256 !== request.expectedBindingPlanDigestSha256
          || revision.previewId !== request.previewId
          || revision.definitionId !== request.definitionId
          || revision.draftRevisionSha256 !== request.expectedDraftRevisionSha256
          || ownedDraft.sourceDigestSha256 !== request.expectedDraftRevisionSha256
          || owner.sourceDigestSha256 !== request.expectedDraftRevisionSha256
          || owner.committedMutationId === null
          || owner.committedMutationId !== revision.committedMutationId
          || ownedDraft.committedMutationId !== revision.committedMutationId
          || ownedDraft.definitionId !== request.definitionId
          || !/^[A-Za-z0-9._~:+-]{1,200}$/.test(request.idempotencyKey)
        ) {
          throw Object.assign(new Error(
            'The selected Preview is no longer the current reviewed revision.',
          ), { code: 'WIDGET_PREVIEW_PROMOTION_STALE' });
        }
        const selectionAlreadyPublished =
          owner.publishedPreviewRevisionId === request.previewRevisionId
          && owner.publishedBindingRevision === request.expectedBindingRevision
          && owner.publishedBindingPlanDigestSha256
            === request.expectedBindingPlanDigestSha256;
        if (
          selectionAlreadyPublished
          && owner.publishedIdempotencyKey !== request.idempotencyKey
        ) {
          throw Object.assign(new Error(
            'The selected Preview revision and binding plan were already published.',
          ), { code: 'WIDGET_PREVIEW_ALREADY_PUBLISHED' });
        }
        const snapshot = this.#sourceSnapshot.decodeArtifact(
          construction.sourceArtifact,
          {
            expectedSnapshotId: revision.sourceSnapshotId,
            expectedSourceDigestSha256: revision.sourceDigestSha256,
            expectedBuilderIdentity: revision.builderIdentity,
          },
        );
        return this.#publication.publishConstruction(tenant, {
          definitionId: request.definitionId,
          expectedActiveRevisionId: request.expectedActiveRevisionId,
          revisionId: request.revisionId,
          snapshot,
          manifest: revision.manifest,
          bindings,
          construction,
          publicationIdentity: {
            idempotencyKey: request.idempotencyKey,
            previewId: request.previewId,
            previewRevisionId: request.previewRevisionId,
            canvasId: request.canvasId,
            frameNodeId: request.frameNodeId,
            draftId: revision.draftId,
            draftRevisionSha256: revision.draftRevisionSha256,
            committedMutationId: revision.committedMutationId,
            definitionId: request.definitionId,
            expectedActiveRevisionId: request.expectedActiveRevisionId,
            bindingRevision: revision.bindingRevision,
            bindingPlanDigestSha256: revision.bindingPlanDigestSha256,
            sourceSnapshotId: revision.sourceSnapshotId,
            sourceDigestSha256: revision.sourceDigestSha256,
            sourceArtifactDigestSha256: revision.sourceArtifact.digestSha256,
            canonicalManifestDigestSha256:
              createHash('sha256')
                .update(revision.canonicalManifestJson)
                .digest('hex'),
            functionDescriptorsDigestSha256:
              revision.functionDescriptorsDigestSha256,
            capabilityContractDigestSha256:
              revision.capabilityContractDigestSha256,
            channelContractDigestSha256:
              revision.channelContractDigestSha256,
            constructionContractDigestSha256:
              revision.constructionContractDigestSha256,
            previewContractDigestSha256:
              revision.previewContractDigestSha256,
            unsignedUiArtifactDigestSha256:
              revision.unsignedUiArtifact.digestSha256,
            previewUiArtifactDigestSha256: revision.uiArtifact.digestSha256,
            capsuleArtifactHash: revision.uiRuntime.capsuleArtifactHash,
            serverArtifactDigestSha256:
              revision.serverArtifact?.digestSha256 ?? null,
            builderIdentity: revision.builderIdentity,
            capsuleBuildIdentity: revision.capsuleBuildIdentity,
            buildPolicyId: revision.buildPolicyId,
          },
          nowMs: request.nowMs,
        });
      }),
    );
  }

  closePreviewWorkspace(
    tenant: TTenantContext,
    request: TWidgetPreviewWorkspaceCloseRequest,
  ): Promise<void> {
    this.#assertPlacement(tenant);
    return this.#preview.closePreviewWorkspace(tenant, request);
  }

  async resolvePreviewFunctionTarget(
    tenant: TTenantContext,
    request: TWidgetPreviewRevisionGetRequest & Readonly<{
      invocationId?: string;
    }>,
  ): Promise<Readonly<{
    revision: TWidgetPreviewRevisionDescriptor;
    bindings: readonly TWidgetResourceBindingInput[];
  }> | null> {
    this.#assertPlacement(tenant);
    const [owner, revision, bindings] = await Promise.all([
      this.authoringStore.getPreviewOwner(tenant, request.previewId),
      this.authoringStore.getPreviewRevision(tenant, request),
      this.authoringStore.getPreviewBindings(tenant, request),
    ]);
    const retainedAfterClose = owner !== null
      && revision !== null
      && owner.status === 'closed'
      && request.invocationId !== undefined
      && await this.authoringStore.hasRetainedPreviewInvocation(tenant, {
        invocationId: request.invocationId,
        previewId: request.previewId,
        previewRevisionId: request.revisionId,
        canvasId: owner.canvasId,
        definitionId: revision.definitionId,
      });
    if (
      owner === null
      || revision === null
      || owner.accountId !== tenant.accountId
      || owner.status === 'closed' && !retainedAfterClose
      || owner.canvasId !== tenant.canvasId && tenant.canvasId !== undefined
    ) return null;
    return Object.freeze({ revision, bindings });
  }

  async readPreviewServerArtifact(
    tenant: TTenantContext,
    request: TWidgetPreviewRevisionGetRequest & Readonly<{
      definitionId: string;
      artifactId: string;
      artifactDigestSha256: string;
      contractDigestSha256: string;
      runtimeAbi: string;
      invocationId?: string;
    }>,
  ): Promise<Uint8Array | null> {
    const target = await this.resolvePreviewFunctionTarget(tenant, request);
    const revision = target?.revision ?? null;
    if (
      revision === null
      || revision.definitionId !== request.definitionId
      || revision.previewContractDigestSha256 !== request.contractDigestSha256
      || revision.serverArtifact?.id !== request.artifactId
      || revision.serverArtifact.digestSha256 !== request.artifactDigestSha256
      || revision.serverRuntimeAbi !== request.runtimeAbi
    ) return null;
    const construction = await this.#preview.readPreviewConstruction(tenant, request);
    const server = construction?.serverArtifact ?? null;
    return server?.digestSha256 === request.artifactDigestSha256
      ? new Uint8Array(server.bytes)
      : null;
  }

  async listPublishedPlacements(
    tenant: TTenantContext,
  ): Promise<readonly TWidgetPublishedPlacementDescriptor[]> {
    this.#assertPlacement(tenant);
    const definitions = await this.#controlStore.listPublishedDefinitions(
      tenant,
      WIDGET_PLACEMENT_CATALOG_MAX_DEFINITIONS + 1,
    );
    if (definitions.length > WIDGET_PLACEMENT_CATALOG_MAX_DEFINITIONS) {
      throw Object.assign(new Error('Published widget placement catalog exceeds its safe limit.'), {
        code: 'WIDGET_PLACEMENT_CATALOG_LIMIT',
      });
    }
    const placements: TWidgetPublishedPlacementDescriptor[] = [];
    for (
      let offset = 0;
      offset < definitions.length;
      offset += WIDGET_PLACEMENT_CATALOG_READ_CONCURRENCY
    ) {
      const batch = definitions.slice(
        offset,
        offset + WIDGET_PLACEMENT_CATALOG_READ_CONCURRENCY,
      );
      placements.push(...await Promise.all(batch.map(async (definition) => {
        const revision = await this.#controlStore.getActiveRevision(tenant, definition.id);
        if (
          !revision
          || definition.activeRevisionId === null
          || revision.id !== definition.activeRevisionId
          || revision.definitionId !== definition.id
        ) {
          throw Object.assign(new Error('Published widget placement is unavailable.'), {
            code: 'WIDGET_PLACEMENT_UNAVAILABLE',
          });
        }
        return this.#publishedPlacementDescriptor(definition, revision);
      })));
    }
    return placements;
  }

  async resolvePublishedPlacement(
    tenant: TTenantContext,
    target: TWidgetPublishedPlacementTarget,
  ): Promise<TWidgetPublishedPlacementDescriptor | null> {
    this.#assertPlacement(tenant);
    const definition = await this.#controlStore.getDefinition(tenant, target.definitionId);
    if (!definition) return null;
    if (
      definition.status !== 'published'
      || definition.activeRevisionId === null
      || definition.activeRevisionId !== target.revisionId
    ) return null;
    const revision = await this.#controlStore.getActiveRevision(tenant, definition.id);
    if (
      !revision
      || revision.id !== target.revisionId
      || revision.definitionId !== definition.id
    ) return null;
    return this.#publishedPlacementDescriptor(definition, revision);
  }

  issueBrowserUiArtifactReadCapability(
    tenant: TTenantContext,
    request: TWidgetArtifactReadCapabilityIssueRequest,
  ): Promise<TWidgetArtifactReadCapability> {
    this.#assertPlacement(tenant);
    return this.#artifacts.issueBrowserUiArtifactReadCapability(tenant, request);
  }

  issueServerExecutionArtifactReadCapability(
    tenant: TTenantContext,
    request: TWidgetArtifactReadCapabilityIssueRequest,
  ): Promise<TWidgetArtifactReadCapability> {
    this.#assertPlacement(tenant);
    return this.#artifacts.issueServerExecutionArtifactReadCapability(tenant, request);
  }

  issueSourceBuildArtifactReadCapability(
    tenant: TTenantContext,
    request: TWidgetArtifactReadCapabilityIssueRequest,
  ): Promise<TWidgetArtifactReadCapability> {
    this.#assertPlacement(tenant);
    return this.#artifacts.issueSourceBuildArtifactReadCapability(tenant, request);
  }

  getArtifact(
    tenant: TTenantContext,
    request: TWidgetArtifactReadRequest,
  ): Promise<TWidgetArtifactDescriptor | null> {
    this.#assertPlacement(tenant);
    return this.#artifacts.getArtifact(tenant, request);
  }

  readArtifact(
    tenant: TTenantContext,
    request: TWidgetArtifactReadRequest,
  ): Promise<Uint8Array | null> {
    this.#assertPlacement(tenant);
    return this.#artifacts.readArtifact(tenant, request);
  }

  #publishedPlacementDescriptor(
    definition: TWidgetDefinitionDescriptor,
    revision: TWidgetRevisionDescriptor,
  ): TWidgetPublishedPlacementDescriptor {
    if (
      revision.manifest.name !== definition.name
      || revision.manifest.slug !== definition.slug
    ) {
      throw Object.assign(new Error('Published widget placement identity is inconsistent.'), {
        code: 'WIDGET_PLACEMENT_UNAVAILABLE',
      });
    }
    return Object.freeze({
      definitionId: definition.id,
      revisionId: revision.id,
      name: definition.name,
      slug: definition.slug,
      description: revision.manifest.description ?? null,
      contractDigestSha256: revision.contractDigestSha256,
      updatedAtMs: revision.createdAtMs,
      bounds: WIDGET_PLACEMENT_FALLBACK_BOUNDS,
    });
  }

  collect(
    tenant: TTenantContext,
    request: TWidgetArtifactGcRequest,
  ): Promise<TWidgetArtifactGcResult> {
    this.#assertPlacement(tenant);
    return this.#garbageCollector.collect(tenant, request);
  }

  async start(): Promise<void> {
    if (this.#artifactGcStarted) return;
    this.#artifactGcStarted = true;
    this.#artifactGcStopped = false;
    const initialCollection = this.#collectArtifactsForMaintenance();
    this.#artifactGcTail = initialCollection.catch(() => undefined);
    await initialCollection;
    if (this.#artifactGcStopped) return;
    const timer = setInterval(() => {
      this.#artifactGcTail = this.#artifactGcTail
        .then(() => this.#artifactGcStopped
          ? undefined
          : this.#collectArtifactsForMaintenance())
        .catch(() => undefined);
    }, this.#artifactGcIntervalMs);
    (timer as unknown as { unref?: () => void }).unref?.();
    this.#artifactGcTimer = timer;
  }

  async stop(): Promise<void> {
    this.#artifactGcStopped = true;
    if (this.#artifactGcTimer !== null) {
      clearInterval(this.#artifactGcTimer);
      this.#artifactGcTimer = null;
    }
    await this.#artifactGcTail;
    await this.#constructionCache.close();
  }

  async #collectArtifactsForMaintenance(): Promise<void> {
    await this.collect(this.#placement, {
      nowMs: this.#nowMs(),
      gracePeriodMs: this.#artifactGcGracePeriodMs,
      limit: this.#artifactGcLimit,
    });
  }

  #boundedMaintenanceInteger(
    value: number,
    minimum: number,
    maximum: number,
    label: string,
  ): number {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new TypeError(`${label} is outside the safe bound.`);
    }
    return value;
  }

  #assertPlacement(tenant: TTenantContext): void {
    if (
      tenant.orgId !== this.#placement.orgId
      || tenant.cellId !== this.#placement.cellId
      || tenant.placementEpoch !== this.#placement.placementEpoch
    ) {
      throw Object.assign(new Error('Widget service placement does not own this request.'), {
        code: 'WIDGET_PLACEMENT_MISMATCH',
      });
    }
  }
}

export { WidgetService };
export type {
  TWidgetBuildValidationRequest,
  TWidgetBuildValidationResult,
  TWidgetServiceConfig,
  TWidgetServicePlacement,
  TWidgetSourceCaptureArgs,
};
