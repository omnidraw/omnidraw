import {
  type IWidgetBrowserUiArtifactReadCapabilityIssuer,
  type IWidgetArtifactReader,
  type IWidgetDurablePreviewService,
  type IWidgetPreviewPromotionService,
  type IWidgetPreviewWorkspaceService,
  type IWidgetPublicationService,
  type IWidgetPublishedPlacementReader,
  type IWidgetRevisionReader,
  type IWidgetRevisionSourceSnapshotReader,
  type IWidgetServerExecutionArtifactReadCapabilityIssuer,
  type IWidgetSourceBuildArtifactReadCapabilityIssuer,
  type TWidgetArtifactGcRequest,
  type TWidgetArtifactGcResult,
  type TWidgetPreviewRevisionDescriptor,
  type TWidgetPreviewRevisionGetRequest,
  type TWidgetResourceBindingInput,
} from '@omnidraw/widget-contract';
import { fnScopedKey, type TTenantContext } from '@omnidraw/tenant-core';
import {
  TenantServicePool,
  type TTenantServicePoolOptions,
} from './TenantServicePool';
import {
  WidgetService,
  type TWidgetBuildValidationRequest,
  type TWidgetBuildValidationResult,
  type TWidgetSourceCaptureArgs,
} from './WidgetService';

type TWidgetServicePoolOptions = Omit<
  TTenantServicePoolOptions<WidgetService>,
  'key' | 'singlePlacementPerOrganization'
>;

type TWidgetServiceCapability = Omit<
  IWidgetPublicationService,
  'archive' | 'publishConstruction'
>
  & IWidgetArtifactReader
  & IWidgetBrowserUiArtifactReadCapabilityIssuer
  & IWidgetPublishedPlacementReader;

/** Trusted authoring surface; captureSource accepts a host path and is never public API authority. */
type TWidgetAuthoringCapability = Omit<IWidgetPublicationService, 'publishConstruction'>
  & IWidgetDurablePreviewService
  & IWidgetPreviewPromotionService
  & IWidgetPreviewWorkspaceService
  & IWidgetRevisionSourceSnapshotReader
  & IWidgetArtifactReader
  & Readonly<{
    captureSource: WidgetService['captureSource'];
    validateBuild(
      tenant: TTenantContext,
      request: TWidgetBuildValidationRequest,
    ): Promise<TWidgetBuildValidationResult>;
  }>;

type TWidgetServerArtifactCapability = IWidgetArtifactReader
  & IWidgetServerExecutionArtifactReadCapabilityIssuer
  & Pick<IWidgetRevisionReader, 'getRevision'>
  & Readonly<{
    resolvePreviewFunctionTarget(
      tenant: TTenantContext,
      request: TWidgetPreviewRevisionGetRequest & Readonly<{
        invocationId?: string;
      }>,
    ): Promise<Readonly<{
      revision: TWidgetPreviewRevisionDescriptor;
      bindings: readonly TWidgetResourceBindingInput[];
    }> | null>;
    readPreviewServerArtifact(
      tenant: TTenantContext,
      request: TWidgetPreviewRevisionGetRequest & Readonly<{
        definitionId: string;
        artifactId: string;
        artifactDigestSha256: string;
        contractDigestSha256: string;
        runtimeAbi: string;
        invocationId?: string;
      }>,
    ): Promise<Uint8Array | null>;
  }>;

