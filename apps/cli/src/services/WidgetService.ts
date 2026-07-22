import type { Database } from '@tursodatabase/database';
import { createHash } from 'node:crypto';
import type { IService, IStoppableService } from '@vibecanvas/runtime';
import { AgentAuthoringStoreTurso } from '@vibecanvas/service-db/AgentAuthoringStoreTurso';
import { WidgetControlStoreTurso } from '@vibecanvas/service-db/WidgetControlStoreTurso';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type {
  IWidgetArtifactGarbageCollector,
  IWidgetArtifactBuilder,
  IWidgetArtifactMutationCoordinator,
  IWidgetBrowserUiArtifactReadCapabilityIssuer,
  IWidgetArtifactReader,
  IWidgetControlStore,
  IWidgetPreviewService,
  IWidgetPublishedPlacementReader,
  IWidgetPublicationService,
  IWidgetRevisionSourceSnapshotReader,
  IWidgetServerPreviewArtifactReadCapabilityIssuer,
  IWidgetServerExecutionArtifactReadCapabilityIssuer,
  IWidgetSourceBuildArtifactReadCapabilityIssuer,
  IWidgetServerFunctionDescriptorExtractor,
  IWidgetUiPreviewArtifactReadCapabilityIssuer,
  TWidgetActiveRevisionCasResult,
  TWidgetArtifactDescriptor,
  TWidgetArtifactGcRequest,
  TWidgetArtifactGcResult,
  TWidgetArtifactReadCapability,
  TWidgetArtifactReadCapabilityIssueRequest,
  TWidgetArtifactReadRequest,
  TWidgetDefinitionDescriptor,
  TWidgetDefinitionArchiveInput,
  TWidgetDefinitionArchiveResult,
  TWidgetManifestV2,
  TWidgetPublishRequest,
  TWidgetPublishResult,
  TWidgetPublishedPlacementDescriptor,
  TWidgetPublishedPlacementTarget,
  TWidgetPreviewArtifactReadCapabilityIssueRequest,
  TWidgetPreviewBuildRequest,
  TWidgetPreviewBuildResult,
  TWidgetPreviewGetRequest,
  TWidgetPreviewRevisionDescriptor,
  TWidgetPreviewRevisionGetRequest,
  TWidgetPreviewStopRequest,
  TWidgetRevisionDescriptor,
  TWidgetRevisionId,
  TWidgetRevisionSourceDescriptor,
  TWidgetRevisionSourceSnapshotReadRequest,
  TWidgetRollbackInput,
  TWidgetSourceSnapshot,
} from '@vibecanvas/widget-contract';
import {
  ZWidgetManifestV2,
  ZWidgetServerFunctionDescriptors,
  fnCanonicalizeWidgetManifest,
  fnValidateWidgetBuildIntegrity,
} from '@vibecanvas/widget-contract';
import {
  LocalWidgetArtifactStore,
  WidgetArtifactBuilderBun,
  WidgetArtifactGarbageCollector,
  WidgetArtifactOperationLane,
  WidgetArtifactReadAuthority,
  WidgetArtifactService,
  WidgetPreviewService,
  WidgetPublicationService,
  WidgetSourceSnapshot,
  type TCapturedWidgetSourceSnapshot,
} from '@vibecanvas/widget-contract/local';
import { WidgetTypeScriptValidator } from './WidgetTypeScriptValidator';

type TWidgetServicePlacement = Readonly<Pick<
  TTenantContext,
  'orgId' | 'cellId' | 'placementEpoch'
>>;

type TWidgetServiceConfig = Readonly<{
  placement: TWidgetServicePlacement;
  database: Database;
  artifactsRoot: string;
  buildTempRoot: string;
  builderIdentity: string;
  artifactReadSecret: Uint8Array;
  artifactReadMaximumTtlMs: number;
  compiledExecutable?: boolean;
  nowMs?: () => number;
  functionDescriptorExtractor: IWidgetServerFunctionDescriptorExtractor;
  resolveTrustedPackageImport: (specifier: string) => string;
}>;

type TWidgetSourceCaptureArgs = Readonly<{
  id?: string;
  createdAtMs?: number;
  expectedDigestSha256?: string;
}>;

type TWidgetBuildValidationRequest = Readonly<{
  snapshot: TWidgetSourceSnapshot;
  manifest: TWidgetManifestV2;
}>;

type TWidgetBuildValidationResult = Readonly<{
  valid: boolean;
  diagnostics: readonly string[];
}>;

const WIDGET_PLACEMENT_FALLBACK_BOUNDS = Object.freeze({ width: 360, height: 320 });
const WIDGET_PLACEMENT_CATALOG_MAX_DEFINITIONS = 1_000;
const WIDGET_PLACEMENT_CATALOG_READ_CONCURRENCY = 8;

