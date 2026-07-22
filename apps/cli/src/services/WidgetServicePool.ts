import {
  type IWidgetBrowserUiArtifactReadCapabilityIssuer,
  type IWidgetArtifactReader,
  type IWidgetPreviewService,
  type IWidgetPublicationService,
  type IWidgetPublishedPlacementReader,
  type IWidgetRevisionReader,
  type IWidgetServerPreviewArtifactReadCapabilityIssuer,
  type IWidgetServerExecutionArtifactReadCapabilityIssuer,
  type IWidgetSourceBuildArtifactReadCapabilityIssuer,
  type IWidgetUiPreviewArtifactReadCapabilityIssuer,
  type TWidgetArtifactGcRequest,
  type TWidgetArtifactGcResult,
} from '@vibecanvas/widget-contract';
import { fnScopedKey, type TTenantContext } from '@vibecanvas/tenant-core';
import {
  TenantServicePool,
  type TTenantServicePoolOptions,
} from './TenantServicePool';
import {
  WidgetService,
  type TWidgetSourceCaptureArgs,
} from './WidgetService';

type TWidgetServicePoolOptions = Omit<
  TTenantServicePoolOptions<WidgetService>,
  'key' | 'singlePlacementPerOrganization'
>;

type TWidgetServiceCapability = IWidgetPublicationService
  & IWidgetPreviewService
  & IWidgetArtifactReader
  & IWidgetBrowserUiArtifactReadCapabilityIssuer
  & IWidgetUiPreviewArtifactReadCapabilityIssuer
  & IWidgetSourceBuildArtifactReadCapabilityIssuer
  & IWidgetPublishedPlacementReader;

/** Trusted authoring surface; captureSource accepts a host path and is never public API authority. */
type TWidgetAuthoringCapability = IWidgetPublicationService
  & IWidgetPreviewService
  & IWidgetArtifactReader
  & IWidgetUiPreviewArtifactReadCapabilityIssuer
  & Readonly<{
    captureSource: WidgetService['captureSource'];
  }>;

type TWidgetServerArtifactCapability = IWidgetArtifactReader
  & IWidgetServerExecutionArtifactReadCapabilityIssuer
  & IWidgetServerPreviewArtifactReadCapabilityIssuer
  & Pick<IWidgetRevisionReader, 'getRevision'>
  & Pick<IWidgetPreviewService, 'getPreviewRevision'>;

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

  getRevision: IWidgetPublicationService['getRevision'] = (tenant, revisionId) => (
    this.#delegate(tenant, (service) => service.getRevision(tenant, revisionId))
  );

  getActiveRevision: IWidgetPublicationService['getActiveRevision'] = (tenant, definitionId) => (
    this.#delegate(tenant, (service) => service.getActiveRevision(tenant, definitionId))
  );

  getRevisionSource: IWidgetPublicationService['getRevisionSource'] = (tenant, revisionId) => (
    this.#delegate(tenant, (service) => service.getRevisionSource(tenant, revisionId))
  );

  buildPreview: IWidgetPreviewService['buildPreview'] = (tenant, request) => (
    this.#delegate(tenant, (service) => service.buildPreview(tenant, request))
  );

  getPreview: IWidgetPreviewService['getPreview'] = (tenant, request) => (
    this.#delegate(tenant, (service) => service.getPreview(tenant, request))
  );

  getPreviewRevision: IWidgetPreviewService['getPreviewRevision'] = (tenant, request) => (
    this.#delegate(tenant, (service) => service.getPreviewRevision(tenant, request))
  );

  stopPreview: IWidgetPreviewService['stopPreview'] = (tenant, request) => (
    this.#delegate(tenant, (service) => service.stopPreview(tenant, request))
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

  issueUiPreviewArtifactReadCapability:
    IWidgetUiPreviewArtifactReadCapabilityIssuer['issueUiPreviewArtifactReadCapability'] = (
    tenant,
    request,
  ) => this.#delegate(
    tenant,
    (service) => service.issueUiPreviewArtifactReadCapability(tenant, request),
  );

  issueServerPreviewArtifactReadCapability:
    IWidgetServerPreviewArtifactReadCapabilityIssuer['issueServerPreviewArtifactReadCapability'] = (
    tenant,
    request,
  ) => this.#delegate(
    tenant,
    (service) => service.issueServerPreviewArtifactReadCapability(tenant, request),
  );

  getArtifact: IWidgetArtifactReader['getArtifact'] = (tenant, request) => (
    this.#delegate(tenant, (service) => service.getArtifact(tenant, request))
  );

  readArtifact: IWidgetArtifactReader['readArtifact'] = (tenant, request) => (
    this.#delegate(tenant, (service) => service.readArtifact(tenant, request))
  );

  captureSource(
    tenant: TTenantContext,
    sourceRoot: string,
    args: TWidgetSourceCaptureArgs = {},
  ) {
    return this.#delegate(
      tenant,
      (service) => service.captureSource(tenant, sourceRoot, args),
    );
  }

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
    buildPreview: pool.buildPreview,
    getPreview: pool.getPreview,
    getPreviewRevision: pool.getPreviewRevision,
    stopPreview: pool.stopPreview,
    listPublishedPlacements: pool.listPublishedPlacements,
    resolvePublishedPlacement: pool.resolvePublishedPlacement,
    issueBrowserUiArtifactReadCapability: pool.issueBrowserUiArtifactReadCapability,
    issueUiPreviewArtifactReadCapability: pool.issueUiPreviewArtifactReadCapability,
    issueSourceBuildArtifactReadCapability: pool.issueSourceBuildArtifactReadCapability,
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
    getRevision: pool.getRevision,
    getActiveRevision: pool.getActiveRevision,
    getRevisionSource: pool.getRevisionSource,
    buildPreview: pool.buildPreview,
    getPreview: pool.getPreview,
    getPreviewRevision: pool.getPreviewRevision,
    stopPreview: pool.stopPreview,
    issueUiPreviewArtifactReadCapability: pool.issueUiPreviewArtifactReadCapability,
    getArtifact: pool.getArtifact,
    readArtifact: pool.readArtifact,
    captureSource: pool.captureSource,
  });
}

/** Executor-only surface: purpose is fixed and never selected by its caller. */
function createWidgetServerArtifactCapability(
  pool: WidgetServicePool,
): TWidgetServerArtifactCapability {
  return Object.freeze({
    getRevision: pool.getRevision,
    getPreviewRevision: pool.getPreviewRevision,
    issueServerExecutionArtifactReadCapability: pool.issueServerExecutionArtifactReadCapability,
    issueServerPreviewArtifactReadCapability: pool.issueServerPreviewArtifactReadCapability,
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