/** One physical widget artifact owner per organization placement, shared by accounts. */
class WidgetServicePool extends TenantServicePool<WidgetService>
implements TWidgetServiceCapability, TWidgetServerArtifactCapability {
  constructor(options: TWidgetServicePoolOptions) {
    super('widget-service-pool', {
      ...options,
      key: (tenant) => fnScopedKey('widget-service', [
        tenant.orgId,
        tenant.cellId,
        String(tenant.placementEpoch),
      ]),
      singlePlacementPerOrganization: true,
    });
  }

  publish: IWidgetPublicationService['publish'] = (tenant, request) => (
    this.#delegate(tenant, (service) => service.publish(tenant, request))
  );

  rollback: IWidgetPublicationService['rollback'] = (tenant, request) => (
    this.#delegate(tenant, (service) => service.rollback(tenant, request))
  );

  archive: IWidgetPublicationService['archive'] = (tenant, request) => (
    this.#delegate(tenant, (service) => service.archive(tenant, request))
  );

  getRevision: IWidgetPublicationService['getRevision'] = (tenant, revisionId) => (
    this.#delegate(tenant, (service) => service.getRevision(tenant, revisionId))
  );

  getActiveRevision: IWidgetPublicationService['getActiveRevision'] = (tenant, definitionId) => (
    this.#delegate(tenant, (service) => service.getActiveRevision(tenant, definitionId))
  );

  getRevisionSource: IWidgetPublicationService['getRevisionSource'] = (tenant, revisionId) => (
    this.#delegate(tenant, (service) => service.getRevisionSource(tenant, revisionId))
  );

  readRevisionSourceSnapshot:
    IWidgetRevisionSourceSnapshotReader['readRevisionSourceSnapshot'] = (tenant, request) => (
      this.#delegate(tenant, (service) => service.readRevisionSourceSnapshot(tenant, request))
    );

  buildPreview: IWidgetDurablePreviewService['buildPreview'] = (tenant, request) => (
    this.#delegate(tenant, (service) => service.buildPreview(tenant, request))
  );

  loadPreview: IWidgetDurablePreviewService['loadPreview'] = (tenant, request) => (
    this.#delegate(tenant, (service) => service.loadPreview(tenant, request))
  );

  loadPreviewRevision:
    IWidgetDurablePreviewService['loadPreviewRevision'] = (tenant, request) => (
      this.#delegate(tenant, (service) => service.loadPreviewRevision(tenant, request))
    );

  publishPreview: IWidgetPreviewPromotionService['publishPreview'] = (tenant, request) => (
    this.#delegate(tenant, (service) => service.publishPreview(tenant, request))
  );

  replayPreviewPublication:
    IWidgetPreviewPromotionService['replayPreviewPublication'] = (tenant, request) => (
      this.#delegate(
        tenant,
        (service) => service.replayPreviewPublication(tenant, request),
      )
    );

  closePreviewWorkspace:
    IWidgetPreviewWorkspaceService['closePreviewWorkspace'] = (tenant, request) => (
      this.#delegate(tenant, (service) => service.closePreviewWorkspace(tenant, request))
    );

  resolvePreviewFunctionTarget:
    WidgetService['resolvePreviewFunctionTarget'] = (tenant, request) => (
      this.#delegate(tenant, (service) => (
        service.resolvePreviewFunctionTarget(tenant, request)
      ))
    );

  readPreviewServerArtifact:
    WidgetService['readPreviewServerArtifact'] = (tenant, request) => (
      this.#delegate(tenant, (service) => (
        service.readPreviewServerArtifact(tenant, request)
      ))
    );

  listPublishedPlacements: IWidgetPublishedPlacementReader['listPublishedPlacements'] = (
    tenant,
  ) => this.#delegate(
    tenant,
    (service) => service.listPublishedPlacements(tenant),
  );

  resolvePublishedPlacement: IWidgetPublishedPlacementReader['resolvePublishedPlacement'] = (
    tenant,
    target,
  ) => {
    return this.#delegate(
      tenant,
      (service) => service.resolvePublishedPlacement(tenant, target),
    );
  };

  issueBrowserUiArtifactReadCapability:
    IWidgetBrowserUiArtifactReadCapabilityIssuer['issueBrowserUiArtifactReadCapability'] = (
    tenant,
    request,
  ) => this.#delegate(
    tenant,
    (service) => service.issueBrowserUiArtifactReadCapability(tenant, request),
  );

  issueServerExecutionArtifactReadCapability:
    IWidgetServerExecutionArtifactReadCapabilityIssuer['issueServerExecutionArtifactReadCapability'] = (
    tenant,
    request,
  ) => this.#delegate(
    tenant,
    (service) => service.issueServerExecutionArtifactReadCapability(tenant, request),
  );

  issueSourceBuildArtifactReadCapability:
    IWidgetSourceBuildArtifactReadCapabilityIssuer['issueSourceBuildArtifactReadCapability'] = (
    tenant,
    request,
  ) => this.#delegate(
    tenant,
    (service) => service.issueSourceBuildArtifactReadCapability(tenant, request),
  );

  getArtifact: IWidgetArtifactReader['getArtifact'] = (tenant, request) => (
    this.#delegate(tenant, (service) => service.getArtifact(tenant, request))
  );

  readArtifact: IWidgetArtifactReader['readArtifact'] = (tenant, request) => (
    this.#delegate(tenant, (service) => service.readArtifact(tenant, request))
  );

  captureSource: WidgetService['captureSource'] = (
    tenant,
    sourceRoot,
    args: TWidgetSourceCaptureArgs = {},
  ) => this.#delegate(
    tenant,
    (service) => service.captureSource(tenant, sourceRoot, args),
  );

  validateBuild: TWidgetAuthoringCapability['validateBuild'] = (
    tenant,
    request,
  ): Promise<TWidgetBuildValidationResult> => this.#delegate(
    tenant,
    (service) => service.validateBuild(tenant, request),
  );

  collect(
    tenant: TTenantContext,
    request: TWidgetArtifactGcRequest,
  ): Promise<TWidgetArtifactGcResult> {
    return this.#delegate(tenant, (service) => service.collect(tenant, request));
  }

  #delegate<TResult>(
    tenant: TTenantContext,
    operation: (service: WidgetService) => Promise<TResult>,
  ): Promise<TResult> {
    return this.withTenantService(tenant, operation);
  }
}