/** Organization-placement owner for actor-free v2 widget artifacts and revisions. */
class WidgetService implements
  IService,
  IStoppableService,
  IWidgetPublicationService,
  IWidgetRevisionSourceSnapshotReader,
  IWidgetPublishedPlacementReader,
  IWidgetArtifactReader,
  IWidgetBrowserUiArtifactReadCapabilityIssuer,
  IWidgetServerExecutionArtifactReadCapabilityIssuer,
  IWidgetSourceBuildArtifactReadCapabilityIssuer,
  IWidgetUiPreviewArtifactReadCapabilityIssuer,
  IWidgetServerPreviewArtifactReadCapabilityIssuer,
  IWidgetPreviewService,
  IWidgetArtifactGarbageCollector {
  readonly name = 'widget-service';
  readonly #placement: TWidgetServicePlacement;
  readonly #builderIdentity: string;
  readonly #artifactReadMaximumTtlMs: number;
  readonly #nowMs: () => number;
  readonly #controlStore: IWidgetControlStore & IWidgetArtifactMutationCoordinator;
  readonly authoringStore: AgentAuthoringStoreTurso;
  readonly #sourceSnapshot: WidgetSourceSnapshot;
  readonly #builder: IWidgetArtifactBuilder;
  readonly #typescriptValidator: WidgetTypeScriptValidator;
  readonly #publication: WidgetPublicationService;
  readonly #preview: WidgetPreviewService;
  readonly #artifacts: WidgetArtifactService;
  readonly #garbageCollector: WidgetArtifactGarbageCollector;

  constructor(config: TWidgetServiceConfig) {
    this.#placement = Object.freeze({ ...config.placement });
    this.#builderIdentity = config.builderIdentity;
    this.#artifactReadMaximumTtlMs = config.artifactReadMaximumTtlMs;
    this.#nowMs = config.nowMs ?? Date.now;
    this.#sourceSnapshot = new WidgetSourceSnapshot();
    this.#typescriptValidator = new WidgetTypeScriptValidator({
      compiledExecutable: config.compiledExecutable,
    });

    const controlStore: IWidgetControlStore & IWidgetArtifactMutationCoordinator =
      new WidgetControlStoreTurso(config.database);
    const previewStore = new AgentAuthoringStoreTurso(
      config.database,
      controlStore,
    );
    this.authoringStore = previewStore;
    this.#controlStore = controlStore;
    const blobs = new LocalWidgetArtifactStore({
      orgId: config.placement.orgId,
      artifactsRoot: config.artifactsRoot,
    });
    const operationLane = new WidgetArtifactOperationLane();
    const readAuthority = new WidgetArtifactReadAuthority({
      secret: config.artifactReadSecret,
      maximumTtlMs: config.artifactReadMaximumTtlMs,
      now: this.#nowMs,
    });
    this.#artifacts = new WidgetArtifactService({
      controlStore,
      previewStore,
      blobs,
      capabilityIssuer: readAuthority,
      capabilityVerifier: readAuthority,
    });
    const builder = new WidgetArtifactBuilderBun({
      tempRoot: config.buildTempRoot,
      builderIdentity: config.builderIdentity,
      snapshotService: this.#sourceSnapshot,
      functionDescriptorExtractor: config.functionDescriptorExtractor,
      resolveTrustedPackageImport: config.resolveTrustedPackageImport,
    });
    this.#builder = builder;
    this.#publication = new WidgetPublicationService({
      builder,
      artifacts: this.#artifacts,
      controlStore,
      mutationCoordinator: controlStore,
      operationLane,
      sourceSnapshots: this.#sourceSnapshot,
    });
    this.#preview = new WidgetPreviewService({
      builder,
      artifacts: this.#artifacts,
      previewStore,
      mutationCoordinator: controlStore,
      operationLane,
      sourceSnapshots: this.#sourceSnapshot,
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

  /** Trusted, no-commit build validation over one exact immutable source snapshot. */
  async validateBuild(
    tenant: TTenantContext,
    request: TWidgetBuildValidationRequest,
  ): Promise<TWidgetBuildValidationResult> {
    this.#assertPlacement(tenant);
    try {
      const manifest = ZWidgetManifestV2.parse(request.manifest);
      const canonicalManifestJson = fnCanonicalizeWidgetManifest(manifest);
      const build = await this.#builder.build(tenant, {
        snapshot: request.snapshot,
        manifest,
        canonicalManifestJson,
        builderIdentity: this.#builderIdentity,
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
      const typeDiagnostics = await this.#typescriptValidator.validate(request.snapshot);
      if (typeDiagnostics.length > 0) {
        return Object.freeze({
          valid: false,
          diagnostics: typeDiagnostics,
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

  buildPreview(
    tenant: TTenantContext,
    request: TWidgetPreviewBuildRequest,
  ): Promise<TWidgetPreviewBuildResult> {
    this.#assertPlacement(tenant);
    return this.#preview.buildPreview(tenant, request);
  }

  getPreview(
    tenant: TTenantContext,
    request: TWidgetPreviewGetRequest,
  ): Promise<TWidgetPreviewRevisionDescriptor | null> {
    this.#assertPlacement(tenant);
    return this.#preview.getPreview(tenant, request);
  }

  getPreviewRevision(
    tenant: TTenantContext,
    request: TWidgetPreviewRevisionGetRequest,
  ): Promise<TWidgetPreviewRevisionDescriptor | null> {
    this.#assertPlacement(tenant);
    return this.#preview.getPreviewRevision(tenant, request);
  }

  stopPreview(tenant: TTenantContext, request: TWidgetPreviewStopRequest): Promise<boolean> {
    this.#assertPlacement(tenant);
    return this.#preview.stopPreview(tenant, request);
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

  issueUiPreviewArtifactReadCapability(
    tenant: TTenantContext,
    request: TWidgetPreviewArtifactReadCapabilityIssueRequest & Readonly<{ artifactKind: 'ui' }>,
  ): Promise<TWidgetArtifactReadCapability> {
    this.#assertPlacement(tenant);
    return this.#artifacts.issueUiPreviewArtifactReadCapability(tenant, request);
  }

  issueServerPreviewArtifactReadCapability(
    tenant: TTenantContext,
    request: TWidgetPreviewArtifactReadCapabilityIssueRequest & Readonly<{
      artifactKind: 'server';
    }>,
  ): Promise<TWidgetArtifactReadCapability> {
    this.#assertPlacement(tenant);
    return this.#artifacts.issueServerPreviewArtifactReadCapability(tenant, request);
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

  stop(): void {
    // The owner holds immutable paths and stateless adapters only. The method
    // participates in pool lifecycle so future adapters can add cleanup safely.
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
