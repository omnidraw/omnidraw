import {
  type IWidgetBrowserUiArtifactReadCapabilityIssuer,
  type IWidgetArtifactReader,
  type IWidgetPublicationService,
  type IWidgetRevisionReader,
  type IWidgetServerExecutionArtifactReadCapabilityIssuer,
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
  'key'
>;

type TWidgetServiceCapability = IWidgetPublicationService
  & IWidgetArtifactReader
  & IWidgetBrowserUiArtifactReadCapabilityIssuer;

type TWidgetServerArtifactCapability = IWidgetArtifactReader
  & IWidgetServerExecutionArtifactReadCapabilityIssuer
  & Pick<IWidgetRevisionReader, 'getRevision'>;

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
    return this.forTenant(tenant).then(operation);
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
    issueBrowserUiArtifactReadCapability: pool.issueBrowserUiArtifactReadCapability,
    getArtifact: pool.getArtifact,
    readArtifact: pool.readArtifact,
  });
}

/** Executor-only surface: purpose is fixed and never selected by its caller. */
function createWidgetServerArtifactCapability(
  pool: WidgetServicePool,
): TWidgetServerArtifactCapability {
  return Object.freeze({
    getRevision: pool.getRevision,
    issueServerExecutionArtifactReadCapability: pool.issueServerExecutionArtifactReadCapability,
    getArtifact: pool.getArtifact,
    readArtifact: pool.readArtifact,
  });
}

export {
  createWidgetServerArtifactCapability,
  createWidgetServiceCapability,
  WidgetServicePool,
};
export type {
  TWidgetServerArtifactCapability,
  TWidgetServiceCapability,
  TWidgetServicePoolOptions,
};