/** Narrow public surface: no owner resolver, host paths, control store, deletion, or GC. */
function createWidgetServiceCapability(
  pool: WidgetServicePool,
): TWidgetServiceCapability {
  return Object.freeze({
    publish: pool.publish,
    rollback: pool.rollback,
    getRevision: pool.getRevision,
    getActiveRevision: pool.getActiveRevision,
    getRevisionSource: pool.getRevisionSource,
    listPublishedPlacements: pool.listPublishedPlacements,
    resolvePublishedPlacement: pool.resolvePublishedPlacement,
    issueBrowserUiArtifactReadCapability: pool.issueBrowserUiArtifactReadCapability,
    getArtifact: pool.getArtifact,
    readArtifact: pool.readArtifact,
  });
}

function createWidgetAuthoringCapability(
  pool: WidgetServicePool,
): TWidgetAuthoringCapability {
  return Object.freeze({
    publish: pool.publish,
    rollback: pool.rollback,
    archive: pool.archive,
    getRevision: pool.getRevision,
    getActiveRevision: pool.getActiveRevision,
    getRevisionSource: pool.getRevisionSource,
    readRevisionSourceSnapshot: pool.readRevisionSourceSnapshot,
    buildPreview: pool.buildPreview,
    loadPreview: pool.loadPreview,
    loadPreviewRevision: pool.loadPreviewRevision,
    replayPreviewPublication: pool.replayPreviewPublication,
    publishPreview: pool.publishPreview,
    closePreviewWorkspace: pool.closePreviewWorkspace,
    getArtifact: pool.getArtifact,
    readArtifact: pool.readArtifact,
    captureSource: pool.captureSource,
    validateBuild: pool.validateBuild,
  });
}

/** Executor-only surface: purpose is fixed and never selected by its caller. */
function createWidgetServerArtifactCapability(
  pool: WidgetServicePool,
): TWidgetServerArtifactCapability {
  return Object.freeze({
    getRevision: pool.getRevision,
    resolvePreviewFunctionTarget: pool.resolvePreviewFunctionTarget,
    readPreviewServerArtifact: pool.readPreviewServerArtifact,
    issueServerExecutionArtifactReadCapability: pool.issueServerExecutionArtifactReadCapability,
    getArtifact: pool.getArtifact,
    readArtifact: pool.readArtifact,
  });
}

export {
  createWidgetAuthoringCapability,
  createWidgetServerArtifactCapability,
  createWidgetServiceCapability,
  WidgetServicePool,
};
export type {
  TWidgetAuthoringCapability,
  TWidgetServerArtifactCapability,
  TWidgetServiceCapability,
  TWidgetServicePoolOptions,
};
